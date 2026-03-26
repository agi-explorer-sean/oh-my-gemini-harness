import {execSync} from 'node:child_process';
import * as crypto from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {log} from '../../shared/logger';
import type {BackgroundManager} from '../background-agent';
import type {ParallelTask} from './types';

export interface SynthesisResult {
  filePath: string;
  status: 'merged' | 'conflict' | 'unchanged' | 'error' | 'added' | 'deleted';
  resolution?: string;
  error?: string;
}

export interface ParallelSynthesizerOptions {
  manager: BackgroundManager;
  parentSessionID: string;
  parentMessageID: string;
}

export class ParallelSynthesizer {
  private manager: BackgroundManager;
  private parentSessionID: string;
  private parentMessageID: string;

  constructor(options: ParallelSynthesizerOptions) {
    this.manager = options.manager;
    this.parentSessionID = options.parentSessionID;
    this.parentMessageID = options.parentMessageID;
  }

  public async synthesize(
    mainDir: string,
    tasks: ParallelTask[],
  ): Promise<SynthesisResult[]> {
    log(`[parallel-synthesis] Starting synthesis for ${tasks.length} tasks`);

    const successfulTasks = tasks.filter(
      (t) => t.status === 'completed' && t.workingDirectory,
    );
    if (successfulTasks.length === 0) {
      log(
        '[parallel-synthesis] No successful tasks with isolated environments found',
      );
      return [];
    }

    const fileVersions = new Map<string, string[]>();
    const addedFiles = new Map<string, string[]>();
    const deletedFiles = new Set<string>();

    for (const task of successfulTasks) {
      const changes = this.getChanges(mainDir, task.workingDirectory!);

      for (const file of changes.modified) {
        const fullPath = join(task.workingDirectory!, file);
        if (existsSync(fullPath) && lstatSync(fullPath).isFile()) {
          const content = readFileSync(fullPath, 'utf-8');
          const versions = fileVersions.get(file) ?? [];
          versions.push(content);
          fileVersions.set(file, versions);
        }
      }

      for (const file of changes.added) {
        const fullPath = join(task.workingDirectory!, file);
        if (existsSync(fullPath) && lstatSync(fullPath).isFile()) {
          const content = readFileSync(fullPath, 'utf-8');
          const versions = addedFiles.get(file) ?? [];
          versions.push(content);
          addedFiles.set(file, versions);
        }
      }

      for (const file of changes.deleted) {
        deletedFiles.add(file);
      }
    }

    const results: SynthesisResult[] = [];

    for (const file of deletedFiles) {
      const mainPath = join(mainDir, file);
      if (existsSync(mainPath) && lstatSync(mainPath).isFile()) {
        if (fileVersions.has(file)) {
          log(
            `[parallel-synthesis] Conflict: ${file} deleted by one agent but modified by another`,
          );
          try {
            const baseContent = readFileSync(mainPath, 'utf-8');
            const resolved = await this.resolveDeleteModifyConflict(
              file,
              baseContent,
              fileVersions.get(file)!,
            );
            if (resolved === null) {
              rmSync(mainPath, {force: true});
              results.push({
                filePath: file,
                status: 'deleted',
                resolution: 'LLM-assisted',
              });
            } else {
              writeFileSync(mainPath, resolved);
              results.push({
                filePath: file,
                status: 'merged',
                resolution: 'LLM-assisted (kept)',
              });
            }
          } catch (err) {
            results.push({filePath: file, status: 'error', error: String(err)});
          }
        } else {
          rmSync(mainPath, {force: true});
          results.push({filePath: file, status: 'deleted'});
        }
      }
    }

    for (const [file, versions] of addedFiles.entries()) {
      const mainPath = join(mainDir, file);
      if (versions.length === 1) {
        mkdirSync(join(mainDir, join(file, '..')), {recursive: true});
        writeFileSync(mainPath, versions[0]);
        results.push({filePath: file, status: 'added'});
      } else {
        log(
          `[parallel-synthesis] Conflict: Multiple agents added the same file ${file}`,
        );
        try {
          const resolved = await this.resolveConflictsViaAgent(
            file,
            '',
            versions,
          );
          mkdirSync(join(mainDir, join(file, '..')), {recursive: true});
          writeFileSync(mainPath, resolved);
          results.push({
            filePath: file,
            status: 'added',
            resolution: 'LLM-assisted',
          });
        } catch (err) {
          results.push({filePath: file, status: 'error', error: String(err)});
        }
      }
    }

    for (const [file, versions] of fileVersions.entries()) {
      const mainPath = join(mainDir, file);
      if (!existsSync(mainPath) || !lstatSync(mainPath).isFile()) continue; // Already handled by deletion if it was deleted

      try {
        const baseContent = readFileSync(mainPath, 'utf-8');

        log(
          `[parallel-synthesis] Merging ${file} (${versions.length} versions)`,
        );

        if (versions.length === 1) {
          try {
            writeFileSync(mainPath, versions[0]);
            results.push({filePath: file, status: 'merged'});
          } catch (err) {
            results.push({filePath: file, status: 'error', error: String(err)});
          }
          continue;
        }

        const mergedContent = await this.mergeMultipleVersions(
          file,
          baseContent,
          versions,
        );
        if (
          mergedContent.includes('<<<<<<<') ||
          mergedContent.includes('=======') ||
          mergedContent.includes('>>>>>>>')
        ) {
          log(
            `[parallel-synthesis] Conflict detected in ${file}, triggering LLM reconciliation`,
          );
          const resolved = await this.resolveConflictsViaAgent(
            file,
            baseContent,
            versions,
          );
          writeFileSync(mainPath, resolved);
          results.push({
            filePath: file,
            status: 'merged',
            resolution: 'LLM-assisted',
          });
        } else {
          writeFileSync(mainPath, mergedContent);
          results.push({
            filePath: file,
            status: 'merged',
            resolution: 'Auto-merged',
          });
        }
      } catch (err) {
        results.push({filePath: file, status: 'error', error: String(err)});
      }
    }

    return results;
  }

  private getChanges(
    mainDir: string,
    taskDir: string,
  ): {modified: string[]; added: string[]; deleted: string[]} {
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];

    try {
      log(`[parallel-synthesis] Running diff -qr "${mainDir}" "${taskDir}"`);
      const output = execSync(`diff -qr "${mainDir}" "${taskDir}" || true`, {
        encoding: 'utf-8',
      });
      log(`[parallel-synthesis] Diff output: ${output}`);
      const lines = output.split('\n').filter(Boolean);

      for (const line of lines) {
        const differMatch = line.match(/Files (.+) and (.+) differ/);
        if (differMatch) {
          const relPath = relative(mainDir, differMatch[1]);
          const fullPath = join(mainDir, relPath);
          if (existsSync(fullPath) && lstatSync(fullPath).isFile()) {
            modified.push(relPath);
          }
          continue;
        }

        const onlyInMainMatch = line.match(/Only in (.+): (.+)/);
        if (onlyInMainMatch) {
          const dir = onlyInMainMatch[1];
          const file = onlyInMainMatch[2];

          // Skip sensitive directories that are excluded from isolation
          if (file === '.git' || file === 'node_modules') {
            continue;
          }

          const fullPath = join(dir, file);
          if (existsSync(fullPath) && lstatSync(fullPath).isFile()) {
            if (dir.startsWith(mainDir)) {
              deleted.push(relative(mainDir, fullPath));
            } else if (dir.startsWith(taskDir)) {
              added.push(relative(taskDir, fullPath));
            }
          }
        }
      }
    } catch (err) {
      log(`[parallel-synthesis] Failed to get changes: ${err}`);
    }

    return {modified, added, deleted};
  }

  private async resolveDeleteModifyConflict(
    file: string,
    base: string,
    modifiedVersions: string[],
  ): Promise<string | null> {
    const versionsText = modifiedVersions
      .map(
        (v, i) => `### Modified Version ${i + 1}
\`\`\`
${v}
\`\`\``,
      )
      .join('\n\n');

    const prompt = `You are the Parallel Synthesis Engine. A conflict has occurred for the file "${file}". 
One agent deleted the file, while one or more other agents modified it.

## Original File (Base)
\`\`\`
${base}
\`\`\`

## Modified Versions from other agents
${versionsText}

## Instructions
1. Decide whether the file should be deleted or kept with modifications.
2. If it should be DELETED, output only the word "DELETE".
3. If it should be KEPT, output the COMPLETE content of the resolved file within a single code block.

Decision:`;

    const task = await this.manager.launch({
      description: `Resolve delete/modify conflict in ${file}`,
      prompt,
      agent: 'sisyphus-junior',
      category: 'ultrabrain',
      parentSessionID: this.parentSessionID,
      parentMessageID: this.parentMessageID,
    });

    log(
      `[parallel-synthesis] Launched conflict resolution task: ${task.id} for ${file}`,
    );

    let currentTask = task;
    const maxRetries = 60; // 2 minutes
    let retries = 0;
    while (
      (currentTask.status === 'pending' || currentTask.status === 'running') &&
      retries < maxRetries
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      currentTask = this.manager.getTask(task.id) || currentTask;
      retries++;
    }

    if (currentTask.status === 'completed' && currentTask.result) {
      if (currentTask.result.trim().toUpperCase() === 'DELETE') {
        return null;
      }
      const match = currentTask.result.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
      return match ? match[1] : currentTask.result;
    }

    throw new Error(
      `Conflict resolution failed for ${file}: ${currentTask.error}`,
    );
  }

  private async mergeMultipleVersions(
    file: string,
    base: string,
    versions: string[],
  ): Promise<string> {
    if (versions.length === 0) return base;
    if (versions.length === 1) return versions[0];

    let current = base;
    for (const version of versions) {
      current = this.threeWayMerge(base, current, version);
    }
    return current;
  }

  private threeWayMerge(base: string, current: string, next: string): string {
    if (current === next) return current;
    if (current === base) return next;
    if (next === base) return current;

    // Use git merge-file for 3-way merge, fall back to conflict markers
    try {
      const tmpBase = join(tmpdir(), `base-${crypto.randomUUID()}`);
      const tmpCurrent = join(tmpdir(), `current-${crypto.randomUUID()}`);
      const tmpNext = join(tmpdir(), `next-${crypto.randomUUID()}`);

      writeFileSync(tmpBase, base);
      writeFileSync(tmpCurrent, current);
      writeFileSync(tmpNext, next);

      try {
        // git merge-file modifies tmpCurrent in-place
        execSync(`git merge-file "${tmpCurrent}" "${tmpBase}" "${tmpNext}"`, {
          stdio: 'ignore',
        });
        if (existsSync(tmpCurrent) && lstatSync(tmpCurrent).isFile()) {
          const merged = readFileSync(tmpCurrent, 'utf-8');
          return merged;
        }
      } catch (err) {
        // Exit code 1 = conflicts, but output still has merged content with conflict markers
        if (existsSync(tmpCurrent) && lstatSync(tmpCurrent).isFile()) {
          try {
            return readFileSync(tmpCurrent, 'utf-8');
          } catch (readErr) {
            log(`[parallel-synthesis] Error reading merged file: ${readErr}`);
          }
        }
      } finally {
        rmSync(tmpBase, {force: true});
        rmSync(tmpCurrent, {force: true});
        rmSync(tmpNext, {force: true});
      }
    } catch (err) {
      log(`[parallel-synthesis] Fallback to simple conflict markers: ${err}`);
    }

    return `<<<<<<< CURRENT
${current}
=======
${next}
>>>>>>> NEXT`;
  }

  private async resolveConflictsViaAgent(
    file: string,
    base: string,
    versions: string[],
  ): Promise<string> {
    const versionsText = versions
      .map(
        (v, i) => `### Version ${i + 1}
\`\`\`
${v}
\`\`\``,
      )
      .join('\n\n');

    const prompt = `You are the Parallel Synthesis Engine. Your task is to reconcile conflicting changes made to the file "${file}" by multiple parallel agents.

## Original File (Base)
\`\`\`
${base}
\`\`\`

## Conflicting Versions
${versionsText}

## Instructions
1. Analyze the intent of each version.
2. Produce a single, unified version of the file that incorporates all valid changes.
3. Ensure the code is syntactically correct and preserves all functional improvements.
4. Output the COMPLETE content of the resolved file within a single code block.

Resolved File Content:`;

    const task = await this.manager.launch({
      description: `Synthesize conflicts in ${file}`,
      prompt,
      agent: 'sisyphus-junior',
      category: 'ultrabrain',
      parentSessionID: this.parentSessionID,
      parentMessageID: this.parentMessageID,
    });

    let currentTask = task;
    const maxRetries = 90;
    let retries = 0;
    while (
      (currentTask.status === 'pending' || currentTask.status === 'running') &&
      retries < maxRetries
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      currentTask = this.manager.getTask(task.id) || currentTask;
      retries++;
    }

    if (currentTask.status === 'completed' && currentTask.result) {
      const match = currentTask.result.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
      return match ? match[1] : currentTask.result;
    }

    throw new Error(
      `Conflict resolution failed for ${file}: ${currentTask.error}`,
    );
  }
}

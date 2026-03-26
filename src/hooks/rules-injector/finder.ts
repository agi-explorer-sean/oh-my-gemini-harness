import {existsSync, readdirSync, realpathSync, statSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {
  GITHUB_INSTRUCTIONS_PATTERN,
  PROJECT_MARKERS,
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  RULE_EXTENSIONS,
  USER_RULE_DIR,
} from './constants';
import type {RuleFileCandidate} from './types';

function isGitHubInstructionsDir(dir: string): boolean {
  return (
    dir.includes('.github/instructions') || dir.endsWith('.github/instructions')
  );
}

function isValidRuleFile(fileName: string, dir: string): boolean {
  if (isGitHubInstructionsDir(dir)) {
    return GITHUB_INSTRUCTIONS_PATTERN.test(fileName);
  }
  return RULE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

export function findProjectRoot(startPath: string): string | null {
  let current: string;

  try {
    const stat = statSync(startPath);
    current = stat.isDirectory() ? startPath : dirname(startPath);
  } catch {
    current = dirname(startPath);
  }

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = join(current, marker);
      if (existsSync(markerPath)) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findRuleFilesRecursive(dir: string, results: string[]): void {
  if (!existsSync(dir)) return;

  try {
    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        findRuleFilesRecursive(fullPath, results);
      } else if (entry.isFile()) {
        if (isValidRuleFile(entry.name, dir)) {
          results.push(fullPath);
        }
      }
    }
  } catch {}
}

function safeRealpathSync(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

export function calculateDistance(
  rulePath: string,
  currentFile: string,
  projectRoot: string | null,
): number {
  if (!projectRoot) {
    return 9999;
  }

  try {
    const ruleDir = dirname(rulePath);
    const currentDir = dirname(currentFile);

    const ruleRel = relative(projectRoot, ruleDir);
    const currentRel = relative(projectRoot, currentDir);

    if (ruleRel.startsWith('..') || currentRel.startsWith('..')) {
      return 9999;
    }

    // Split by both separators for cross-platform compatibility
    const ruleParts = ruleRel ? ruleRel.split(/[/\\]/) : [];
    const currentParts = currentRel ? currentRel.split(/[/\\]/) : [];

    let common = 0;
    for (let i = 0; i < Math.min(ruleParts.length, currentParts.length); i++) {
      if (ruleParts[i] === currentParts[i]) {
        common++;
      } else {
        break;
      }
    }

    return currentParts.length - common;
  } catch {
    return 9999;
  }
}

// Searches from currentFile upward to projectRoot, then ~/.claude/rules
export function findRuleFiles(
  projectRoot: string | null,
  homeDir: string,
  currentFile: string,
): RuleFileCandidate[] {
  const candidates: RuleFileCandidate[] = [];
  const seenRealPaths = new Set<string>();

  let currentDir = dirname(currentFile);
  let distance = 0;

  while (true) {
    for (const [parent, subdir] of PROJECT_RULE_SUBDIRS) {
      const ruleDir = join(currentDir, parent, subdir);
      const files: string[] = [];
      findRuleFilesRecursive(ruleDir, files);

      for (const filePath of files) {
        const realPath = safeRealpathSync(filePath);
        if (seenRealPaths.has(realPath)) continue;
        seenRealPaths.add(realPath);

        candidates.push({
          path: filePath,
          realPath,
          isGlobal: false,
          distance,
        });
      }
    }

    if (projectRoot && currentDir === projectRoot) break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
    distance++;
  }

  if (projectRoot) {
    for (const ruleFile of PROJECT_RULE_FILES) {
      const filePath = join(projectRoot, ruleFile);
      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            const realPath = safeRealpathSync(filePath);
            if (!seenRealPaths.has(realPath)) {
              seenRealPaths.add(realPath);
              candidates.push({
                path: filePath,
                realPath,
                isGlobal: false,
                distance: 0,
                isSingleFile: true,
              });
            }
          }
        } catch {}
      }
    }
  }

  const userRuleDir = join(homeDir, USER_RULE_DIR);
  const userFiles: string[] = [];
  findRuleFilesRecursive(userRuleDir, userFiles);

  for (const filePath of userFiles) {
    const realPath = safeRealpathSync(filePath);
    if (seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);

    candidates.push({
      path: filePath,
      realPath,
      isGlobal: true,
      distance: 9999, // Global rules always have max distance
    });
  }

  candidates.sort((a, b) => {
    if (a.isGlobal !== b.isGlobal) {
      return a.isGlobal ? 1 : -1;
    }
    return a.distance - b.distance;
  });

  return candidates;
}

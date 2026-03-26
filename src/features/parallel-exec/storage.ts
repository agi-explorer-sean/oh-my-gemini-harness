import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {z} from 'zod';
import type {OhMyGeminiConfig} from '../../config/schema';
import type {BackgroundManager} from '../background-agent';
import {
  ensureDir,
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
} from '../gemini-tasks/storage';
import {ParallelCoordinator} from './coordinator';
import {ParallelConfigSchema, ParallelTaskSchema} from './types';

const ParallelExecStateSchema = z.object({
  id: z.string(),
  parentSessionID: z.string(),
  parentMessageID: z.string(),
  directory: z.string(),
  config: ParallelConfigSchema,
  tasks: z.array(ParallelTaskSchema),
  activeTaskIds: z.array(z.string()),
});

export function getParallelExecDir(
  config: Partial<OhMyGeminiConfig> = {},
  projectDirectory?: string,
): string {
  // Use .sisyphus/parallel-execs by default
  const storagePath = config.sisyphus?.tasks?.storage_path
    ? join(dirname(config.sisyphus.tasks.storage_path), 'parallels')
    : '.sisyphus/parallel-execs';
  const baseDir = projectDirectory ?? process.cwd();
  return join(baseDir, storagePath);
}

export function saveParallelExec(
  coordinator: ParallelCoordinator,
  config: Partial<OhMyGeminiConfig> = {},
): void {
  const dir = getParallelExecDir(config, coordinator.directory);
  ensureDir(dir);
  const filePath = join(dir, `${coordinator.id}.json`);
  writeJsonAtomic(filePath, coordinator.toJSON());
}

export function getParallelExec(
  id: string,
  manager: BackgroundManager,
  config: Partial<OhMyGeminiConfig> = {},
  projectDirectory?: string,
): ParallelCoordinator | null {
  const dir = getParallelExecDir(config, projectDirectory);
  const filePath = join(dir, `${id}.json`);
  const data = readJsonSafe(filePath, ParallelExecStateSchema);
  if (!data) return null;
  return ParallelCoordinator.fromJSON(data, manager);
}

export function listParallelExecIds(
  config: Partial<OhMyGeminiConfig> = {},
  projectDirectory?: string,
): string[] {
  const dir = getParallelExecDir(config, projectDirectory);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

/**
 * Get the log directory for a specific parallel execution.
 * Creates the directory if it doesn't exist.
 */
export function getParallelLogDir(
  coordinatorId: string,
  projectDirectory: string,
  config: Partial<OhMyGeminiConfig> = {},
): string {
  const baseDir = getParallelExecDir(config, projectDirectory);
  const logDir = join(baseDir, 'logs', coordinatorId);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, {recursive: true});
  }
  return logDir;
}

/**
 * Write per-agent log files (stdout, stderr, metadata) for a completed task.
 */
export function writeAgentLogs(
  logDir: string,
  taskId: string,
  data: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    agent: string;
    description: string;
    promptLength: number;
    startedAt?: number;
    completedAt?: number;
  },
): void {
  const prefix = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    // Write stdout
    const tmpStdout = join(logDir, `${prefix}.stdout.log.tmp`);
    writeFileSync(tmpStdout, data.stdout);
    const {renameSync} = require('fs');
    renameSync(tmpStdout, join(logDir, `${prefix}.stdout.log`));

    // Write stderr
    const tmpStderr = join(logDir, `${prefix}.stderr.log.tmp`);
    writeFileSync(tmpStderr, data.stderr);
    renameSync(tmpStderr, join(logDir, `${prefix}.stderr.log`));

    // Write metadata
    const meta = {
      task_id: taskId,
      agent: data.agent,
      description: data.description,
      exit_code: data.exitCode,
      prompt_length: data.promptLength,
      started_at: data.startedAt,
      completed_at: data.completedAt,
    };
    const tmpMeta = join(logDir, `${prefix}.meta.json.tmp`);
    writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
    renameSync(tmpMeta, join(logDir, `${prefix}.meta.json`));
  } catch {
    // Non-critical — logging failure should not affect task execution
  }
}

/**
 * MCP tools for persistent worker processes in parallel_exec.
 *
 * When a gemini process is spawned with OMG_WORKER_ID set, these tools
 * let the model pull tasks from a file-based queue and report results back.
 * The MCP stdio transport ensures proper message framing (no stdout buffering).
 *
 * Queue protocol:
 *   tasks file:   { tasks: [{id, prompt, description}], nextIndex: 0 }
 *   results file: { results: [{id, output, status, error?}] }
 *
 * The coordinator writes the tasks file before spawning; the model loops
 * calling worker_get_task → execute → worker_report_result until DONE.
 */

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {tool, type ToolDefinition} from '@opencode-ai/plugin/tool';
import {log} from '../../shared/logger';

/** Env var set by MqWorkerPool to enable these tools */
const WORKER_ID_ENV = 'OMG_WORKER_ID';

/** Directory for queue files */
const QUEUE_DIR_ENV = 'OMG_WORKER_QUEUE_DIR';

function getQueuePaths(): {tasksFile: string; resultsFile: string} | null {
  const workerId = process.env[WORKER_ID_ENV];
  const queueDir = process.env[QUEUE_DIR_ENV] || '/tmp';
  if (!workerId) return null;
  return {
    tasksFile: `${queueDir}/omg-worker-${workerId}-tasks.json`,
    resultsFile: `${queueDir}/omg-worker-${workerId}-results.json`,
  };
}

interface TaskQueueFile {
  tasks: Array<{id: string; prompt: string; description: string}>;
  nextIndex: number;
}

interface ResultsFile {
  results: Array<{
    id: string;
    output?: string;
    status: 'completed' | 'failed';
    error?: string;
  }>;
}

function readTaskQueue(path: string): TaskQueueFile | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as TaskQueueFile;
  } catch {
    return null;
  }
}

function writeTaskQueue(path: string, queue: TaskQueueFile): void {
  writeFileSync(path, JSON.stringify(queue, null, 2));
}

function readResults(path: string): ResultsFile {
  try {
    if (!existsSync(path)) return {results: []};
    return JSON.parse(readFileSync(path, 'utf-8')) as ResultsFile;
  } catch {
    return {results: []};
  }
}

function writeResults(path: string, results: ResultsFile): void {
  writeFileSync(path, JSON.stringify(results, null, 2));
}

/** Check if worker tools should be registered */
export function isWorkerMode(): boolean {
  return !!process.env[WORKER_ID_ENV];
}

export function createWorkerGetTaskTool(): ToolDefinition {
  return tool({
    description: `Get the next task to execute from the work queue.

Call this tool to receive your next task. Execute the task's prompt, then call worker_report_result with the outcome. Repeat until this tool returns done=true.

IMPORTANT: Execute each task's prompt exactly as given. After completing each task, immediately call worker_report_result before getting the next task.`,
    args: {},
    async execute() {
      const paths = getQueuePaths();
      if (!paths) return 'Error: not in worker mode';

      const queue = readTaskQueue(paths.tasksFile);
      if (!queue) return 'Error: task queue file not found';

      if (queue.nextIndex >= queue.tasks.length) {
        log(`[worker] All tasks consumed (${queue.tasks.length} total)`);
        return JSON.stringify({done: true, message: 'All tasks completed. You can stop now.'});
      }

      const task = queue.tasks[queue.nextIndex];
      queue.nextIndex++;
      writeTaskQueue(paths.tasksFile, queue);

      log(`[worker] Dispatching task ${queue.nextIndex}/${queue.tasks.length}: ${task.description}`);
      return JSON.stringify({
        done: false,
        task_id: task.id,
        description: task.description,
        prompt: task.prompt,
        remaining: queue.tasks.length - queue.nextIndex,
      });
    },
  });
}

export function createWorkerReportResultTool(): ToolDefinition {
  return tool({
    description: `Report the result of a completed task.

Call this after executing a task from worker_get_task. Then call worker_get_task again for the next task.`,
    args: {
      task_id: tool.schema
        .string()
        .describe('The task_id from worker_get_task'),
      output: tool.schema
        .string()
        .describe('The output or result of executing the task'),
      status: tool.schema
        .enum(['completed', 'failed'])
        .describe('Whether the task succeeded or failed'),
      error: tool.schema
        .string()
        .optional()
        .describe('Error message if status is failed'),
    },
    async execute(args: {
      task_id: string;
      output: string;
      status: 'completed' | 'failed';
      error?: string;
    }) {
      const paths = getQueuePaths();
      if (!paths) return 'Error: not in worker mode';

      const results = readResults(paths.resultsFile);
      results.results.push({
        id: args.task_id,
        output: args.output,
        status: args.status,
        error: args.error,
      });
      writeResults(paths.resultsFile, results);

      log(
        `[worker] Result reported: ${args.task_id} → ${args.status}` +
          (args.status === 'completed'
            ? ` (${args.output?.length ?? 0} chars)`
            : ` (${args.error})`),
      );

      return `Result recorded. Call worker_get_task for the next task.`;
    },
  });
}

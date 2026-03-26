/**
 * Direct API Worker Pool for parallel_exec (read_only mode).
 *
 * Instead of spawning gemini CLI processes (each requiring SAR extraction,
 * proxy startup, MCP server loading, and TUI initialization), this pool
 * makes direct HTTP API calls to the Gemini proxy at GOOGLE_GEMINI_BASE_URL.
 *
 * Key advantages over SubAgentPool and process-based approaches:
 * - Zero cold start (no process spawning at all)
 * - True parallel execution (concurrent HTTP requests)
 * - Clean JSON responses (no TUI output parsing)
 * - No temp files, no bash scripts, no process management
 * - Concurrency-limited to prevent proxy overload
 *
 * The proxy at GOOGLE_GEMINI_BASE_URL handles authentication and optionally
 * Claude model translation (via the oh-my-gemini model proxy layer).
 *
 * Configuration:
 *   OMG_PARALLEL_MODEL      - Model name (default: gemini-2.5-flash)
 *   OMG_PARALLEL_API_PREFIX - API path prefix (default: /v1main)
 *
 * ---
 *
 * Expect Worker Pool for parallel_exec (read_write mode).
 *
 * Uses `expect` (TCL) to keep N persistent gemini CLI processes alive via PTY.
 * Tasks are distributed among workers upfront; each worker handles its batch
 * sequentially within the same process, eliminating cold starts for waves 2+.
 *
 * Key advantages over SubAgentPool:
 * - Each gemini process handles multiple tasks (no restart between tasks)
 * - Only N cold starts total instead of N*tasks_per_worker
 * - Prompts written to temp files (avoids all escaping issues)
 * - Sentinel-based output parsing for reliable result extraction
 */

import {log} from '../../shared/logger';

/** Per-task timeout in milliseconds */
const TASK_TIMEOUT_MS = 300_000; // 5 minutes

/** Default model for parallel API calls */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Default API path prefix (matches Google AI SDK format used by gemini_api_proxy) */
const DEFAULT_API_PREFIX = '/v1beta';

/** Default max output tokens */
const DEFAULT_MAX_OUTPUT_TOKENS = 65536;

export interface PersistentTaskInput {
  id: string;
  prompt: string;
  description: string;
}

export interface PersistentTaskResult {
  id: string;
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
}

export class PersistentWorkerPool {
  private results: Map<string, PersistentTaskResult> = new Map();
  private reportedIds: Set<string> = new Set();
  private tasks: PersistentTaskInput[] = [];
  private maxConcurrency: number;
  private baseUrl: string;
  private model: string;
  private apiPrefix: string;
  private apiKey: string;
  private activeFetches: number = 0;
  private taskQueue: PersistentTaskInput[] = [];

  constructor(options: {
    directory: string;
    numWorkers: number;
    proxyAddress?: string;
  }) {
    this.maxConcurrency = options.numWorkers;
    this.baseUrl = (
      options.proxyAddress ||
      process.env.GOOGLE_GEMINI_BASE_URL ||
      ''
    ).replace(/\/+$/, '');
    this.model = process.env.OMG_PARALLEL_MODEL || DEFAULT_MODEL;
    this.apiPrefix = process.env.OMG_PARALLEL_API_PREFIX || DEFAULT_API_PREFIX;
    this.apiKey = process.env.GEMINI_API_KEY || '';
  }

  /**
   * Check if direct API mode is viable:
   * - Proxy address must be set (provides authenticated API access)
   */
  static isAvailable(): boolean {
    return !!process.env.GOOGLE_GEMINI_BASE_URL && !!process.env.GEMINI_API_KEY;
  }

  /**
   * Store tasks for execution. No temp files or scripts needed —
   * prompts are sent directly as JSON in the API request body.
   */
  prepare(tasks: PersistentTaskInput[]): void {
    this.tasks = [...tasks];
    this.taskQueue = [...tasks];
    log(
      `[persistent-pool] Prepared ${tasks.length} tasks for direct API ` +
        `(model=${this.model}, concurrency=${this.maxConcurrency})`,
    );
  }

  /**
   * Launch all tasks as concurrent HTTP API calls with concurrency limiting.
   * Returns immediately — tasks execute asynchronously.
   */
  async start(): Promise<{ready: number; failed: number}> {
    if (!this.baseUrl) {
      for (const task of this.tasks) {
        this.results.set(task.id, {
          id: task.id,
          status: 'failed',
          error: 'No proxy base URL configured',
        });
      }
      return {ready: 0, failed: this.tasks.length};
    }

    // Launch first batch of concurrent tasks
    this.launchNextBatch();

    log(
      `[persistent-pool] Started: ${this.tasks.length} tasks, ` +
        `url=${this.baseUrl}${this.apiPrefix}/models/${this.model}:generateContent`,
    );
    return {ready: this.tasks.length, failed: 0};
  }

  /** Non-blocking poll — return newly completed task results */
  poll(): PersistentTaskResult[] {
    const newResults: PersistentTaskResult[] = [];
    for (const [id, result] of this.results) {
      if (!this.reportedIds.has(id)) {
        this.reportedIds.add(id);
        newResults.push(result);
      }
    }
    return newResults;
  }

  /** Are all tasks finished (completed or failed)? */
  isFinished(): boolean {
    return this.results.size === this.tasks.length;
  }

  /** Nothing to clean up — no processes, no temp files */
  async drain(): Promise<void> {
    // Direct API mode has no persistent resources to clean up
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Launch tasks up to the concurrency limit, backfilling as tasks complete */
  private launchNextBatch(): void {
    while (
      this.activeFetches < this.maxConcurrency &&
      this.taskQueue.length > 0
    ) {
      const task = this.taskQueue.shift()!;
      this.activeFetches++;
      this.executeTask(task).then((result) => {
        this.results.set(result.id, result);
        this.activeFetches--;
        this.launchNextBatch();
      });
    }
  }

  /** Execute a single task via the Gemini generateContent API */
  private async executeTask(
    task: PersistentTaskInput,
  ): Promise<PersistentTaskResult> {
    const url =
      `${this.baseUrl}${this.apiPrefix}/models/` +
      `${encodeURIComponent(this.model)}:generateContent`;

    log(`[persistent-pool] → ${task.id}: ${task.description}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['x-goog-api-key'] = this.apiKey;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{role: 'user', parts: [{text: task.prompt}]}],
          generationConfig: {
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            temperature: 0.1,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errorBody = await resp.text().catch(() => '(unreadable)');
        return {
          id: task.id,
          status: 'failed',
          error: `API ${resp.status}: ${errorBody.slice(0, 500)}`,
        };
      }

      const json = (await resp.json()) as {
        candidates?: Array<{
          content?: {parts?: Array<{text?: string}>};
          finishReason?: string;
        }>;
        error?: {message?: string; code?: number; status?: string};
      };

      if (json.error) {
        return {
          id: task.id,
          status: 'failed',
          error: `API error: ${json.error.message ?? JSON.stringify(json.error)}`,
        };
      }

      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p): p is {text: string} => !!p.text)
        .map((p) => p.text)
        .join('');

      if (!text) {
        return {
          id: task.id,
          status: 'failed',
          error: `Empty response (finishReason=${json.candidates?.[0]?.finishReason ?? 'unknown'})`,
        };
      }

      log(`[persistent-pool] ✓ ${task.id}: ${text.length} chars`);
      return {
        id: task.id,
        status: 'completed',
        output: text,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: task.id,
        status: 'failed',
        error: msg.includes('abort') ? 'timeout (5min)' : msg,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Batch Subprocess Pool (read_write mode)
// ---------------------------------------------------------------------------
//
// Runs N concurrent worker "lanes", each processing its share of tasks
// sequentially using one-shot `gemini -p "prompt"` invocations. Each
// invocation produces a single JSON response on stdout (via --output-format
// json) and exits. No persistent process, no interactive mode, no PTY.
//
// Key advantages over SubAgentPool + BackgroundManager:
// - Bypasses BackgroundManager overhead (task registration, notifications)
// - Direct JSON output parsing (clean, no TUI)
// - Simple process lifecycle (spawn → wait for exit → read stdout)
// - Shared proxy eliminates per-process proxy startup (~5s savings)

/** Per-task timeout in milliseconds */
const BATCH_TASK_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Parse a JSON response from gemini CLI `--output-format json`.
 * The response field contains the model's text output.
 */
export function parseGeminiJsonResponse(
  json: string,
): {response?: string; error?: string} {
  try {
    const parsed = JSON.parse(json);
    if (parsed.response !== undefined) {
      return {response: String(parsed.response)};
    }
    if (parsed.error) {
      return {error: String(parsed.error.message || parsed.error)};
    }
    return {response: JSON.stringify(parsed)};
  } catch (e) {
    return {error: `JSON parse error: ${(e as Error).message}`};
  }
}

export class ExpectWorkerPool {
  private results: Map<string, PersistentTaskResult> = new Map();
  private reportedIds: Set<string> = new Set();
  private tasks: PersistentTaskInput[] = [];
  private workerPromises: Promise<void>[] = [];
  private directory: string;
  private numWorkers: number;
  private geminiPath: string;
  private proxyAddress?: string;

  constructor(options: {
    directory: string;
    numWorkers: number;
    geminiPath: string;
    proxyAddress?: string;
  }) {
    this.directory = options.directory;
    this.numWorkers = options.numWorkers;
    this.geminiPath = options.geminiPath;
    this.proxyAddress = options.proxyAddress;
  }

  /** Always available — uses Bun.spawn (no external dependencies) */
  static isAvailable(): boolean {
    return true;
  }

  /** Store tasks for execution */
  prepare(tasks: PersistentTaskInput[]): void {
    this.tasks = [...tasks];
    log(
      `[batch-pool] Prepared ${tasks.length} tasks across ${this.numWorkers} workers`,
    );
  }

  /** Start N worker lanes, each processing its batch of tasks sequentially */
  async start(): Promise<{ready: number; failed: number}> {
    // Distribute tasks round-robin
    const batches: PersistentTaskInput[][] = Array.from(
      {length: this.numWorkers},
      () => [],
    );
    for (let i = 0; i < this.tasks.length; i++) {
      batches[i % this.numWorkers].push(this.tasks[i]);
    }

    let ready = 0;
    for (let w = 0; w < this.numWorkers; w++) {
      const batch = batches[w];
      if (batch.length === 0) continue;
      this.workerPromises.push(this.runWorkerLane(w, batch));
      ready++;
    }

    log(`[batch-pool] Started ${ready} worker lanes`);
    return {ready, failed: 0};
  }

  /** Non-blocking poll — return newly completed task results */
  poll(): PersistentTaskResult[] {
    const newResults: PersistentTaskResult[] = [];
    for (const [id, result] of this.results) {
      if (!this.reportedIds.has(id)) {
        this.reportedIds.add(id);
        newResults.push(result);
      }
    }
    return newResults;
  }

  /** Are all tasks finished? */
  isFinished(): boolean {
    return this.results.size === this.tasks.length;
  }

  /** Nothing to clean up — processes are one-shot */
  async drain(): Promise<void> {
    // Wait for any remaining worker lanes to finish
    await Promise.allSettled(this.workerPromises);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Run a single worker lane: execute tasks sequentially with one-shot gemini */
  private async runWorkerLane(
    workerIdx: number,
    batch: PersistentTaskInput[],
  ): Promise<void> {
    for (let i = 0; i < batch.length; i++) {
      const task = batch[i];
      log(
        `[batch-pool] Worker ${workerIdx} → task ${i + 1}/${batch.length}: ${task.description}`,
      );

      try {
        const result = await this.executeOneShot(task);
        this.results.set(task.id, result);
        log(
          `[batch-pool] ${result.status === 'completed' ? '✓' : '✗'} ${task.id}: ${
            result.status === 'completed'
              ? `${result.output?.length ?? 0} chars`
              : result.error
          }`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.results.set(task.id, {
          id: task.id,
          status: 'failed',
          error: msg,
        });
        log(`[batch-pool] ✗ ${task.id}: ${msg}`);
      }
    }

    log(`[batch-pool] Worker ${workerIdx} completed ${batch.length} tasks`);
  }

  /** Execute a single task using one-shot gemini -p "prompt" */
  private async executeOneShot(
    task: PersistentTaskInput,
  ): Promise<PersistentTaskResult> {
    const args = [
      this.geminiPath,
      ...(this.proxyAddress
        ? [`--proxy_address=${this.proxyAddress}`]
        : []),
      '--output-format', 'json',
      '--', '-y', '-e', '__none__',
      '-p', task.prompt,
    ];

    const proc = Bun.spawn(args, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: this.directory,
      env: {
        ...process.env,
        GLOG_minloglevel: '2',
        OMG_PARENT_AGENT: 'batch-pool',
      },
    });

    // Race: process exit vs timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        try { proc.kill(); } catch {}
        reject(new Error('timeout (5min)'));
      }, BATCH_TASK_TIMEOUT_MS),
    );

    try {
      await Promise.race([proc.exited, timeoutPromise]);
    } catch (err) {
      return {
        id: task.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Read stdout (JSON response is flushed on process exit)
    const stdout = await new Response(proc.stdout).text();

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        id: task.id,
        status: 'failed',
        error: `Exit code ${proc.exitCode}: ${stderr.slice(0, 500)}`,
      };
    }

    // Parse JSON response — may be pretty-printed across multiple lines.
    // Find the outermost JSON object by matching braces.
    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) {
      return {
        id: task.id,
        status: 'failed',
        error: `No JSON in output (${stdout.length} bytes)`,
      };
    }

    // Find matching closing brace
    let depth = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < stdout.length; i++) {
      if (stdout[i] === '{') depth++;
      else if (stdout[i] === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }

    if (jsonEnd === -1) {
      return {
        id: task.id,
        status: 'failed',
        error: `Incomplete JSON in output`,
      };
    }

    const jsonStr = stdout.slice(jsonStart, jsonEnd);
    const parsed = parseGeminiJsonResponse(jsonStr);
    if (parsed.response) {
      return {id: task.id, status: 'completed', output: parsed.response};
    }
    if (parsed.error) {
      return {id: task.id, status: 'failed', error: parsed.error};
    }

    return {
      id: task.id,
      status: 'failed',
      error: `No response field in JSON`,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Queue Worker Pool (read_write mode, persistent processes)
// ---------------------------------------------------------------------------
//
// Spawns N persistent gemini CLI processes, each looping via MCP tools:
//   worker_get_task → execute prompt → worker_report_result → repeat
//
// One cold start per worker. Tasks communicated via temp JSON files,
// avoiding stdout buffering issues (MCP uses Content-Length framing).

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

interface MqTaskQueueFile {
  tasks: Array<{id: string; prompt: string; description: string}>;
  nextIndex: number;
}

interface MqResultsFile {
  results: Array<{
    id: string;
    output?: string;
    status: 'completed' | 'failed';
    error?: string;
  }>;
}

/** Per-worker timeout: 5 minutes per task × max tasks per worker */
const MQ_WORKER_TIMEOUT_MS = 600_000; // 10 minutes per worker

export class MqWorkerPool {
  private results: Map<string, PersistentTaskResult> = new Map();
  private reportedIds: Set<string> = new Set();
  private tasks: PersistentTaskInput[] = [];
  private workerPromises: Promise<void>[] = [];
  private directory: string;
  private numWorkers: number;
  private geminiPath: string;
  private proxyAddress?: string;
  private queueDir: string;
  private workerIds: string[] = [];

  constructor(options: {
    directory: string;
    numWorkers: number;
    geminiPath: string;
    proxyAddress?: string;
  }) {
    this.directory = options.directory;
    this.numWorkers = options.numWorkers;
    this.geminiPath = options.geminiPath;
    this.proxyAddress = options.proxyAddress;
    this.queueDir = join('/tmp', `omg-mq-${Date.now()}`);
  }

  static isAvailable(): boolean {
    return true;
  }

  prepare(tasks: PersistentTaskInput[]): void {
    this.tasks = [...tasks];

    // Create queue directory
    mkdirSync(this.queueDir, {recursive: true});

    // Distribute tasks round-robin and write queue files
    const batches: PersistentTaskInput[][] = Array.from(
      {length: this.numWorkers},
      () => [],
    );
    for (let i = 0; i < tasks.length; i++) {
      batches[i % this.numWorkers].push(tasks[i]);
    }

    for (let w = 0; w < this.numWorkers; w++) {
      const workerId = `${w}-${randomUUID().slice(0, 8)}`;
      this.workerIds.push(workerId);

      const queueFile: MqTaskQueueFile = {
        tasks: batches[w].map((t) => ({
          id: t.id,
          prompt: t.prompt,
          description: t.description,
        })),
        nextIndex: 0,
      };
      writeFileSync(
        join(this.queueDir, `omg-worker-${workerId}-tasks.json`),
        JSON.stringify(queueFile, null, 2),
      );

      // Initialize empty results file
      const resultsFile: MqResultsFile = {results: []};
      writeFileSync(
        join(this.queueDir, `omg-worker-${workerId}-results.json`),
        JSON.stringify(resultsFile),
      );
    }

    log(
      `[mq-pool] Prepared ${tasks.length} tasks across ${this.numWorkers} workers ` +
        `(queue dir: ${this.queueDir})`,
    );
  }

  async start(): Promise<{ready: number; failed: number}> {
    let ready = 0;
    for (let w = 0; w < this.numWorkers; w++) {
      const batch = this.tasks.filter((_, i) => i % this.numWorkers === w);
      if (batch.length === 0) continue;
      this.workerPromises.push(this.runWorker(w));
      ready++;
    }

    log(`[mq-pool] Started ${ready} persistent workers`);
    return {ready, failed: 0};
  }

  poll(): PersistentTaskResult[] {
    // Read results from all worker result files
    for (const workerId of this.workerIds) {
      const resultsPath = join(
        this.queueDir,
        `omg-worker-${workerId}-results.json`,
      );
      try {
        if (!existsSync(resultsPath)) continue;
        const data = JSON.parse(
          readFileSync(resultsPath, 'utf-8'),
        ) as MqResultsFile;
        for (const result of data.results) {
          if (!this.results.has(result.id)) {
            this.results.set(result.id, {
              id: result.id,
              status: result.status,
              output: result.output,
              error: result.error,
            });
          }
        }
      } catch {
        // File may be mid-write, skip this poll cycle
      }
    }

    const newResults: PersistentTaskResult[] = [];
    for (const [id, result] of this.results) {
      if (!this.reportedIds.has(id)) {
        this.reportedIds.add(id);
        newResults.push(result);
      }
    }
    return newResults;
  }

  isFinished(): boolean {
    return this.results.size >= this.tasks.length;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.workerPromises);
    // Clean up queue files
    try {
      const {rmSync} = await import('node:fs');
      rmSync(this.queueDir, {recursive: true, force: true});
    } catch {
      // Best effort cleanup
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runWorker(workerIdx: number): Promise<void> {
    const workerId = this.workerIds[workerIdx];
    const taskCount = this.tasks.filter(
      (_, i) => i % this.numWorkers === workerIdx,
    ).length;

    log(
      `[mq-pool] Worker ${workerIdx} starting (${taskCount} tasks, id=${workerId})`,
    );

    const prompt =
      `You are a task worker. Your job is to execute tasks one at a time using the worker_get_task and worker_report_result tools.\n\n` +
      `INSTRUCTIONS:\n` +
      `1. Call worker_get_task to get your next task\n` +
      `2. Read the task's prompt and execute it exactly (run shell commands, write files, etc.)\n` +
      `3. Call worker_report_result with the task_id, output, and status\n` +
      `4. Repeat from step 1 until worker_get_task returns done=true\n` +
      `5. When done=true, stop immediately\n\n` +
      `IMPORTANT: Do NOT skip any steps. Do NOT summarize or explain. Just execute each task's prompt and report the result. Start now by calling worker_get_task.`;

    const args = [
      this.geminiPath,
      ...(this.proxyAddress
        ? [`--proxy_address=${this.proxyAddress}`]
        : []),
      '--',
      '-y',
      '-e',
      'oh-my-gemini',
      '-p',
      prompt,
    ];

    const proc = Bun.spawn(args, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: this.directory,
      env: {
        ...process.env,
        GLOG_minloglevel: '2',
        OMG_PARENT_AGENT: 'mq-pool',
        OMG_WORKER_ID: workerId,
        OMG_WORKER_QUEUE_DIR: this.queueDir,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        reject(new Error(`Worker ${workerIdx} timeout`));
      }, MQ_WORKER_TIMEOUT_MS),
    );

    try {
      await Promise.race([proc.exited, timeoutPromise]);
    } catch (err) {
      log(
        `[mq-pool] Worker ${workerIdx}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Read any remaining results from the file
    const resultsPath = join(
      this.queueDir,
      `omg-worker-${workerId}-results.json`,
    );
    try {
      if (existsSync(resultsPath)) {
        const data = JSON.parse(
          readFileSync(resultsPath, 'utf-8'),
        ) as MqResultsFile;
        for (const result of data.results) {
          if (!this.results.has(result.id)) {
            this.results.set(result.id, {
              id: result.id,
              status: result.status,
              output: result.output,
              error: result.error,
            });
          }
        }
      }
    } catch {
      // Best effort
    }

    // Mark any unfinished tasks as failed
    const tasksPath = join(
      this.queueDir,
      `omg-worker-${workerId}-tasks.json`,
    );
    try {
      if (existsSync(tasksPath)) {
        const queue = JSON.parse(
          readFileSync(tasksPath, 'utf-8'),
        ) as MqTaskQueueFile;
        for (const task of queue.tasks) {
          if (!this.results.has(task.id)) {
            this.results.set(task.id, {
              id: task.id,
              status: 'failed',
              error: `Worker ${workerIdx} exited before completing this task`,
            });
          }
        }
      }
    } catch {
      // Best effort
    }

    // Capture stderr tail for debugging
    let stderrTail = '';
    try {
      const stderrText = await new Response(proc.stderr).text();
      const lines = stderrText.trim().split('\n');
      stderrTail = lines.slice(-3).join(' | ');
    } catch {
      // Best effort
    }

    const completedCount = this.results.size;
    log(
      `[mq-pool] Worker ${workerIdx} exited (exit=${proc.exitCode}, results so far: ${completedCount}/${this.tasks.length})` +
        (proc.exitCode !== 0 && stderrTail
          ? ` stderr: ${stderrTail.slice(0, 200)}`
          : ''),
    );
  }
}

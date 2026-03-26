import type {PluginInput} from '@opencode-ai/plugin';
import type {BackgroundTaskConfig} from '../../config/schema';
import {
  createOpencodeClient,
  getAgentToolRestrictions,
  log,
  type OpencodeClient,
  promptWithModelSuggestionRetry,
  resolveFileReferencesInText,
} from '../../shared';
import {ConcurrencyManager} from './concurrency';
import {
  DEFAULT_STALE_TIMEOUT_MS,
  MIN_IDLE_TIME_MS,
  MIN_RUNTIME_BEFORE_STALE_MS,
  MIN_STABILITY_TIME_MS,
  POLLING_INTERVAL_MS,
  TASK_CLEANUP_DELAY_MS,
  TASK_TTL_MS,
} from './constants';
import type {
  BackgroundTask,
  CompositeBackgroundTask,
  LaunchInput,
  ResumeInput,
} from './types';

import {existsSync, readdirSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {subagentSessions} from '../claude-code-session-state';
import {writeNotification} from '../../hooks/background-notification/after-agent';
import {
  findNearestMessageWithFields,
  MESSAGE_STORAGE,
} from '../hook-message-injector';
import {getTaskToastManager} from '../task-toast-manager';
import {findGeminiPath} from '../../tools/delegate-task/executor';
import {writeAgentLogs} from '../parallel-exec/storage';

const SUBPROCESS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SIGKILL_DELAY_MS = 5000; // 5 seconds after SIGTERM before SIGKILL
/** Prompts larger than this are piped via stdin instead of -p arg (avoids E2BIG) */
const STDIN_PROMPT_THRESHOLD = 100_000; // 100KB

type ProcessCleanupEvent = NodeJS.Signals | 'beforeExit' | 'exit';

/**
 * Interface for the ParallelCoordinator to avoid circular dependencies
 */
interface IParallelCoordinator {
  id: string;
  start(): Promise<void>;
  poll(): Promise<boolean>;
  stop(): void;
  getProgress(): any;
  getResults(): any[];
  cleanup(): Promise<void>;
}

interface MessagePartInfo {
  sessionID?: string;
  type?: string;
  tool?: string;
}

interface EventProperties {
  sessionID?: string;
  info?: {id?: string};
  [key: string]: unknown;
}

interface Event {
  type: string;
  properties?: EventProperties;
}

interface Todo {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface QueueItem {
  task: BackgroundTask;
  input: LaunchInput;
}

export class BackgroundManager {
  private static cleanupManagers = new Set<BackgroundManager>();
  private static cleanupRegistered = false;
  private static cleanupHandlers = new Map<ProcessCleanupEvent, () => void>();

  private tasks: Map<string, BackgroundTask>;
  private parallelExecs: Map<string, IParallelCoordinator> = new Map();
  private notifications: Map<string, BackgroundTask[]>;
  private pendingByParent: Map<string, Set<string>>; // Track pending tasks per parent for batching
  private client: OpencodeClient;
  private freshClient: OpencodeClient;
  private directory: string;
  private serverUrl: URL;
  private pollingInterval?: ReturnType<typeof setInterval>;
  private concurrencyManager: ConcurrencyManager;
  private shutdownTriggered = false;
  private config?: BackgroundTaskConfig;
  private onShutdown?: () => void;
  /** Whether the opencode session API server is available. Checked once at
   *  construction time — Gemini CLI never has one, so per-task checks are
   *  unnecessary overhead. */
  private useSubprocessMode: boolean;

  private subprocesses: Map<string, ReturnType<typeof Bun.spawn>> = new Map();
  private queuesByKey: Map<string, QueueItem[]> = new Map();
  private processingKeys: Set<string> = new Set();
  private completionTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private isPolling = false;

  constructor(
    ctx: PluginInput,
    config?: BackgroundTaskConfig,
    options?: {
      onShutdown?: () => void;
      /** Pre-computed server availability from startup check. When false
       *  (default), all tasks use subprocess mode — no per-task health
       *  checks are performed. */
      serverRunning?: boolean;
    },
  ) {
    this.tasks = new Map();
    this.notifications = new Map();
    this.pendingByParent = new Map();
    this.client = ctx.client;
    this.directory = ctx.directory;
    this.serverUrl = ctx.serverUrl;
    this.useSubprocessMode = !(options?.serverRunning ?? false);

    // Sanitize baseUrl to avoid double slashes when the SDK appends paths
    let baseUrlStr = this.serverUrl?.toString() ?? 'http://localhost:4097';
    if (baseUrlStr.endsWith('/')) {
      baseUrlStr = baseUrlStr.slice(0, -1);
    }

    this.freshClient = createOpencodeClient({
      baseUrl: baseUrlStr,
      directory: this.directory,
    } as any);
    this.concurrencyManager = new ConcurrencyManager(config);
    this.config = config;
    this.onShutdown = options?.onShutdown;
    this.registerProcessCleanup();
    if (!(ctx as any).isDispatch) {
      this.loadParallelExecs().catch((err) => {
        log(`[background-agent] Failed to load parallels: ${err}`);
      });
    }
  }

  private async loadParallelExecs(): Promise<void> {
    // Dynamic import to avoid circular dependency
    const {listParallelExecIds, getParallelExec} = await import(
      '../parallel-exec/storage'
    );
    const ids = listParallelExecIds(
      {sisyphus: {tasks: {storage_path: '.sisyphus/parallel-execs'}}} as any,
      this.directory,
    );

    for (const id of ids) {
      const coordinator = getParallelExec(
        id,
        this as any,
        {sisyphus: {tasks: {storage_path: '.sisyphus/parallel-execs'}}} as any,
        this.directory,
      );
      if (coordinator) {
        const results = coordinator.getResults();
        const isRunning = results.some(
          (r) =>
            r.status === 'pending' ||
            r.status === 'queued' ||
            r.status === 'running',
        );

        if (isRunning) {
          log(`[background-agent] Re-hydrating parallel: ${id}`);
          const json = coordinator.toJSON();
          const subTaskIds = results
            .filter((r) => r.taskId)
            .map((r) => r.taskId!);

          const task: CompositeBackgroundTask = {
            id: coordinator.id,
            type: 'parallel_exec',
            status: 'running',
            description: `Parallel Execution: ${results.length} tasks (Restored)`,
            parentSessionID: json.parentSessionID,
            parentMessageID: json.parentMessageID,
            prompt: '',
            agent: 'parallel',
            startedAt: new Date(),
            subTaskIds,
            parallelConfig: json.config,
          };
          this.tasks.set(task.id, task);
          this.parallelExecs.set(task.id, coordinator);

          // Re-hydrate sub-tasks
          for (const res of results) {
            if (
              res.taskId &&
              (res.status === 'running' ||
                res.status === 'pending' ||
                res.status === 'queued')
            ) {
              const subTask: BackgroundTask = {
                id: res.taskId,
                type: 'task',
                status: 'running', // Map to running for polling
                description: res.description,
                prompt: res.prompt,
                agent: res.agent ?? 'sisyphus-junior',
                parentSessionID: json.parentSessionID,
                parentMessageID: json.parentMessageID,
                startedAt: res.startTime ? new Date(res.startTime) : new Date(),
                sessionID: `mcp-restored-${Math.random().toString(36).substring(2, 10)}`, // Fallback for MCP environment
              };
              this.tasks.set(subTask.id, subTask);
              log(
                `[background-agent] Re-hydrated sub-task: ${subTask.id} for parallel ${id}`,
              );
            }
          }

          this.startPolling();

          coordinator.start().catch(() => {});
        }
      }
    }
  }

  async registerParallelExec(
    coordinator: IParallelCoordinator,
    metadata: {
      description: string;
      parentSessionID: string;
      parentMessageID: string;
      parallelConfig?: any;
    },
  ): Promise<CompositeBackgroundTask> {
    const task: CompositeBackgroundTask = {
      id: coordinator.id,
      type: 'parallel_exec',
      status: 'running',
      description: metadata.description,
      parentSessionID: metadata.parentSessionID,
      parentMessageID: metadata.parentMessageID,
      prompt: '',
      agent: 'parallel',
      startedAt: new Date(),
      subTaskIds: [],
      parallelConfig: metadata.parallelConfig,
    };

    this.tasks.set(task.id, task);
    this.parallelExecs.set(task.id, coordinator);

    if (metadata.parentSessionID) {
      const pending =
        this.pendingByParent.get(metadata.parentSessionID) ?? new Set();
      pending.add(task.id);
      this.pendingByParent.set(metadata.parentSessionID, pending);
    }

    this.startPolling();
    this.persistTaskState();

    log('[background-agent] Parallel execution registered:', {taskId: task.id});

    await coordinator.start().catch((err) => {
      log(`[background-agent] Failed to start parallel ${task.id}:`, err);
    });

    return task;
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log('[background-agent] launch() called with:', {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionID,
    });

    if (!input.agent || input.agent.trim() === '') {
      throw new Error('Agent parameter is required');
    }

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      status: 'pending',
      queuedAt: new Date(),
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      parentModel: input.parentModel,
      parentAgent: input.parentAgent,
      model: input.model,
      category: input.category,
      skipNotification: input.skipNotification,
    };

    this.tasks.set(task.id, task);

    if (input.parentSessionID) {
      const pending =
        this.pendingByParent.get(input.parentSessionID) ?? new Set();
      pending.add(task.id);
      this.pendingByParent.set(input.parentSessionID, pending);
    }

    const key = this.getConcurrencyKeyFromInput(input);
    const queue = this.queuesByKey.get(key) ?? [];
    queue.push({task, input});
    this.queuesByKey.set(key, queue);

    log('[background-agent] Task queued:', {
      taskId: task.id,
      key,
      queueLength: queue.length,
    });

    const toastManager = getTaskToastManager();
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: input.description,
        agent: input.agent,
        isBackground: true,
        status: 'queued',
        skills: input.skills,
      });
    }

    this.processKey(key);

    return task;
  }

  private async processKey(key: string): Promise<void> {
    if (this.processingKeys.has(key)) {
      return;
    }

    this.processingKeys.add(key);

    try {
      const queue = this.queuesByKey.get(key);
      while (queue && queue.length > 0) {
        const item = queue[0];

        await this.concurrencyManager.acquire(key, item.input.concurrencyOverride);

        if (item.task.status === 'cancelled') {
          this.concurrencyManager.release(key);
          queue.shift();
          continue;
        }

        try {
          await this.startTask(item);
        } catch (error) {
          log('[background-agent] Error starting task:', error);
          // Release concurrency slot if startTask failed and didn't release it itself
          // This prevents slot leaks when errors occur after acquire but before task.concurrencyKey is set
          if (!item.task.concurrencyKey) {
            this.concurrencyManager.release(key);
          }
        }

        queue.shift();
      }
    } finally {
      this.processingKeys.delete(key);
    }
  }

  private async startTask(item: QueueItem): Promise<void> {
    const {task, input} = item;

    log('[background-agent] Starting task:', {
      taskId: task.id,
      agent: input.agent,
      model: input.model,
    });

    const concurrencyKey = this.getConcurrencyKeyFromInput(input);

    if (this.useSubprocessMode) {
      // Subprocess mode: Gemini CLI does not provide an opencode-compatible
      // HTTP server (session API). Spawn `gemini -- -y -p` child processes
      // instead. This is the standard execution path for oh-my-gemini;
      // the session-based path below only applies to opencode environments.
      return this.startSubprocessTask(item, concurrencyKey);
    }

    try {
      const parentSession = await this.client.session
        .get({
          path: {id: input.parentSessionID},
        })
        .catch((err: any) => {
          log(`[background-agent] Failed to get parent session: ${err}`);
          return null;
        });
      const parentDirectory = parentSession?.data?.directory ?? this.directory;
      log(
        `[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${parentDirectory}`,
      );

      const targetDirectory = input.directory ?? parentDirectory;
      log(
        `[background-agent] Target directory for subagent session: ${targetDirectory}`,
      );

      const createResult = await this.freshClient.session.create({
        body: {
          title: `${input.description} (@${input.agent} subagent)`,
        } as any,
      });

      log(
        '[background-agent] Session creation result:',
        JSON.stringify(createResult),
      );

      if (createResult.error) {
        throw new Error(
          `Failed to create background session: ${createResult.error}`,
        );
      }

      if (!createResult.data?.id) {
        throw new Error(
          'Failed to create background session: API returned no session ID',
        );
      }

      const sessionID = createResult.data.id;
      subagentSessions.add(sessionID);

      task.status = 'running';
      task.startedAt = new Date();
      task.sessionID = sessionID;
      task.directory = targetDirectory;
      task.progress = {
        toolCalls: 0,
        lastUpdate: new Date(),
      };
      task.concurrencyKey = concurrencyKey;
      task.concurrencyGroup = concurrencyKey;

      this.persistTaskState();
      this.startPolling();

      log('[background-agent] Launching task:', {
        taskId: task.id,
        sessionID,
        agent: input.agent,
      });

      const toastManager = getTaskToastManager();
      if (toastManager) {
        toastManager.updateTask(task.id, 'running');
      }

      log(
        '[background-agent] Calling prompt (fire-and-forget) for launch with:',
        {
          sessionID,
          agent: input.agent,
          model: input.model,
          hasSkillContent: !!input.skillContent,
          promptLength: input.prompt.length,
        },
      );

      // Resolve file references in the prompt before launching
      const resolvedPrompt = await resolveFileReferencesInText(
        input.prompt,
        targetDirectory,
      );

      // Use prompt() instead of promptAsync() to properly initialize agent loop (fire-and-forget)
      // Include model if caller provided one (e.g., from Sisyphus category configs)
      // IMPORTANT: variant must be a top-level field in the body, NOT nested inside model
      // Gemini's PromptInput schema expects: { model: { providerID, modelID }, variant: "max" }
      const launchModel = input.model
        ? {providerID: input.model.providerID, modelID: input.model.modelID}
        : undefined;
      const launchVariant = input.model?.variant;

      promptWithModelSuggestionRetry(this.freshClient, {
        path: {id: sessionID},
        body: {
          agent: input.agent,
          ...(launchModel ? {model: launchModel} : {}),
          ...(launchVariant ? {variant: launchVariant} : {}),
          system: input.skillContent,
          tools: {
            ...getAgentToolRestrictions(input.agent),
            delegate_task: false,
            call_subagent: true,
            question: false,
          },
          parts: [{type: 'text', text: resolvedPrompt}],
        },
      }).catch((error) => {
        log('[background-agent] promptAsync error (freshClient):', {
          error,
          message: error?.message,
          stack: error?.stack,
          details: error?.details,
          json: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        });
        const existingTask = this.findBySession(sessionID);
        if (existingTask) {
          existingTask.status = 'error';
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('agent.name') ||
            errorMessage.includes('undefined')
          ) {
            existingTask.error = `Agent "${input.agent}" not found. Make sure the agent is registered in your gemini.json or provided by a plugin.`;
          } else {
            existingTask.error = errorMessage;
          }
          existingTask.completedAt = new Date();
          if (existingTask.concurrencyKey) {
            this.concurrencyManager.release(existingTask.concurrencyKey);
            existingTask.concurrencyKey = undefined;
          }

          this.markForNotification(existingTask);
          this.notifyParentSession(existingTask).catch((err) => {
            log('[background-agent] Failed to notify on error:', err);
          });
        }
      });
    } catch (err) {
      // Release slot if we acquired it but failed before setting concurrencyKey on task
      if (!task.concurrencyKey) {
        this.concurrencyManager.release(concurrencyKey);
      }
      throw err;
    }
  }

  private async startSubprocessTask(
    item: QueueItem,
    concurrencyKey: string,
  ): Promise<void> {
    const {task, input} = item;

    const geminiPath = findGeminiPath();
    if (!geminiPath) {
      const error =
        'Cannot find gemini binary for subprocess execution';
      task.status = 'error';
      task.error = error;
      task.completedAt = new Date();
      this.markForNotification(task);
      this.notifyParentSession(task).catch(() => {});
      throw new Error(error);
    }

    // Build prompt: @agent prefix + tool restrictions + user prompt
    const parts: string[] = [];
    if (input.agent) parts.push(`@${input.agent}`);

    if (input.skillContent) {
      parts.push(`[Context]\n${input.skillContent}\n\n---\n`);
    }

    const restrictions = getAgentToolRestrictions(input.agent);
    const deniedTools = Object.entries(restrictions)
      .filter(([, allowed]) => !allowed)
      .map(([name]) => name);
    // Also deny delegate_task, question (matching startTask's tools config)
    deniedTools.push('delegate_task', 'question');
    if (deniedTools.length > 0) {
      parts.push(
        `<tool-restrictions>\nDo NOT use these tools: ${deniedTools.join(', ')}.\n</tool-restrictions>\n`,
      );
    }

    // Resolve file references before launching
    const resolvedPrompt = await resolveFileReferencesInText(
      input.prompt,
      input.directory ?? this.directory,
    );
    parts.push(resolvedPrompt);
    const fullPrompt = parts.join(' ');

    task.status = 'running';
    task.startedAt = new Date();
    task.directory = input.directory ?? this.directory;
    task.concurrencyKey = concurrencyKey;
    task.concurrencyGroup = concurrencyKey;
    task.progress = {toolCalls: 0, lastUpdate: new Date()};

    this.persistTaskState();

    const toastManager = getTaskToastManager();
    if (toastManager) {
      toastManager.updateTask(task.id, 'running');
    }

    const usePreStarted = !!input.preStartedProcess;
    log('[background-agent] Subprocess mode for task:', {
      taskId: task.id,
      agent: input.agent,
      promptLength: fullPrompt.length,
      preStarted: usePreStarted,
    });

    // Use `any` for proc since Bun.Subprocess generic types vary based on
    // spawn options (stdin/stdout can be number | FileSink | ReadableStream).
    // Pre-started processes and freshly spawned ones have different generics
    // but the same runtime shape (pipe mode).
    let proc: any;

    if (usePreStarted) {
      // Use pre-warmed process from SubAgentPool. The process is already
      // initialized (SAR extracted, proxy connected, MCP tools loaded) and
      // waiting for stdin. Just pipe the prompt.
      proc = input.preStartedProcess!;
      log('[background-agent] Using pre-started process:', {
        taskId: task.id,
        pid: proc.pid,
      });
      proc.stdin.write(fullPrompt);
      proc.stdin.end();
    } else {
      // Cold start: spawn a new gemini process.
      // Reuse the parent's API proxy if available, avoiding per-subprocess proxy
      // startup (port allocation, proxy startup, etc.). This is critical
      // for parallel_exec where many sub-agents launch concurrently.
      // Use --output-format json for structured, machine-parseable results
      // (session_id, response text, token stats) instead of raw stdout.
      const parentProxyAddress = process.env.GOOGLE_GEMINI_BASE_URL;
      const geminiArgs: string[] = [geminiPath];
      if (parentProxyAddress) {
        geminiArgs.push(`--proxy_address=${parentProxyAddress}`);
      }
      geminiArgs.push('--output-format', 'json');

      // For large prompts, use stdin to avoid E2BIG (execve arg limit ~128KB per arg).
      // Gemini CLI reads from stdin when -p is not specified.
      const useStdin = fullPrompt.length > STDIN_PROMPT_THRESHOLD;
      if (!useStdin) {
        geminiArgs.push('--', '-y', '-e', '__none__', '-p', fullPrompt);
      } else {
        geminiArgs.push('--', '-y', '-e', '__none__');
        log('[background-agent] Using stdin for large prompt:', {
          taskId: task.id,
          promptLength: fullPrompt.length,
        });
      }

      proc = Bun.spawn(geminiArgs, {
        stdin: useStdin ? 'pipe' : undefined,
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: input.directory ?? this.directory,
        env: {
          ...process.env,
          GLOG_minloglevel: '2',
          OMG_PARENT_AGENT: input.agent,
        },
      });

      // Pipe prompt via stdin for large prompts (Bun.spawn stdin is a FileSink)
      if (useStdin && proc.stdin) {
        proc.stdin.write(fullPrompt);
        proc.stdin.end();
      }
    }

    this.subprocesses.set(task.id, proc);

    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      log('[background-agent] Subprocess timeout, sending SIGTERM:', {
        taskId: task.id,
      });
      proc.kill(); // SIGTERM

      // Escalate to SIGKILL if the process doesn't exit within 5s
      forceKillTimer = setTimeout(() => {
        try {
          // Check if process is still alive (signal 0 = existence check)
          process.kill(proc.pid, 0);
          log('[background-agent] Subprocess still alive after SIGTERM, sending SIGKILL:', {
            taskId: task.id,
            pid: proc.pid,
          });
          // On Linux, kill the process group to catch forked children
          if (process.platform !== 'win32') {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
          }
          proc.kill(9); // SIGKILL
        } catch {
          // Process already dead — no action needed
        }
      }, SIGKILL_DELAY_MS);
    }, SUBPROCESS_TIMEOUT_MS);

    // Fire-and-forget: handle completion asynchronously
    (async () => {
      try {
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);

        this.subprocesses.delete(task.id);

        const exitCode = proc.exitCode;
        log('[background-agent] Subprocess completed:', {
          taskId: task.id,
          exitCode,
          stdoutLen: stdout.length,
        });

        // Write per-agent log files if a log directory was specified
        if (input.logDir) {
          writeAgentLogs(input.logDir, task.id, {
            stdout,
            stderr,
            exitCode,
            agent: input.agent,
            description: input.description,
            promptLength: fullPrompt.length,
            startedAt: task.startedAt?.getTime(),
            completedAt: Date.now(),
          });
        }

        if (exitCode === 0 || stdout.length > 0) {
          // Extract JSON block even if there are hook logs prepended or appended
          let responseText = stdout.trim();
          let parsedJSON = null;

          try {
            parsedJSON = JSON.parse(responseText);
          } catch {
            let startIndex = 0;
            while ((startIndex = responseText.indexOf('{', startIndex)) !== -1) {
              let endIndex = responseText.lastIndexOf('}');
              while (endIndex > startIndex) {
                try {
                  const candidate = JSON.parse(responseText.substring(startIndex, endIndex + 1));
                  if (candidate && (candidate.response !== undefined || candidate.session_id)) {
                    parsedJSON = candidate;
                    break;
                  }
                } catch {}
                endIndex = responseText.lastIndexOf('}', endIndex - 1);
              }
              if (parsedJSON) break;
              startIndex++;
            }
          }

          if (parsedJSON) {
            if (parsedJSON.response) {
              responseText = parsedJSON.response;
            }
            if (parsedJSON.session_id) {
              task.sessionID = parsedJSON.session_id;
            }
          }
          
          task.result = responseText;
          if (task.progress) {
            task.progress.lastMessage = responseText;
          }
          await this.tryCompleteTask(task, 'subprocess');
        } else {
          task.status = 'error';
          task.error = `Subprocess exited with code ${exitCode}: ${stderr.slice(0, 500)}`;
          task.completedAt = new Date();
          if (task.concurrencyKey) {
            this.concurrencyManager.release(task.concurrencyKey);
            task.concurrencyKey = undefined;
          }
          this.markForNotification(task);
          this.notifyParentSession(task).catch(() => {});
        }
      } catch (err) {
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        this.subprocesses.delete(task.id);
        task.status = 'error';
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = new Date();
        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey);
          task.concurrencyKey = undefined;
        }
        this.markForNotification(task);
        this.notifyParentSession(task).catch(() => {});
      }
    })();
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task);
      }
    }
    return result;
  }

  getAllDescendantTasks(
    sessionID: string,
    visited: Set<string> = new Set(),
  ): BackgroundTask[] {
    if (visited.has(sessionID)) {
      return [];
    }
    visited.add(sessionID);

    const result: BackgroundTask[] = [];
    const directChildren = this.getTasksByParentSession(sessionID);

    for (const child of directChildren) {
      result.push(child);
      if (child.sessionID) {
        const descendants = this.getAllDescendantTasks(
          child.sessionID,
          visited,
        );
        result.push(...descendants);
      }
    }

    return result;
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task;
      }
    }
    return undefined;
  }

  private getConcurrencyKeyFromInput(input: LaunchInput): string {
    if (input.model) {
      return `${input.model.providerID}/${input.model.modelID}`;
    }
    return input.agent;
  }

  async trackTask(input: {
    taskId: string;
    sessionID: string;
    parentSessionID: string;
    description: string;
    agent?: string;
    parentAgent?: string;
    concurrencyKey?: string;
  }): Promise<BackgroundTask> {
    const existingTask = this.tasks.get(input.taskId);
    if (existingTask) {
      // P2 fix: Clean up old parent's pending set BEFORE changing parent
      // Otherwise cleanupPendingByParent would use the new parent ID
      const parentChanged =
        input.parentSessionID !== existingTask.parentSessionID;
      if (parentChanged) {
        this.cleanupPendingByParent(existingTask); // Clean from OLD parent
        existingTask.parentSessionID = input.parentSessionID;
      }
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent;
      }
      if (!existingTask.concurrencyGroup) {
        existingTask.concurrencyGroup =
          input.concurrencyKey ?? existingTask.agent;
      }

      if (existingTask.sessionID) {
        subagentSessions.add(existingTask.sessionID);
      }
      this.startPolling();

      // Track for batched notifications if task is pending or running
      if (
        existingTask.status === 'pending' ||
        existingTask.status === 'running'
      ) {
        const pending =
          this.pendingByParent.get(input.parentSessionID) ?? new Set();
        pending.add(existingTask.id);
        this.pendingByParent.set(input.parentSessionID, pending);
      } else if (!parentChanged) {
        // Only clean up if parent didn't change (already cleaned above if it did)
        this.cleanupPendingByParent(existingTask);
      }

      log('[background-agent] External task already registered:', {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
        status: existingTask.status,
      });

      return existingTask;
    }

    const concurrencyGroup =
      input.concurrencyKey ?? input.agent ?? 'delegate_task';

    // Acquire concurrency slot if a key is provided
    if (input.concurrencyKey) {
      await this.concurrencyManager.acquire(input.concurrencyKey);
    }

    const task: BackgroundTask = {
      id: input.taskId,
      type: 'task',
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: '',
      description: input.description,
      prompt: '',
      agent: input.agent || 'delegate_task',
      status: 'running',
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
      parentAgent: input.parentAgent,
      concurrencyKey: input.concurrencyKey,
      concurrencyGroup,
    };

    this.tasks.set(task.id, task);
    subagentSessions.add(input.sessionID);
    this.startPolling();

    if (input.parentSessionID) {
      const pending =
        this.pendingByParent.get(input.parentSessionID) ?? new Set();
      pending.add(task.id);
      this.pendingByParent.set(input.parentSessionID, pending);
    }

    log('[background-agent] Registered external task:', {
      taskId: task.id,
      sessionID: input.sessionID,
    });

    return task;
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.findBySession(input.sessionId);
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`);
    }

    if (!existingTask.sessionID) {
      throw new Error(`Task has no sessionID: ${existingTask.id}`);
    }

    if (existingTask.status === 'running') {
      log('[background-agent] Resume skipped - task already running:', {
        taskId: existingTask.id,
        sessionID: existingTask.sessionID,
      });
      return existingTask;
    }

    // Re-acquire concurrency using the persisted concurrency group
    const concurrencyKey = existingTask.concurrencyGroup ?? existingTask.agent;
    await this.concurrencyManager.acquire(concurrencyKey);
    existingTask.concurrencyKey = concurrencyKey;
    existingTask.concurrencyGroup = concurrencyKey;

    existingTask.status = 'running';
    existingTask.completedAt = undefined;
    existingTask.error = undefined;
    existingTask.parentSessionID = input.parentSessionID;
    existingTask.parentMessageID = input.parentMessageID;
    existingTask.parentModel = input.parentModel;
    existingTask.parentAgent = input.parentAgent;
    // Reset startedAt on resume to prevent immediate completion
    // The MIN_IDLE_TIME_MS check uses startedAt, so resumed tasks need fresh timing
    existingTask.startedAt = new Date();

    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    };

    this.startPolling();
    if (existingTask.sessionID) {
      subagentSessions.add(existingTask.sessionID);
    }

    if (input.parentSessionID) {
      const pending =
        this.pendingByParent.get(input.parentSessionID) ?? new Set();
      pending.add(existingTask.id);
      this.pendingByParent.set(input.parentSessionID, pending);
    }

    const toastManager = getTaskToastManager();
    if (toastManager) {
      toastManager.addTask({
        id: existingTask.id,
        description: existingTask.description,
        agent: existingTask.agent,
        isBackground: true,
      });
    }

    log('[background-agent] Resuming task:', {
      taskId: existingTask.id,
      sessionID: existingTask.sessionID,
    });

    log(
      '[background-agent] Resuming task - calling prompt (fire-and-forget) with:',
      {
        sessionID: existingTask.sessionID,
        agent: existingTask.agent,
        model: existingTask.model,
        promptLength: input.prompt.length,
      },
    );

    // Resolve file references in the prompt before resuming
    const resolvedPrompt = await resolveFileReferencesInText(
      input.prompt,
      existingTask.directory ?? this.directory,
    );

    // Use prompt() instead of promptAsync() to properly initialize agent loop
    // Include model if task has one (preserved from original launch with category config)
    // variant must be top-level in body, not nested inside model (Gemini PromptInput schema)
    const resumeModel = existingTask.model
      ? {
          providerID: existingTask.model.providerID,
          modelID: existingTask.model.modelID,
        }
      : undefined;
    const resumeVariant = existingTask.model?.variant;

    this.client.session
      .prompt({
        path: {id: existingTask.sessionID},
        body: {
          agent: existingTask.agent,
          ...(resumeModel ? {model: resumeModel} : {}),
          ...(resumeVariant ? {variant: resumeVariant} : {}),
          tools: {
            ...getAgentToolRestrictions(existingTask.agent),
            task: false,
            delegate_task: false,
            call_subagent: true,
            question: false,
          },
          parts: [{type: 'text', text: resolvedPrompt}],
        },
      })
      .catch((error: any) => {
        log('[background-agent] resume prompt error:', error);
        existingTask.status = 'error';
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        existingTask.error = errorMessage;
        existingTask.completedAt = new Date();

        // Release concurrency on error to prevent slot leaks
        if (existingTask.concurrencyKey) {
          this.concurrencyManager.release(existingTask.concurrencyKey);
          existingTask.concurrencyKey = undefined;
        }
        this.markForNotification(existingTask);
        this.notifyParentSession(existingTask).catch((err) => {
          log('[background-agent] Failed to notify on resume error:', err);
        });
      });

    return existingTask;
  }

  private async checkSessionTodos(sessionID: string): Promise<boolean> {
    try {
      const response = await this.client.session.todo({
        path: {id: sessionID},
      });
      const todos = (response.data ?? response) as Todo[];
      if (!todos || todos.length === 0) return false;

      const incomplete = todos.filter(
        (t) => t.status !== 'completed' && t.status !== 'cancelled',
      );
      return incomplete.length > 0;
    } catch {
      return false;
    }
  }

  handleEvent(event: Event): void {
    const props = event.properties;

    if (event.type === 'message.part.updated') {
      if (!props || typeof props !== 'object' || !('sessionID' in props))
        return;
      const partInfo = props as unknown as MessagePartInfo;
      const sessionID = partInfo?.sessionID;
      if (!sessionID) return;

      const task = this.findBySession(sessionID);
      if (!task) return;

      if (partInfo?.type === 'tool' || partInfo?.tool) {
        if (!task.progress) {
          task.progress = {
            toolCalls: 0,
            lastUpdate: new Date(),
          };
        }
        task.progress.toolCalls += 1;
        task.progress.lastTool = partInfo.tool;
        task.progress.lastUpdate = new Date();
      }
    }

    if (event.type === 'session.idle') {
      const sessionID = props?.sessionID as string | undefined;
      if (!sessionID) return;

      const task = this.findBySession(sessionID);
      if (!task || task.status !== 'running') return;

      const startedAt = task.startedAt;
      if (!startedAt) return;

      // Edge guard: Require minimum elapsed time (5 seconds) before accepting idle
      const elapsedMs = Date.now() - startedAt.getTime();
      if (elapsedMs < MIN_IDLE_TIME_MS) {
        log('[background-agent] Ignoring early session.idle, elapsed:', {
          elapsedMs,
          taskId: task.id,
        });
        return;
      }

      // Edge guard: Verify session has actual assistant output before completing
      this.validateSessionHasOutput(sessionID)
        .then(async (hasValidOutput) => {
          // Re-check status after async operation (could have been completed by polling)
          if (task.status !== 'running') {
            log(
              '[background-agent] Task status changed during validation, skipping:',
              {taskId: task.id, status: task.status},
            );
            return;
          }

          if (!hasValidOutput) {
            log(
              '[background-agent] Session.idle but no valid output yet, waiting:',
              task.id,
            );
            return;
          }

          const hasIncompleteTodos = await this.checkSessionTodos(sessionID);

          // Re-check status after async operation again
          if (task.status !== 'running') {
            log(
              '[background-agent] Task status changed during todo check, skipping:',
              {taskId: task.id, status: task.status},
            );
            return;
          }

          if (hasIncompleteTodos) {
            log(
              '[background-agent] Task has incomplete todos, waiting for todo-continuation:',
              task.id,
            );
            return;
          }

          await this.tryCompleteTask(task, 'session.idle event');
        })
        .catch((err) => {
          log('[background-agent] Error in session.idle handler:', err);
        });
    }

    if (event.type === 'session.deleted') {
      const info = props?.info;
      if (!info || typeof info.id !== 'string') return;
      const sessionID = info.id;

      const task = this.findBySession(sessionID);
      if (!task) return;

      if (task.status === 'running') {
        task.status = 'cancelled';
        task.completedAt = new Date();
        task.error = 'Session deleted';
      }

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey);
        task.concurrencyKey = undefined;
      }
      const existingTimer = this.completionTimers.get(task.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.completionTimers.delete(task.id);
      }
      this.cleanupPendingByParent(task);
      this.tasks.delete(task.id);
      this.clearNotificationsForTask(task.id);
      subagentSessions.delete(sessionID);
    }
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? [];
    queue.push(task);
    this.notifications.set(task.parentSessionID, queue);
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? [];
  }

  clearNotifications(sessionID: string): void {
    this.notifications.delete(sessionID);
  }

  private async validateSessionHasOutput(sessionID: string): Promise<boolean> {
    try {
      const response = await this.client.session.messages({
        path: {id: sessionID},
      });

      const messages = response.data ?? [];

      const hasAssistantOrToolMessage = messages.some(
        (m: {info?: {role?: string}}) =>
          m.info?.role === 'assistant' || m.info?.role === 'tool',
      );

      if (!hasAssistantOrToolMessage) {
        log(
          '[background-agent] No assistant/tool messages found in session:',
          sessionID,
        );
        // If we are in MCP environment, we might not see messages from other sessions
        if (sessionID === 'mcp-session' || sessionID.startsWith('mcp-'))
          return true;
        return false;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasContent = messages.some((m: any) => {
        if (m.info?.role !== 'assistant' && m.info?.role !== 'tool')
          return false;
        const parts = m.parts ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return parts.some(
          (p: any) =>
            // Text content (final output)
            (p.type === 'text' && p.text && p.text.trim().length > 0) ||
            // Reasoning content (thinking blocks)
            (p.type === 'reasoning' && p.text && p.text.trim().length > 0) ||
            // Tool calls (indicates work was done)
            p.type === 'tool' ||
            p.type === 'tool_use' ||
            // Tool results (output from executed tools) - important for tool-only tasks
            (p.type === 'tool_result' &&
              p.content &&
              (typeof p.content === 'string'
                ? p.content.trim().length > 0
                : p.content.length > 0)) ||
            // Some versions might use 'output' field
            (p.output && p.output.trim().length > 0),
        );
      });

      if (!hasContent) {
        log(
          '[background-agent] Messages exist but no content found in session:',
          sessionID,
        );
        if (sessionID === 'mcp-session' || sessionID.startsWith('mcp-'))
          return true;
        return false;
      }

      return true;
    } catch (error) {
      log('[background-agent] Error validating session output:', error);
      // On error, allow completion to proceed (don't block indefinitely)
      return true;
    }
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((t) => t.id !== taskId);
      if (filtered.length === 0) {
        this.notifications.delete(sessionID);
      } else {
        this.notifications.set(sessionID, filtered);
      }
    }
  }

  private cleanupPendingByParent(task: BackgroundTask): void {
    if (!task.parentSessionID) return;
    const pending = this.pendingByParent.get(task.parentSessionID);
    if (pending) {
      pending.delete(task.id);
      if (pending.size === 0) {
        this.pendingByParent.delete(task.parentSessionID);
      }
    }
  }

  async cancelTask(
    taskId: string,
    options?: {
      source?: string;
      reason?: string;
      abortSession?: boolean;
      skipNotification?: boolean;
    },
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || (task.status !== 'running' && task.status !== 'pending')) {
      return false;
    }

    const source = options?.source ?? 'cancel';
    const abortSession = options?.abortSession !== false;
    const reason = options?.reason;

    if (task.status === 'pending') {
      const key = task.model
        ? `${task.model.providerID}/${task.model.modelID}`
        : task.agent;
      const queue = this.queuesByKey.get(key);
      if (queue) {
        const index = queue.findIndex((item) => item.task.id === taskId);
        if (index !== -1) {
          queue.splice(index, 1);
          if (queue.length === 0) {
            this.queuesByKey.delete(key);
          }
        }
      }
      log('[background-agent] Cancelled pending task:', {taskId, key});
    }

    task.status = 'cancelled';
    task.completedAt = new Date();
    if (reason) {
      task.error = reason;
    }

    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey);
      task.concurrencyKey = undefined;
    }

    const existingTimer = this.completionTimers.get(task.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.completionTimers.delete(task.id);
    }

    this.cleanupPendingByParent(task);

    if (abortSession && task.sessionID) {
      this.client.session
        .abort({
          path: {id: task.sessionID},
        })
        .catch(() => {});
    }

    // Kill subprocess if running — SIGTERM then SIGKILL escalation
    const proc = this.subprocesses.get(taskId);
    if (proc) {
      proc.kill(); // SIGTERM
      setTimeout(() => {
        try {
          process.kill(proc.pid, 0);
          if (process.platform !== 'win32') {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
          }
          proc.kill(9); // SIGKILL
        } catch {
          // Already dead
        }
      }, SIGKILL_DELAY_MS);
      this.subprocesses.delete(taskId);
    }

    if (options?.skipNotification) {
      log(
        `[background-agent] Task cancelled via ${source} (notification skipped):`,
        task.id,
      );
      return true;
    }

    this.markForNotification(task);

    try {
      await this.notifyParentSession(task);
      log(`[background-agent] Task cancelled via ${source}:`, task.id);
    } catch (err) {
      log(
        '[background-agent] Error in notifyParentSession for cancelled task:',
        {taskId: task.id, error: err},
      );
    }

    return true;
  }

  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') {
      return false;
    }

    void this.cancelTask(taskId, {
      source: 'cancelPendingTask',
      abortSession: false,
    });
    return true;
  }

  private startPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks().catch((err) => {
        log('[background-agent] Polling error:', err);
      });
    }, POLLING_INTERVAL_MS);
    this.pollingInterval.unref();

    // Poll immediately on start to handle fast-reloading environments
    this.pollRunningTasks().catch((err) => {
      log('[background-agent] Initial poll error:', err);
    });
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }

  private registerProcessCleanup(): void {
    BackgroundManager.cleanupManagers.add(this);

    if (BackgroundManager.cleanupRegistered) return;
    BackgroundManager.cleanupRegistered = true;

    const cleanupAll = () => {
      for (const manager of BackgroundManager.cleanupManagers) {
        try {
          manager.shutdown();
        } catch (error) {
          log('[background-agent] Error during shutdown cleanup:', error);
        }
      }
    };

    const registerSignal = (
      signal: ProcessCleanupEvent,
      exitAfter: boolean,
    ): void => {
      const listener = registerProcessSignal(signal, cleanupAll, exitAfter);
      BackgroundManager.cleanupHandlers.set(signal, listener);
    };

    registerSignal('SIGINT', false);
    registerSignal('SIGTERM', false);
    if (process.platform === 'win32') {
      registerSignal('SIGBREAK', false);
    }
    registerSignal('beforeExit', false);
    registerSignal('exit', false);
  }

  private unregisterProcessCleanup(): void {
    BackgroundManager.cleanupManagers.delete(this);

    if (BackgroundManager.cleanupManagers.size > 0) return;

    for (const [
      signal,
      listener,
    ] of BackgroundManager.cleanupHandlers.entries()) {
      process.off(signal, listener);
    }
    BackgroundManager.cleanupHandlers.clear();
    BackgroundManager.cleanupRegistered = false;
  }

  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    );
  }

  getCompletedTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status !== 'running',
    );
  }

  private async tryCompleteTask(
    task: BackgroundTask,
    source: string,
  ): Promise<boolean> {
    if (task.status !== 'running') {
      log('[background-agent] Task already completed, skipping:', {
        taskId: task.id,
        status: task.status,
        source,
      });
      return false;
    }

    task.status = 'completed';
    task.completedAt = new Date();

    if (task.progress?.lastMessage) {
      task.result = task.progress.lastMessage;
    }

    // Release concurrency BEFORE any async operations to prevent slot leaks
    if (task.concurrencyKey) {
      this.concurrencyManager.release(task.concurrencyKey);
      task.concurrencyKey = undefined;
    }

    if (task.sessionID) {
      this.client.session
        .abort({
          path: {id: task.sessionID},
        })
        .catch(() => {});
    }

    // In blocking parallel_exec mode, individual task notifications are
    // unnecessary — the MCP tool returns the combined report directly.
    // Sending notifications would trigger redundant model turns.
    if (task.skipNotification) {
      log(`[background-agent] Task completed via ${source} (notification skipped):`, task.id);
    } else {
      this.markForNotification(task);
      try {
        await this.notifyParentSession(task);
        log(`[background-agent] Task completed via ${source}:`, task.id);
      } catch (err) {
        log('[background-agent] Error in notifyParentSession:', {
          taskId: task.id,
          error: err,
        });
        // Concurrency already released, notification failed but task is complete
      }
    }

    // Persist state AFTER notification to avoid race condition:
    // The AfterAgent handler reads this file to decide whether to keep polling.
    // If we clear it before writing the notification file, the handler may exit
    // the poll loop before the notification is written.
    this.persistTaskState();

    return true;
  }

  private async notifyParentSession(task: BackgroundTask): Promise<void> {
    // Note: Callers must release concurrency before calling this method
    // to ensure slots are freed even if notification fails

    const duration = this.formatDuration(
      task.startedAt ?? new Date(),
      task.completedAt,
    );

    log('[background-agent] notifyParentSession called for task:', task.id);

    // Show toast notification
    const toastManager = getTaskToastManager();
    if (toastManager) {
      toastManager.showCompletionToast({
        id: task.id,
        description: task.description,
        duration,
      });
    }

    // Update pending tracking and check if all tasks complete
    const pendingSet = this.pendingByParent.get(task.parentSessionID);
    if (pendingSet) {
      pendingSet.delete(task.id);
      if (pendingSet.size === 0) {
        this.pendingByParent.delete(task.parentSessionID);
      }
    }

    const allComplete = !pendingSet || pendingSet.size === 0;
    const remainingCount = pendingSet?.size ?? 0;

    const statusText = task.status === 'completed' ? 'COMPLETED' : 'CANCELLED';
    const errorInfo = task.error ? `\n**Error:** ${task.error}` : '';

    let notification: string;
    let completedTasks: BackgroundTask[] = [];
    if (allComplete) {
      completedTasks = Array.from(this.tasks.values()).filter(
        (t) =>
          t.parentSessionID === task.parentSessionID &&
          t.status !== 'running' &&
          t.status !== 'pending',
      );

      // For parallel tasks with cached results, include them directly in the
      // notification. This is critical for Gemini CLI mode where the model
      // gets only one turn after AfterAgent deny — it needs the results
      // inline rather than having to call background_output().
      const compositeTask = task as CompositeBackgroundTask;
      if (compositeTask.parallelResults && compositeTask.parallelResults.length > 0) {
        const resultsText = compositeTask.parallelResults
          .map((r) => {
            const output = r.output ? r.output.slice(0, 2000) : '(no output)';
            return `### ${r.description}\n**Status:** ${r.status}\n${output}`;
          })
          .join('\n\n---\n\n');

        notification = `<system-reminder>
[ALL PARALLEL TASKS COMPLETE — ${compositeTask.parallelResults.length} tasks]

${resultsText}

Synthesize the above results into a final combined report for the user.
</system-reminder>`;
      } else {
        const completedTasksText = completedTasks
          .map((t) => `- \`${t.id}\`: ${t.description}`)
          .join('\n');

        notification = `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasksText || `- \`${task.id}\`: ${task.description}`}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`;
      }
    } else {
      // Individual completion - silent notification
      notification = `<system-reminder>
[BACKGROUND TASK ${statusText}]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Duration:** ${duration}${errorInfo}

**${remainingCount} task${remainingCount === 1 ? '' : 's'} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`;
    }

    let agent: string | undefined = task.parentAgent;
    let model: {providerID: string; modelID: string} | undefined;

    try {
      const messagesResp = await this.client.session.messages({
        path: {id: task.parentSessionID},
      });
      const messages = (messagesResp.data ?? []) as Array<{
        info?: {
          agent?: string;
          model?: {providerID: string; modelID: string};
          modelID?: string;
          providerID?: string;
        };
      }>;
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info;
        if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
          agent = info.agent ?? task.parentAgent;
          model =
            info.model ??
            (info.providerID && info.modelID
              ? {providerID: info.providerID, modelID: info.modelID}
              : undefined);
          break;
        }
      }
    } catch {
      const messageDir = getMessageDir(task.parentSessionID);
      const currentMessage = messageDir
        ? findNearestMessageWithFields(messageDir)
        : null;
      agent = currentMessage?.agent ?? task.parentAgent;
      model =
        currentMessage?.model?.providerID && currentMessage?.model?.modelID
          ? {
              providerID: currentMessage.model.providerID,
              modelID: currentMessage.model.modelID,
            }
          : undefined;
    }

    log('[background-agent] notifyParentSession context:', {
      taskId: task.id,
      resolvedAgent: agent,
      resolvedModel: model,
    });

    // Write to the notification file for the AfterAgent sleep-poll handler.
    // Only write the "all complete" notification — individual task completions
    // are noisy and consume the model's limited AfterAgent bonus turns.
    // In Gemini CLI mode, session.prompt may succeed silently (the opencode
    // client returns 200) but never reaches the CLI model.
    if (allComplete) {
      try {
        writeNotification(task.directory ?? this.directory, notification);
      } catch (writeErr) {
        log('[background-agent] Failed to write notification file:', writeErr);
      }
    }

    try {
      await this.client.session.prompt({
        path: {id: task.parentSessionID},
        body: {
          noReply: !allComplete,
          ...(agent !== undefined ? {agent} : {}),
          ...(model !== undefined ? {model} : {}),
          parts: [{type: 'text', text: notification}],
        },
      });
      log('[background-agent] Sent notification to parent session:', {
        taskId: task.id,
        allComplete,
        noReply: !allComplete,
      });
    } catch (error) {
      log('[background-agent] session.prompt failed:', error);
      // For individual completions that weren't written above, write fallback
      if (!allComplete) {
        try {
          writeNotification(task.directory ?? this.directory, notification);
        } catch (writeErr) {
          log('[background-agent] Failed to write notification file:', writeErr);
        }
      }
    }

    if (allComplete) {
      for (const completedTask of completedTasks) {
        const taskId = completedTask.id;
        const existingTimer = this.completionTimers.get(taskId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.completionTimers.delete(taskId);
        }
        const timer = setTimeout(() => {
          this.completionTimers.delete(taskId);
          if (this.tasks.has(taskId)) {
            this.clearNotificationsForTask(taskId);
            this.tasks.delete(taskId);
            log(
              '[background-agent] Removed completed task from memory:',
              taskId,
            );
          }
        }, TASK_CLEANUP_DELAY_MS);
        this.completionTimers.set(taskId, timer);
      }
    }
  }

  private formatDuration(start: Date, end?: Date): string {
    const duration = (end ?? new Date()).getTime() - start.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private hasRunningTasks(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') return true;
    }
    return false;
  }

  private pruneStaleTasksAndNotifications(): void {
    const now = Date.now();

    for (const [taskId, task] of this.tasks.entries()) {
      const timestamp =
        task.status === 'pending'
          ? task.queuedAt?.getTime()
          : task.startedAt?.getTime();

      if (!timestamp) {
        continue;
      }

      const age = now - timestamp;
      if (age > TASK_TTL_MS) {
        const errorMessage =
          task.status === 'pending'
            ? 'Task timed out while queued (30 minutes)'
            : 'Task timed out after 30 minutes';

        log('[background-agent] Pruning stale task:', {
          taskId,
          status: task.status,
          age: Math.round(age / 1000) + 's',
        });
        task.status = 'error';
        task.error = errorMessage;
        task.completedAt = new Date();
        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey);
          task.concurrencyKey = undefined;
        }
        // Clean up pendingByParent to prevent stale entries
        this.cleanupPendingByParent(task);
        this.clearNotificationsForTask(taskId);
        this.tasks.delete(taskId);
        if (task.sessionID) {
          subagentSessions.delete(task.sessionID);
        }
      }
    }

    for (const [sessionID, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionID);
        continue;
      }
      const validNotifications = notifications.filter((task) => {
        if (!task.startedAt) return false;
        const age = now - task.startedAt.getTime();
        return age <= TASK_TTL_MS;
      });
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionID);
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionID, validNotifications);
      }
    }
  }

  private async checkAndInterruptStaleTasks(): Promise<void> {
    const staleTimeoutMs =
      this.config?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (task.status !== 'running') continue;
      if (!task.progress?.lastUpdate) continue;

      const startedAt = task.startedAt;
      const sessionID = task.sessionID;
      if (!startedAt || !sessionID) continue;

      const runtime = now - startedAt.getTime();
      if (runtime < MIN_RUNTIME_BEFORE_STALE_MS) continue;

      const timeSinceLastUpdate = now - task.progress.lastUpdate.getTime();
      if (timeSinceLastUpdate <= staleTimeoutMs) continue;

      if (task.status !== 'running') continue;

      const staleMinutes = Math.round(timeSinceLastUpdate / 60000);
      task.status = 'cancelled';
      task.error = `Stale timeout (no activity for ${staleMinutes}min)`;
      task.completedAt = new Date();

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey);
        task.concurrencyKey = undefined;
      }

      this.client.session
        .abort({
          path: {id: sessionID},
        })
        .catch(() => {});

      log(`[background-agent] Task ${task.id} interrupted: stale timeout`);

      try {
        await this.notifyParentSession(task);
      } catch (err) {
        log('[background-agent] Error in notifyParentSession for stale task:', {
          taskId: task.id,
          error: err,
        });
      }
    }
  }

  private async pollRunningTasks(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      log(
        `[background-agent] Polling running tasks: parallels=${this.parallelExecs.size}, tasks=${this.tasks.size}, ids=[${Array.from(this.tasks.keys()).join(', ')}]`,
      );
      this.pruneStaleTasksAndNotifications();
      await this.checkAndInterruptStaleTasks();
      log('[background-agent] After checkAndInterruptStaleTasks');

      // Handle Parallels
      for (const [taskId, coordinator] of this.parallelExecs.entries()) {
        // Throttling: Add a small delay between parallel polls
        await new Promise((resolve) => setTimeout(resolve, 50));

        log(`[background-agent] Polling parallel_exec: ${taskId}`);
        const task = this.tasks.get(taskId) as CompositeBackgroundTask;
        if (!task || task.status !== 'running') {
          this.parallelExecs.delete(taskId);
          continue;
        }

        try {
          const finished = await coordinator.poll();
          const progress = coordinator.getProgress();
          const results = coordinator.getResults();
          task.subTaskIds = results
            .filter((r) => r.taskId)
            .map((r) => r.taskId!);

          // Check if finished
          if (finished) {
            log(`[background-agent] Parallel ${taskId} completed via polling`);
            // Cache results before deleting coordinator so background_output can access them
            task.parallelResults = results.map((r) => ({
              description: r.description,
              status: r.status,
              output: r.output,
              error: r.error,
              taskId: r.taskId,
            }));
            await coordinator.cleanup();
            await this.tryCompleteTask(task, 'parallel completion');
            this.parallelExecs.delete(taskId);
          }
        } catch (err) {
          log(`[background-agent] Parallel ${taskId} polling error:`, err);
          task.status = 'error';
          task.error = err instanceof Error ? err.message : String(err);
          task.completedAt = new Date();
          await coordinator.cleanup().catch(() => {});
          this.markForNotification(task);
          this.notifyParentSession(task).catch(() => {});
          this.parallelExecs.delete(taskId);
        }
      }

      // We skip status check here because it can be slow/hang in some environments.
      // We rely on message count stability (3 polls with same count = complete)
      const allStatuses: Record<string, {type: string}> = {};

      for (const task of this.tasks.values()) {
        if (task.status !== 'running') continue;

        // Throttling: Add a small delay between task polls to avoid flooding the API
        // and triggering React update depth limits in the CLI
        await new Promise((resolve) => setTimeout(resolve, 10));

        log(
          `[background-agent] Polling task: id=${task.id}, type=${task.type}, status=${task.status}, sessionID=${task.sessionID}`,
        );

        const sessionID = task.sessionID;
        if (!sessionID) continue;

        try {
          const sessionStatus = allStatuses[sessionID];

          // Don't skip if session not in status - fall through to message-based detection
          if (sessionStatus?.type === 'idle') {
            // Edge guard: Validate session has actual output before completing
            const hasValidOutput =
              await this.validateSessionHasOutput(sessionID);
            if (!hasValidOutput) {
              log(
                '[background-agent] Polling idle but no valid output yet, waiting:',
                task.id,
              );
              continue;
            }

            // Re-check status after async operation
            if (task.status !== 'running') continue;

            const hasIncompleteTodos = await this.checkSessionTodos(sessionID);
            if (hasIncompleteTodos) {
              log(
                '[background-agent] Task has incomplete todos via polling, waiting:',
                task.id,
              );
              continue;
            }

            await this.tryCompleteTask(task, 'polling (idle status)');
            continue;
          }

          const messagesResult = await this.client.session.messages({
            path: {id: sessionID},
          });
          log(
            `[background-agent] messagesResult for ${sessionID}:`,
            JSON.stringify(messagesResult),
          );

          if (!messagesResult.error && messagesResult.data) {
            const messages = messagesResult.data as Array<{
              info?: {role?: string};
              parts?: Array<{
                type?: string;
                tool?: string;
                name?: string;
                text?: string;
              }>;
            }>;
            log(
              `[background-agent] Polled session ${sessionID}, messages: ${messages.length}`,
            );
            if (messages.length > 0) {
              const lastMsg = messages[messages.length - 1];
              log(
                `[background-agent] Last message role: ${lastMsg.info?.role}, parts: ${lastMsg.parts?.length}`,
              );
            }
            const assistantMsgs = messages.filter(
              (m) => m.info?.role === 'assistant',
            );

            let toolCalls = 0;
            let lastTool: string | undefined;
            let lastMessage: string | undefined;

            for (const msg of assistantMsgs) {
              const parts = msg.parts ?? [];
              for (const part of parts) {
                if (part.type === 'tool_use' || part.tool) {
                  toolCalls++;
                  lastTool = part.tool || part.name || 'unknown';
                }
                if (part.type === 'text' && part.text) {
                  lastMessage = part.text;
                }
              }
            }

            if (!task.progress) {
              task.progress = {toolCalls: 0, lastUpdate: new Date()};
            }
            task.progress.toolCalls = toolCalls;
            task.progress.lastTool = lastTool;
            task.progress.lastUpdate = new Date();
            if (lastMessage) {
              task.progress.lastMessage = lastMessage;
              task.progress.lastMessageAt = new Date();
            }

            // Stability detection: complete when message count unchanged for 3 polls
            const currentMsgCount = messages.length;
            const startedAt = task.startedAt;
            if (!startedAt) continue;

            const elapsedMs = Date.now() - startedAt.getTime();

            if (elapsedMs >= MIN_STABILITY_TIME_MS) {
              if (task.lastMsgCount === currentMsgCount) {
                task.stablePolls = (task.stablePolls ?? 0) + 1;
                if (task.stablePolls >= 3) {
                  // Re-fetch session status to confirm agent is truly idle
                  const recheckStatus = await this.client.session.status();
                  const recheckData = (recheckStatus.data ?? {}) as Record<
                    string,
                    {type: string}
                  >;
                  const currentStatus = recheckData[sessionID];

                  if (currentStatus && currentStatus.type !== 'idle') {
                    log(
                      '[background-agent] Stability reached but session not idle, resetting:',
                      {
                        taskId: task.id,
                        sessionStatus: currentStatus?.type ?? 'not_in_status',
                      },
                    );
                    task.stablePolls = 0;
                    continue;
                  }

                  // Edge guard: Validate session has actual output before completing
                  const hasValidOutput =
                    await this.validateSessionHasOutput(sessionID);
                  if (!hasValidOutput) {
                    log(
                      '[background-agent] Stability reached but no valid output, waiting:',
                      task.id,
                    );
                    continue;
                  }

                  // Re-check status after async operation
                  if (task.status !== 'running') continue;

                  const hasIncompleteTodos =
                    await this.checkSessionTodos(sessionID);
                  if (!hasIncompleteTodos) {
                    await this.tryCompleteTask(task, 'stability detection');
                    continue;
                  }
                }
              } else {
                task.stablePolls = 0;
              }
            }
            task.lastMsgCount = currentMsgCount;
          }
        } catch (error) {
          log('[background-agent] Poll error for task:', {
            taskId: task.id,
            error,
          });
        }
      }

      if (!this.hasRunningTasks()) {
        this.stopPolling();
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Persist running task state to a file for cross-process readers (e.g.,
   * the babysitter AfterAgent handler running in a dispatch subprocess).
   * Called on task status changes (running, completed, error, cancelled).
   */
  private persistTaskState(): void {
    const TASK_STATE_FILE = '.gemini/omg-background-tasks.json';
    const filePath = join(this.directory, TASK_STATE_FILE);
    try {
      const states = Array.from(this.tasks.values())
        .filter((t) => t.status === 'running')
        .map((t) => ({
          id: t.id,
          description: t.description,
          agent: t.agent,
          status: t.status,
          startedAt: t.startedAt?.getTime(),
          lastMessageAt: t.progress?.lastMessageAt?.getTime(),
          isUnstableAgent: t.isUnstableAgent,
          model: t.model ? {modelID: t.model.modelID} : undefined,
        }));
      mkdirSync(join(this.directory, '.gemini'), {recursive: true});
      writeFileSync(filePath, JSON.stringify(states));
    } catch {
      // Non-critical — babysitter handler will simply see no tasks
    }
  }

  shutdown(): void {
    if (this.shutdownTriggered) return;
    this.shutdownTriggered = true;
    log('[background-agent] Shutting down BackgroundManager');
    this.stopPolling();

    // Kill all running subprocesses
    for (const [taskId, proc] of this.subprocesses.entries()) {
      proc.kill();
      log('[background-agent] Killed subprocess on shutdown:', taskId);
    }
    this.subprocesses.clear();

    // Abort all running sessions to prevent zombie processes (#1240)
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.sessionID) {
        this.client.session
          .abort({
            path: {id: task.sessionID},
          })
          .catch(() => {});
      }
    }

    // Notify shutdown listeners (e.g., tmux cleanup)
    if (this.onShutdown) {
      try {
        this.onShutdown();
      } catch (error) {
        log('[background-agent] Error in onShutdown callback:', error);
      }
    }

    for (const task of this.tasks.values()) {
      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey);
        task.concurrencyKey = undefined;
      }
    }

    for (const timer of this.completionTimers.values()) {
      clearTimeout(timer);
    }
    this.completionTimers.clear();

    this.concurrencyManager.clear();
    this.tasks.clear();
    this.notifications.clear();
    this.pendingByParent.clear();
    this.queuesByKey.clear();
    this.processingKeys.clear();
    this.unregisterProcessCleanup();
    log('[background-agent] Shutdown complete');
  }
}

function registerProcessSignal(
  signal: ProcessCleanupEvent,
  handler: () => void,
  exitAfter: boolean,
): () => void {
  const listener = () => {
    handler();
    if (exitAfter) {
      // Set exitCode and schedule exit after delay to allow other handlers to complete async cleanup
      // Use 6s delay to accommodate LSP cleanup (5s timeout + 1s SIGKILL wait)
      process.exitCode = 0;
      setTimeout(() => process.exit(), 6000);
    }
  };
  process.on(signal, listener);
  return listener;
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null;

  const directPath = join(MESSAGE_STORAGE, sessionID);
  if (existsSync(directPath)) return directPath;

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID);
    if (existsSync(sessionPath)) return sessionPath;
  }
  return null;
}

import {
  resolveCategoryExecution,
  resolveSkillContent,
  findGeminiPath,
} from '@tools/delegate-task/executor';
import {buildSystemContent} from '@tools/delegate-task/prompt-builder';
import type {OpencodeClient} from '@tools/delegate-task/types';
import {EventEmitter} from 'events';
import type {
  BrowserAutomationProvider,
  CategoriesConfig,
  GitMasterConfig,
} from '../../config/schema';
import {
  getAgentToolRestrictions,
  log,
  resolveFileReferencesInText,
} from '../../shared';
import {BackgroundManager} from '../background-agent';
import {cleanupEnvironment, createIsolatedEnvironment} from './isolation';
import {
  PersistentWorkerPool,
  ExpectWorkerPool,
  MqWorkerPool,
  type PersistentTaskInput,
} from './persistent-pool';
import {SubAgentPool} from './pool';
import {getParallelLogDir} from './storage';
import type {
  ParallelConfig,
  ParallelProgress,
  ParallelTask,
  ParallelTaskStatus,
} from './types';

/** Prompts exceeding this size are rejected outright */
const MAX_PROMPT_SIZE = 2_000_000; // 2MB
/** Prompts exceeding this size produce a warning but proceed */
const WARN_PROMPT_SIZE = 500_000; // 500KB

export interface AddTasksResult {
  ids: string[];
  errors: string[];
}

/**
 * Validate that an agent name resolves to a known agent definition.
 * Checks both the `agents/` markdown directory and built-in names.
 */
export function getAvailableAgentNames(directory: string): string[] {
  const {existsSync, readdirSync} = require('node:fs');
  const {join, basename} = require('node:path');

  const names = new Set<string>();

  // Built-in agents (hardcoded in src/agents/utils.ts)
  const builtins = [
    'oracle', 'librarian', 'explore', 'multimodal-looker',
    'metis', 'momus', 'sisyphus', 'hephaestus', 'atlas',
    'sisyphus-junior', 'prometheus',
  ];
  for (const name of builtins) names.add(name);

  // Markdown agents from agents/ directory
  const agentsDir = join(directory, 'agents');
  if (existsSync(agentsDir)) {
    try {
      for (const entry of readdirSync(agentsDir)) {
        if (typeof entry === 'string' && entry.endsWith('.md')) {
          names.add(basename(entry, '.md'));
        }
      }
    } catch {
      // Non-critical
    }
  }

  return Array.from(names).sort();
}

export interface ParallelCoordinatorOptions {
  manager: BackgroundManager;
  parentSessionID: string;
  parentMessageID: string;
  directory: string;
  config?: Partial<ParallelConfig>;
  // Resolution context (not persisted)
  client?: OpencodeClient;
  userCategories?: CategoriesConfig;
  gitMasterConfig?: GitMasterConfig;
  sisyphusJuniorModel?: string;
  browserProvider?: BrowserAutomationProvider;
}

export class ParallelCoordinator extends EventEmitter {
  public readonly id: string;
  public readonly directory: string;
  private manager?: BackgroundManager;
  private parentSessionID: string;
  private parentMessageID: string;
  private config: ParallelConfig;
  private tasks: Map<string, ParallelTask> = new Map();
  private logDir?: string;
  private activeTaskIds: Set<string> = new Set();
  private isRunning: boolean = false;
  private isPolling: boolean = false;
  private pool?: SubAgentPool;
  private persistentPool?: PersistentWorkerPool;
  private expectPool?: ExpectWorkerPool;
  private mqPool?: MqWorkerPool;
  private usePersistentWorkers: boolean = false;
  private useExpectWorkers: boolean = false;
  private useMqWorkers: boolean = false;
  /** When true, skip individual task notifications (MCP tool returns results directly) */
  public blockingMode: boolean = false;

  // Resolution context
  public client?: OpencodeClient;
  public userCategories?: CategoriesConfig;
  public gitMasterConfig?: GitMasterConfig;
  public sisyphusJuniorModel?: string;
  public browserProvider?: BrowserAutomationProvider;

  constructor(options: ParallelCoordinatorOptions & {id?: string}) {
    super();
    this.id = options.id ?? `parallel_${crypto.randomUUID().slice(0, 8)}`;
    this.manager = options.manager;
    this.parentSessionID = options.parentSessionID;
    this.parentMessageID = options.parentMessageID;
    this.directory = options.directory;
    this.config = {
      maxParallel: options.config?.maxParallel ?? 10,
      waveDelayMs: options.config?.waveDelayMs ?? 2000,
      pollIntervalMs: options.config?.pollIntervalMs ?? 2000,
      stopOnFirstFailure: options.config?.stopOnFirstFailure ?? false,
      isolation: options.config?.isolation ?? false,
      synthesis: options.config?.synthesis ?? false,
      skipPool: options.config?.skipPool ?? false,
      mode: options.config?.mode ?? 'read_only',
    };

    this.client = options.client;
    this.userCategories = options.userCategories;
    this.gitMasterConfig = options.gitMasterConfig;
    this.sisyphusJuniorModel = options.sisyphusJuniorModel;
    this.browserProvider = options.browserProvider;

    // Initialize per-agent log directory
    try {
      this.logDir = getParallelLogDir(this.id, this.directory);
    } catch {
      // Non-critical
    }
  }

  public setResolutionContext(options: {
    client: OpencodeClient;
    userCategories?: CategoriesConfig;
    gitMasterConfig?: GitMasterConfig;
    sisyphusJuniorModel?: string;
    browserProvider?: BrowserAutomationProvider;
  }) {
    this.client = options.client;
    this.userCategories = options.userCategories;
    this.gitMasterConfig = options.gitMasterConfig;
    this.sisyphusJuniorModel = options.sisyphusJuniorModel;
    this.browserProvider = options.browserProvider;
  }

  public setManager(manager: BackgroundManager) {
    this.manager = manager;
  }

  public toJSON() {
    return {
      id: this.id,
      parentSessionID: this.parentSessionID,
      parentMessageID: this.parentMessageID,
      directory: this.directory,
      config: this.config,
      tasks: Array.from(this.tasks.values()),
      activeTaskIds: Array.from(this.activeTaskIds),
    };
  }

  public static fromJSON(
    data: any,
    manager?: BackgroundManager,
  ): ParallelCoordinator {
    const coordinator = new ParallelCoordinator({
      id: data.id,
      manager: manager!,
      parentSessionID: data.parentSessionID,
      parentMessageID: data.parentMessageID,
      directory: data.directory,
      config: data.config,
    });

    for (const task of data.tasks) {
      coordinator.tasks.set(task.id, task);
    }
    coordinator.activeTaskIds = new Set(data.activeTaskIds);

    return coordinator;
  }

  public addTasks(
    tasks: Array<Partial<ParallelTask> & {description: string; prompt: string}>,
  ): AddTasksResult {
    const ids: string[] = [];
    const errors: string[] = [];

    for (const taskData of tasks) {
      // Validate prompt is not empty
      if (!taskData.prompt || !taskData.prompt.trim()) {
        errors.push(`Task "${taskData.description}": empty prompt — skipped.`);
        continue;
      }

      // Validate prompt size
      if (taskData.prompt.length > MAX_PROMPT_SIZE) {
        errors.push(
          `Task "${taskData.description}": prompt exceeds 2MB (${(taskData.prompt.length / 1_000_000).toFixed(1)}MB) — skipped.`,
        );
        continue;
      }

      if (taskData.prompt.length > WARN_PROMPT_SIZE) {
        log(
          `[parallel] WARNING: Task "${taskData.description}" has a large prompt (${(taskData.prompt.length / 1000).toFixed(0)}KB). May hit model context limits.`,
        );
      }

      const id = crypto.randomUUID();
      const task: ParallelTask = {
        id,
        status: 'pending',
        description: taskData.description,
        prompt: taskData.prompt,
        agent: taskData.agent ?? 'sisyphus-junior',
        skills: taskData.skills ?? [],
        category: taskData.category,
        logDir: this.logDir,
      };
      this.tasks.set(id, task);
      ids.push(id);
    }
    return {ids, errors};
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    log(`[parallel] Starting parallel coordination: ${this.id}`);

    // Direct API pool for read_only mode (zero cold start — makes HTTP
    // calls directly to the Gemini proxy instead of spawning CLI processes).
    // Only used when: blocking mode, read_only, no isolation, pool not skipped.
    if (
      this.blockingMode &&
      this.config.mode === 'read_only' &&
      !this.config.isolation &&
      !this.config.skipPool &&
      !process.env.OMG_SKIP_POOL
    ) {
      if (PersistentWorkerPool.isAvailable()) {
        const numWorkers = Math.min(this.tasks.size, this.config.maxParallel);
        this.persistentPool = new PersistentWorkerPool({
          directory: this.directory,
          numWorkers,
          proxyAddress: process.env.GOOGLE_GEMINI_BASE_URL,
        });

        try {
          const prepared = await this.preparePersistentTasks();
          this.persistentPool.prepare(prepared);
          const {ready} = await this.persistentPool.start();
          if (ready > 0) {
            this.usePersistentWorkers = true;
            log(
              `[parallel] Using direct API pool: ${ready} tasks, ${numWorkers} concurrency`,
            );
            // Mark all tasks as running
            for (const task of this.tasks.values()) {
              task.status = 'running';
              task.startTime = Date.now();
            }
            return; // Skip SubAgentPool
          }
        } catch (err) {
          log(`[parallel] Direct API pool setup failed, falling back: ${err}`);
        }

        // Fallback: direct API pool failed, clean up and continue
        await this.persistentPool.drain();
        this.persistentPool = undefined;
      }
    }

    // Worker Pool for read_write blocking mode.
    log(`[parallel] Pool selection: blocking=${this.blockingMode}, mode=${this.config.mode}, isolation=${this.config.isolation}, skipPool=${this.config.skipPool}, envSkip=${!!process.env.OMG_SKIP_POOL}`);
    if (
      this.blockingMode &&
      this.config.mode === 'read_write' &&
      !this.config.isolation &&
      !this.config.skipPool &&
      !process.env.OMG_SKIP_POOL
    ) {
      const geminiPath = findGeminiPath();
      const proxyAddress = process.env.GOOGLE_GEMINI_BASE_URL;
      const hasApiKey = !!process.env.GEMINI_API_KEY;
      log(`[parallel] Pool check: geminiPath=${geminiPath ? 'found' : 'NOT FOUND'}, proxyAddress=${proxyAddress ? 'set' : 'NOT SET'}, apiKey=${hasApiKey ? 'set' : 'NOT SET'}`);
      if (geminiPath && (proxyAddress || hasApiKey)) {
        const numWorkers = Math.min(this.tasks.size, this.config.maxParallel);
        const prepared = await this.preparePersistentTasks();

        // Try MqWorkerPool first (persistent processes via MCP task queue)
        if (!process.env.OMG_SKIP_MQ_POOL) {
          this.mqPool = new MqWorkerPool({
            directory: this.directory,
            numWorkers,
            geminiPath,
            proxyAddress,
          });
          try {
            this.mqPool.prepare(prepared);
            const {ready} = await this.mqPool.start();
            if (ready > 0) {
              this.useMqWorkers = true;
              log(
                `[parallel] Using MQ worker pool: ${this.tasks.size} tasks, ${numWorkers} workers`,
              );
              for (const task of this.tasks.values()) {
                task.status = 'running';
                task.startTime = Date.now();
              }
              return;
            }
          } catch (err) {
            log(`[parallel] MQ pool setup failed, falling back: ${err}`);
          }
          await this.mqPool.drain();
          this.mqPool = undefined;
        }

        // Fallback: ExpectWorkerPool (one-shot subprocesses per task)
        this.expectPool = new ExpectWorkerPool({
          directory: this.directory,
          numWorkers,
          geminiPath,
          proxyAddress,
        });

        try {
          this.expectPool.prepare(prepared);
          const {ready} = await this.expectPool.start();
          if (ready > 0) {
            this.useExpectWorkers = true;
            log(
              `[parallel] Using batch worker pool: ${this.tasks.size} tasks, ${numWorkers} workers`,
            );
            for (const task of this.tasks.values()) {
              task.status = 'running';
              task.startTime = Date.now();
            }
            return;
          }
        } catch (err) {
          log(`[parallel] Batch pool setup failed, falling back: ${err}`);
        }

        await this.expectPool.drain();
        this.expectPool = undefined;
      }
    }

    // Pre-warm a pool of gemini processes. Each process goes through full
    // cold start (SAR extraction, proxy handshake, MCP tool loading) during
    // warmup. By the time processQueue() runs, processes are ready and tasks
    // launch instantly without the ~25s per-process overhead.
    // Skip pool when: explicitly disabled, in test environments, or when
    // isolation mode is enabled (each task needs its own cwd which can't be
    // changed after process start).
    if (!this.config.skipPool && !process.env.OMG_SKIP_POOL && !this.config.isolation) {
      const taskCount = this.tasks.size;
      const poolSize = Math.min(taskCount, this.config.maxParallel);
      if (poolSize > 0) {
        this.pool = new SubAgentPool({
          size: poolSize,
          directory: this.directory,
          agentName: 'parallel-pool',
        });
        const {ready, failed} = await this.pool.warmUp(poolSize);
        log(`[parallel] Pool warmup: ${ready} ready, ${failed} failed`);
      }
    }
  }

  /**
   * Main polling method to be called by an external manager or loop
   */
  public async poll(): Promise<boolean> {
    if (!this.isRunning) return true;
    if (this.isPolling) return false;
    this.isPolling = true;

    try {
      // Direct API pool path: poll for completed HTTP requests
      if (this.usePersistentWorkers && this.persistentPool) {
        const results = this.persistentPool.poll();
        for (const result of results) {
          const task = this.tasks.get(result.id);
          if (task) {
            task.status = result.status;
            task.output = result.output;
            task.error = result.error;
            task.endTime = Date.now();
            if (result.status === 'completed') {
              this.emit('taskCompleted', task);
              log(`[parallel] Task completed (persistent): ${task.description}`);
            } else {
              this.emit('taskFailed', task);
              log(`[parallel] Task failed (persistent): ${task.description} — ${result.error}`);
            }
          }
        }

        const finished = this.persistentPool.isFinished();
        if (finished) {
          this.isRunning = false;
          log(`[parallel] Persistent workers finished: ${this.id}`);
          this.emit('finished', this.getResults());
        }
        return finished;
      }

      // MQ Worker Pool path: poll result files from persistent processes
      if (this.useMqWorkers && this.mqPool) {
        const results = this.mqPool.poll();
        for (const result of results) {
          const task = this.tasks.get(result.id);
          if (task) {
            task.status = result.status;
            task.output = result.output;
            task.error = result.error;
            task.endTime = Date.now();
            if (result.status === 'completed') {
              this.emit('taskCompleted', task);
              log(`[parallel] Task completed (mq): ${task.description}`);
            } else {
              this.emit('taskFailed', task);
              log(`[parallel] Task failed (mq): ${task.description} — ${result.error}`);
            }
          }
        }

        const finished = this.mqPool.isFinished();
        if (finished) {
          this.isRunning = false;
          log(`[parallel] MQ workers finished: ${this.id}`);
          this.emit('finished', this.getResults());
        }
        return finished;
      }

      // Batch Worker Pool path: poll for completed one-shot tasks
      if (this.useExpectWorkers && this.expectPool) {
        const results = this.expectPool.poll();
        for (const result of results) {
          const task = this.tasks.get(result.id);
          if (task) {
            task.status = result.status;
            task.output = result.output;
            task.error = result.error;
            task.endTime = Date.now();
            if (result.status === 'completed') {
              this.emit('taskCompleted', task);
              log(`[parallel] Task completed (expect): ${task.description}`);
            } else {
              this.emit('taskFailed', task);
              log(`[parallel] Task failed (expect): ${task.description} — ${result.error}`);
            }
          }
        }

        const finished = this.expectPool.isFinished();
        if (finished) {
          this.isRunning = false;
          log(`[parallel] Expect workers finished: ${this.id}`);
          this.emit('finished', this.getResults());
        }
        return finished;
      }

      await this.processQueue();
      await this.pollActiveTasks();

      // Import saveParallelExec dynamically to avoid circular dependency
      const {saveParallelExec} = await import('./storage');
      saveParallelExec(this);

      const finished = !this.hasRemainingTasks();
      if (finished) {
        this.isRunning = false;
        log(`[parallel] Parallel coordination finished: ${this.id}`);
        this.emit('finished', this.getResults());
      }
      return finished;
    } finally {
      this.isPolling = false;
    }
  }

  public stop(): void {
    this.isRunning = false;
    log('[parallel] Stopping parallel coordination');
  }

  public async cleanup(): Promise<void> {
    // Drain persistent worker pool
    if (this.persistentPool) {
      await this.persistentPool.drain();
    }

    // Drain MQ worker pool
    if (this.mqPool) {
      await this.mqPool.drain();
    }

    // Drain batch worker pool
    if (this.expectPool) {
      await this.expectPool.drain();
    }

    // Drain any unused warm processes
    if (this.pool) {
      await this.pool.drain();
    }

    if (this.config.isolation) {
      for (const task of this.tasks.values()) {
        if (task.workingDirectory) {
          await cleanupEnvironment(task.workingDirectory);
        }
      }
    }
  }

  public getProgress(): ParallelProgress {
    const total = this.tasks.size;
    let completed = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'running':
          running++;
          break;
        case 'queued':
          queued++;
          break;
      }
    }

    return {
      total,
      completed,
      failed,
      running,
      queued,
      percent: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
    };
  }

  public getResults(): ParallelTask[] {
    return Array.from(this.tasks.values());
  }

  private hasRemainingTasks(): boolean {
    return Array.from(this.tasks.values()).some(
      (t) =>
        t.status === 'pending' ||
        t.status === 'queued' ||
        t.status === 'running',
    );
  }

  /**
   * Build full prompts for persistent worker pool tasks.
   * Replicates the prompt-building logic from BackgroundManager.startSubprocessTask()
   * — agent prefix, skill content, tool restrictions, file reference resolution —
   * without spawning processes.
   */
  private async preparePersistentTasks(): Promise<PersistentTaskInput[]> {
    const results: PersistentTaskInput[] = [];

    for (const task of this.tasks.values()) {
      const parts: string[] = [];

      // --- Resolution Logic (same as processQueue) ---
      let agentToUse = task.agent;
      let skillContent: string | undefined;

      if (this.client && task.category) {
        const resolution = await resolveCategoryExecution(
          {
            category: task.category,
            load_skills: task.skills,
            description: task.description,
            prompt: task.prompt,
            run_in_background: true,
          },
          {
            manager: this.manager!,
            client: this.client,
            directory: this.directory,
            userCategories: this.userCategories,
            gitMasterConfig: this.gitMasterConfig,
            sisyphusJuniorModel: this.sisyphusJuniorModel,
            browserProvider: this.browserProvider,
          },
          undefined,
          undefined,
        );
        if (!resolution.error) {
          agentToUse = resolution.agentToUse;
          const {content: resolvedSkillContent} = await resolveSkillContent(
            task.skills,
            {
              gitMasterConfig: this.gitMasterConfig,
              browserProvider: this.browserProvider,
            },
          );
          skillContent = buildSystemContent({
            skillContent: resolvedSkillContent,
            categoryPromptAppend: resolution.categoryPromptAppend,
            agentName: agentToUse,
          });
        }
      } else if (this.client) {
        const {content: resolvedSkillContent} = await resolveSkillContent(
          task.skills,
          {
            gitMasterConfig: this.gitMasterConfig,
            browserProvider: this.browserProvider,
          },
        );
        if (resolvedSkillContent) {
          skillContent = buildSystemContent({
            skillContent: resolvedSkillContent,
            agentName: agentToUse,
          });
        }
      }

      // Build prompt: @agent prefix + skill content + tool restrictions + user prompt
      if (agentToUse) parts.push(`@${agentToUse}`);

      if (skillContent) {
        parts.push(`[Context]\n${skillContent}\n\n---\n`);
      }

      const restrictions = getAgentToolRestrictions(agentToUse);
      const deniedTools = Object.entries(restrictions)
        .filter(([, allowed]) => !allowed)
        .map(([name]) => name);
      deniedTools.push('delegate_task', 'question');
      if (deniedTools.length > 0) {
        parts.push(
          `<tool-restrictions>\nDo NOT use these tools: ${deniedTools.join(', ')}.\n</tool-restrictions>\n`,
        );
      }

      const resolvedPrompt = await resolveFileReferencesInText(
        task.prompt,
        this.directory,
      );
      parts.push(resolvedPrompt);

      results.push({
        id: task.id,
        prompt: parts.join(' '),
        description: task.description,
      });
    }

    return results;
  }

  private async processQueue(): Promise<void> {
    const pendingTasks = Array.from(this.tasks.values())
      .filter((t) => t.status === 'pending')
      .slice(0, this.config.maxParallel - this.activeTaskIds.size);

    for (const task of pendingTasks) {
      if (this.activeTaskIds.size >= this.config.maxParallel) break;

      try {
        log(`[parallel] Launching task: ${task.description} (${task.id})`);

        let workingDir = this.directory;
        if (this.config.isolation) {
          workingDir = await createIsolatedEnvironment(this.directory);
          task.workingDirectory = workingDir;
        }

        task.status = 'running';
        task.startTime = Date.now();

        if (!this.manager) {
          throw new Error('BackgroundManager not set on ParallelCoordinator');
        }

        // --- Resolution Logic ---
        let agentToUse = task.agent;
        let modelToUse:
          | {providerID: string; modelID: string; variant?: string}
          | undefined;
        let skillContent: string | undefined;
        let isUnstableAgent = false;

        if (this.client) {
          // 1. Resolve Category
          if (task.category) {
            const resolution = await resolveCategoryExecution(
              {
                category: task.category,
                load_skills: task.skills,
                description: task.description,
                prompt: task.prompt,
                run_in_background: true,
              },
              {
                manager: this.manager,
                client: this.client,
                directory: this.directory,
                userCategories: this.userCategories,
                gitMasterConfig: this.gitMasterConfig,
                sisyphusJuniorModel: this.sisyphusJuniorModel,
                browserProvider: this.browserProvider,
              },
              undefined, // inheritedModel
              undefined, // systemDefaultModel
            );

            if (resolution.error) {
              log(
                `[parallel] Category resolution error for task ${task.id}: ${resolution.error}`,
              );
            } else {
              agentToUse = resolution.agentToUse;
              modelToUse = resolution.categoryModel;
              isUnstableAgent = resolution.isUnstableAgent;

              // 2. Resolve Skills
              const {content: resolvedSkillContent} = await resolveSkillContent(
                task.skills,
                {
                  gitMasterConfig: this.gitMasterConfig,
                  browserProvider: this.browserProvider,
                },
              );

              skillContent = buildSystemContent({
                skillContent: resolvedSkillContent,
                categoryPromptAppend: resolution.categoryPromptAppend,
                agentName: agentToUse,
              });
            }
          } else {
            // No category, but still resolve skills if any
            const {content: resolvedSkillContent} = await resolveSkillContent(
              task.skills,
              {
                gitMasterConfig: this.gitMasterConfig,
                browserProvider: this.browserProvider,
              },
            );
            if (resolvedSkillContent) {
              skillContent = buildSystemContent({
                skillContent: resolvedSkillContent,
                agentName: agentToUse,
              });
            }
          }
        } else {
          log(
            `[parallel] WARNING: Resolution context (client) missing for task ${task.id}. Using defaults.`,
          );
        }

        // Try to acquire a pre-warmed process from the pool.
        // Falls back to cold start if pool is empty or not initialized.
        const warmProc = this.pool?.acquire() ?? undefined;
        if (warmProc) {
          log(`[parallel] Using pre-warmed process (pid=${warmProc.pid}) for task ${task.id}`);
        }

        const backgroundTask = await this.manager.launch({
          description: task.description,
          prompt: task.prompt,
          agent: agentToUse,
          parentSessionID: this.parentSessionID,
          parentMessageID: this.parentMessageID,
          category: task.category,
          skills:
            task.skills && task.skills.length > 0 ? task.skills : undefined,
          skillContent: skillContent,
          model: modelToUse,
          isUnstableAgent: isUnstableAgent,
          directory: workingDir,
          concurrencyOverride: this.config.maxParallel,
          logDir: this.logDir,
          preStartedProcess: warmProc,
          skipNotification: this.blockingMode,
        });

        task.taskId = backgroundTask.id;
        this.activeTaskIds.add(task.id);
        this.emit('taskStarted', task);

        // Only delay between launches for cold-started processes (prevents
        // SAR extraction races). Pre-warmed processes launch instantly.
        if (!warmProc && this.config.waveDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.waveDelayMs),
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log(`[parallel] Failed to launch task ${task.id}: ${errorMsg}`);
        task.status = 'failed';
        task.error = errorMsg;
        task.endTime = Date.now();
        this.emit('taskFailed', task);

        if (this.config.stopOnFirstFailure) {
          this.stop();
          break;
        }
      }
    }
  }

  private async pollActiveTasks(): Promise<void> {
    if (!this.manager) return;

    for (const parallelId of Array.from(this.activeTaskIds)) {
      const task = this.tasks.get(parallelId);
      if (!task || !task.taskId) continue;

      try {
        const bgTask = this.manager.getTask(task.taskId);
        if (!bgTask) {
          task.status = 'failed';
          task.error = 'Background task disappeared';
          this.activeTaskIds.delete(parallelId);
          continue;
        }

        if (bgTask.status === 'completed') {
          task.status = 'completed';
          task.output = bgTask.result;
          task.endTime = Date.now();
          this.activeTaskIds.delete(parallelId);
          this.emit('taskCompleted', task);
          log(`[parallel] Task completed: ${task.description} (${task.id})`);
        } else if (bgTask.status === 'error') {
          task.status = 'failed';
          task.error = bgTask.error;
          task.endTime = Date.now();
          this.activeTaskIds.delete(parallelId);
          this.emit('taskFailed', task);
          log(`[parallel] Task failed: ${task.description} (${task.id})`);

          if (this.config.stopOnFirstFailure) {
            this.stop();
          }
        }
      } catch (err) {
        log(`[parallel] Error polling task ${parallelId}: ${err}`);
      }
    }
  }
}

/**
 * Pre-warmed Sub-Agent Process Pool.
 *
 * Gemini CLI's cold start is expensive: SAR extraction (~3s), proxy handshake
 * (~3s), remote MCP tool discovery (~10-15s), extension loading (~5s). For
 * parallel_exec with 10+ tasks, this per-process overhead dominates.
 *
 * The pool pre-starts N gemini processes with `gemini -- -y` (stdin mode).
 * Each process completes its startup sequence and then blocks waiting for
 * stdin input. When a task arrives, we hand out a warm process and pipe the
 * prompt — the cold start is already done.
 *
 * Readiness detection: Time-based. We wait a configurable warmup period
 * for processes to complete startup. If a process exits during warmup, it's
 * marked as failed. We do NOT read stderr during warmup to avoid locking
 * the stream (BackgroundManager needs to read it later for logging).
 */

import {log} from '../../shared/logger';
import {findGeminiPath} from '../../tools/delegate-task/executor';

/** Time to wait for each process to complete cold start */
const WARMUP_MS = 10_000; // 10s — SAR + proxy only (extensions disabled via -e __none__)

export interface PoolOptions {
  /** Number of processes to pre-start */
  size: number;
  /** Working directory for sub-agent processes */
  directory: string;
  /** Agent name to set in OMG_PARENT_AGENT env var */
  agentName?: string;
  /** Custom warmup time in ms (default: 25000) */
  warmupMs?: number;
}

interface PooledProcess {
  proc: any; // Bun.Subprocess — using any to avoid generic type issues
  ready: boolean;
}

export class SubAgentPool {
  private pool: PooledProcess[] = [];
  private geminiPath: string | null = null;
  private directory: string;
  private agentName: string;
  private proxyAddress: string | undefined;
  private warmupMs: number;

  constructor(options: PoolOptions) {
    this.directory = options.directory;
    this.agentName = options.agentName ?? 'pool';
    this.proxyAddress = process.env.GOOGLE_GEMINI_BASE_URL;
    this.warmupMs = options.warmupMs ?? WARMUP_MS;
  }

  /**
   * Pre-start `size` gemini processes. Each process goes through full cold
   * start (SAR, proxy, MCP) and then waits for stdin. Returns after the
   * warmup period, at which point processes should be initialized.
   */
  async warmUp(size: number): Promise<{ready: number; failed: number}> {
    this.geminiPath = findGeminiPath();
    if (!this.geminiPath) {
      log('[pool] Cannot find gemini binary');
      return {ready: 0, failed: size};
    }

    // Pool requires a shared proxy (GOOGLE_GEMINI_BASE_URL). Without it,
    // each process starts its own proxy (~6s), negating the cold start benefit.
    if (!this.proxyAddress) {
      log('[pool] No shared proxy available (GOOGLE_GEMINI_BASE_URL not set). Skipping pool warmup.');
      return {ready: 0, failed: size};
    }

    log(`[pool] Pre-starting ${size} sub-agent processes (warmup: ${this.warmupMs}ms)...`);
    const startTime = Date.now();

    // Spawn all processes simultaneously
    const spawned: PooledProcess[] = [];
    for (let i = 0; i < size; i++) {
      const pooled = this.spawnOne();
      if (pooled) {
        spawned.push(pooled);
      }
    }

    // Wait for warmup period. During this time, processes are loading SAR,
    // connecting to proxy, discovering MCP tools, etc. We race against
    // process exit to detect failures early.
    const exitChecks = spawned.map(async (p) => {
      try {
        // If the process exits before warmup completes, it failed
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, this.warmupMs)),
          p.proc.exited.then(() => {
            throw new Error(
              `Process ${p.proc.pid} exited during warmup (code ${p.proc.exitCode})`,
            );
          }),
        ]);
        p.ready = true;
      } catch (err) {
        log(`[pool] Process failed during warmup: ${err}`);
        p.ready = false;
      }
    });

    await Promise.allSettled(exitChecks);

    const ready = spawned.filter((p) => p.ready);
    const failed = spawned.filter((p) => !p.ready);

    // Only keep ready processes
    this.pool = ready;

    // Kill failed processes
    for (const p of failed) {
      try {
        p.proc.kill();
      } catch {
        // Already dead
      }
    }

    const elapsed = Date.now() - startTime;
    log(
      `[pool] Warmup complete: ${ready.length}/${size} ready in ${elapsed}ms`,
    );

    return {ready: ready.length, failed: failed.length};
  }

  /**
   * Acquire a warm process from the pool. Returns null if pool is empty.
   * The caller is responsible for writing to stdin and reading stdout/stderr.
   */
  acquire(): any | null {
    const pooled = this.pool.shift();
    if (!pooled) return null;
    return pooled.proc;
  }

  /** Number of warm processes available */
  get available(): number {
    return this.pool.length;
  }

  /** Kill all remaining processes in the pool */
  async drain(): Promise<void> {
    for (const pooled of this.pool) {
      try {
        pooled.proc.kill();
      } catch {
        // Already dead
      }
    }
    this.pool = [];
  }

  private spawnOne(): PooledProcess | null {
    if (!this.geminiPath) return null;

    const args: string[] = [this.geminiPath];
    if (this.proxyAddress) {
      args.push(`--proxy_address=${this.proxyAddress}`);
    }
    args.push('--output-format', 'json', '--', '-y', '-e', '__none__');

    const proc = Bun.spawn(args, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: this.directory,
      env: {
        ...process.env,
        GLOG_minloglevel: '2',
        OMG_PARENT_AGENT: this.agentName,
      },
    });

    return {proc, ready: false};
  }
}

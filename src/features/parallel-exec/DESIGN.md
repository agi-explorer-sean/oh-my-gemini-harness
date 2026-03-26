# Parallel Execution — Design Document

## Problem

When partitioning work across N independent sub-agents (e.g., auditing 20 files
for security vulnerabilities), how should the parent orchestrator spawn, monitor,
and collect results from concurrent agents?

Gemini CLI has no programmatic session API. Each sub-agent must run as a
separate `gemini` OS process.

## Approaches

Two architectures exist in the Gemini CLI extension ecosystem:

### A. MCP Tool + Background Polling (oh-my-gemini — current)

The `parallel_exec` MCP tool launches sub-agents via `BackgroundManager`, which
spawns `gemini -- -y -p <prompt>` child processes. The parent model polls
`background_output` periodically to check for completion.

```
Parent Model
  │
  ├─ call parallel_exec(tasks=20, max_parallel=10)
  │   └─ BackgroundManager.launch() × 20
  │       ├─ ConcurrencyManager.acquire() — limits to max_parallel
  │       └─ Bun.spawn("gemini --proxy_address=... -- -y -p <prompt>")
  │
  ├─ sleep(60s)
  ├─ call background_output(task_id) → "still running..."
  ├─ sleep(60s)
  ├─ call background_output(task_id) → "still running..."
  ├─ sleep(60s)
  ├─ call background_output(task_id) → results!
  └─ format and output report
```

**Files:**
- `src/features/parallel-exec/coordinator.ts` — `ParallelCoordinator` manages
  task queue, launches via `BackgroundManager`, polls active tasks
- `src/features/background-agent/manager.ts` — `BackgroundManager` spawns
  subprocesses, tracks lifecycle
- `src/features/background-agent/concurrency.ts` — `ConcurrencyManager`
  semaphore with per-model/agent limits
- `src/tools/parallel-exec/tools.ts` — MCP tool definition, task expansion

### B. External Blocking Script (Maestro)

The orchestrator writes prompt files to a dispatch directory, then calls an
external Node.js script via shell. The script spawns all `gemini` processes,
collects results with `Promise.all()`, writes structured output to files, and
exits. The orchestrator's next model turn only fires after all agents complete.

Reference: https://github.com/josstei/maestro-gemini

```
Parent Model
  │
  ├─ write prompts to .gemini/state/parallel/<batch>/prompts/
  ├─ call run_in_terminal("node parallel-dispatch.js <batch-dir>")
  │   └─ parallel-dispatch.js:
  │       ├─ ConcurrencyLimiter.acquire() × N
  │       ├─ spawn("gemini --approval-mode=yolo --output-format json")
  │       │   stdin ← prompt content
  │       │   stdout → results/<agent>.json
  │       │   stderr → results/<agent>.log
  │       ├─ Promise.all(agentPromises)
  │       └─ write results/summary.json, exit
  │
  └─ read results/summary.json + per-agent JSON → format report
```

**Files (Maestro):**
- `scripts/parallel-dispatch.js` — standalone Node.js dispatch script
- `src/lib/dispatch/concurrency-limiter.js` — semaphore
- `src/lib/dispatch/process-runner.js` — process spawning with timeout

## Comparison

### Pros of Current Design (MCP Tool + Polling)

| Advantage | Detail |
|-----------|--------|
| **Non-blocking** | Parent model can do other work while sub-agents run. Useful for mixed workloads ("audit these files AND refactor this function"). |
| **Progressive results** | Early finishers are available immediately. If 18/20 agents finish in 60s but 2 stragglers take 5 min, the parent can start processing results while waiting. |
| **Interactive monitoring** | User can ask "how's the audit going?" and the parent reports progress via `parallel_status`. |
| **Graceful partial failure** | If one agent hangs, the parent can cancel it and report partial results. No all-or-nothing timeout. |
| **No file I/O** | Prompts and results stay in memory. No disk serialization overhead. |
| **Reuses infrastructure** | `BackgroundManager` already exists for `delegate_task`. `parallel_exec` is "launch N of them" — minimal new code. |
| **MCP-native** | Works through standard MCP tool interface. No dependency on `run_in_terminal` which may have its own timeout behavior. |

### Cons of Current Design

| Disadvantage | Detail |
|--------------|--------|
| **Polling wastes model turns** | 4-6 model turns spent on `sleep(60)` + `background_output` loops. Each turn costs API quota and latency. |
| **No structured output** | Sub-agents return raw text. Maestro uses `--output-format json` for machine-parseable results. |
| **Polling interval trade-off** | Poll too often → exhaust turn budget. Poll too rarely → delay result collection after completion. |
| **Prompt engineering required** | Parent must be told "wait at least 60 seconds between polls" to avoid wasting turns. |

### Pros of Maestro's Approach (Blocking Script)

| Advantage | Detail |
|-----------|--------|
| **Zero polling overhead** | Script blocks until all agents complete. Parent's next turn fires with results already available. |
| **Structured JSON output** | `--output-format json` gives machine-parseable results per agent. |
| **Clean result collection** | `summary.json` with per-agent status, exit codes, wall time. |
| **Stagger delay** | Configurable delay between launches (default 5s) to reduce API contention. |
| **Timeout per agent** | Individual agent timeout (default 10 min) prevents infinite hangs. |

### Cons of Maestro's Approach

| Disadvantage | Detail |
|--------------|--------|
| **Blocking** | Parent model is frozen until ALL agents complete. Cannot do other work in parallel. |
| **No mid-execution visibility** | User sees nothing until the entire batch finishes. No progress reporting. |
| **All-or-nothing timeout** | If one agent hangs, the entire `run_in_terminal` call blocks until the per-agent timeout fires (default 10 min). |
| **File I/O overhead** | Prompt files written to disk, results read back. Extra serialization step. |
| **External script dependency** | Separate `parallel-dispatch.js` must be maintained alongside the MCP tools. |
| **`run_in_terminal` constraints** | Shell tool may have its own timeout, output buffering, or quoting issues with large prompts. |

## Concurrency Bug Fix (2026-02-25)

Before the fix, `max_parallel` only controlled task queuing in
`ParallelCoordinator.processQueue()`, but `ConcurrencyManager.acquire()` had a
hardcoded default limit of 5. Setting `max_parallel=20` still ran 5 at a time.

**Fix**: Added `concurrencyOverride` field to `LaunchInput`. When
`ParallelCoordinator` launches tasks, it passes
`concurrencyOverride: this.config.maxParallel` to `BackgroundManager.launch()`,
which forwards it to `ConcurrencyManager.acquire(key, overrideLimit)`.

### Benchmark Results (20 files, security audit)

| max_parallel | Time | Success | Pattern |
|---|---|---|---|
| 5 (old default) | 4m 30s | 20/20 | 4 rigid waves, no concurrency override |
| **10 (new default)** | **3m 16s** | **20/20** | **2 flowing waves — optimal** |
| 20 | 7m 52s | 20/20 | 1 wave, API tail latency on 2-3 agents |

Optimal concurrency is ~10: avoids API rate-limiting tail latency (seen at 20)
while reducing wave serialization overhead (seen at 5).

## Improvements (Implemented 2026-02-25)

1. **`--output-format json`** ✅ — Sub-agents now run with `--output-format json`.
   The subprocess handler in `manager.ts` parses the JSON response to extract
   the `response` field, giving structured output with session_id and token
   stats. Falls back to raw stdout if JSON parsing fails.

2. **Adaptive polling** ✅ — The `parallel_exec` tool response now includes
   estimated completion time based on task count and concurrency
   (`waves × 20s` to `waves × 90s`), with an explicit minimum wait instruction
   before the first poll. This reduces wasted polling turns from ~6 to ~2.

3. **Hybrid mode** ✅ — Both blocking (`run_in_background: false`) and
   non-blocking modes are supported. Blocking mode polls in-process every 2s
   and returns a formatted report with all results. Non-blocking mode returns
   immediately with a task ID for later polling. Blocking mode is suitable for
   batch-only workloads where the parent has no other work.

4. **Skip MCP server for sub-agents** ✅ — When `OMG_PARENT_AGENT` is set,
   `startMcpServer()` starts a minimal empty MCP server (no tools, no plugin
   initialization) to satisfy the protocol handshake. This eliminates N heavy
   Bun processes from the process tree during parallel execution (no
   BackgroundManager, hooks, or skill loader initialization per sub-agent).

## Worker Pool Experiments (2026-03)

To eliminate per-task cold start overhead in `read_write` mode, several
approaches were tested for keeping gemini CLI processes alive across multiple
tasks.

### Background

Each `read_write` task spawns a fresh `gemini -p "prompt"` subprocess. Per-task
cold start breakdown:

| Component | Time |
|-----------|------|
| SAR extraction | ~3-5s |
| Proxy startup | ~5s |
| MCP extension loading | ~5-10s |
| **Total cold start** | **~15-20s** |

For 20 tasks across 5 workers, the batch subprocess approach (one process per
task) incurs 20 cold starts. If workers could be reused, only 5 cold starts
would be needed, saving ~15 × 15s = ~225s.

### Approaches Tested

#### 1. Expect PTY Workers — Failed

Spawn persistent gemini processes via `expect` (PTY allocation) so the model
stays in interactive mode and receives sequential prompts.

**Result:** gemini renders full TUI (ANSI escape codes, box-drawing characters)
when it detects a PTY. Output is unparseable.

#### 2. Piped stdin/stdout — Failed

Spawn gemini with piped stdin/stdout, send prompts via stdin, read responses
from stdout.

**Result:** Node.js fully buffers stdout when piped to a non-TTY. Data only
flushes on process exit. `stdbuf -oL` doesn't help because Node.js uses its own
IO layer.

#### 3. `script -qc` PTY — Failed

Use `script -qc` to allocate a pseudo-TTY without `expect`.

**Result:** gemini still renders TUI with `--output-format json`.

#### 4. Batch Subprocess Pool (`ExpectWorkerPool`) — Working Baseline

One-shot `gemini -p "prompt"` per task. Tasks distributed round-robin across N
worker lanes. Each lane runs tasks sequentially. No process reuse.

**Result:** Working. Current production approach.

#### 5. MCP Task Queue Pool (`MqWorkerPool`) — Working, Slower

Persistent gemini processes with MCP tools (`worker_get_task`,
`worker_report_result`) for file-based task queue communication. Each worker
loops: get task → execute → report result → repeat until done.

**Architecture:**
```
Coordinator                    Gemini Process (1 per worker)
─────────                      ──────────────────────────────
write tasks to                 gemini -y -e oh-my-gemini -p "Loop prompt"
/tmp/omg-mq-{ts}/                   │
  worker-{id}-tasks.json ─────►     │ calls worker_get_task (MCP tool)
                                    │ ◄── returns {prompt, id}
                                    │
                                    │ model executes (read_file, write_file, etc.)
                                    │
read results from                   │ calls worker_report_result (MCP tool)
  worker-{id}-results.json ◄────    │ ──► appends {id, output, status}
                                    │
                                    │ calls worker_get_task again
                                    │ ◄── returns {done: true}
                                    │
                               process exits naturally
```

**Files:**
- `src/tools/parallel-exec/worker-tools.ts` — `worker_get_task` and
  `worker_report_result` MCP tool definitions
- `src/features/parallel-exec/persistent-pool.ts` — `MqWorkerPool` class
- `src/features/parallel-exec/coordinator.ts` — MQ pool integration (tried
  first, falls back to `ExpectWorkerPool`)

**Result:** Working end-to-end. All tasks complete correctly. But **slower than
batch subprocess** due to loop overhead.

### Benchmark Results

#### 20-Task Security Audit (5 workers)

| Metric | Batch Subprocess | MQ Pool |
|--------|:---:|:---:|
| **parallel_exec time** | **~362s** | **432.7s** |
| Cold starts | 20 | 5 |
| API calls per task | ~2 | ~4 |
| Worker crashes | Rare | 4/5 (exit=1) |
| Tasks needing retry | ~0 | 8/20 |

#### 5-Task Audit (2 workers)

| Metric | Batch Subprocess | MQ Pool |
|--------|:---:|:---:|
| **parallel_exec time** | **~150s** (est.) | **238.5s** |
| Worker crashes | 0 | 0 |

#### Per-Task Time Breakdown

| Component | Batch (per task) | MQ Pool (1st task) | MQ Pool (2nd+ task) |
|-----------|:---:|:---:|:---:|
| SAR + proxy + MCP | ~15-20s | ~15-20s | 0 (reused) |
| `worker_get_task` call | N/A | ~5s | ~5s |
| Model API (actual work) | ~20s | ~20s | ~20-30s (context grows) |
| `worker_report_result` call | N/A | ~5s | ~5s |
| **Total** | **~35-40s** | **~45-65s** | **~30-40s** |

### Why MQ Pool Is Slower

| Factor | Saves | Costs |
|--------|:---:|:---:|
| Cold start elimination (15 saved) | **-225s** | — |
| Loop overhead (2 extra API calls × 20 tasks) | — | **+200s** |
| MCP extension loading per worker (5 workers) | — | **+40s** |
| Context accumulation (later tasks slower) | — | **+50-100s** |
| Worker crashes → retries | — | **+variable** |

### Known Limitation: Context Accumulation

In the MQ pool, all tool calls happen within one conversation turn per worker.
Each task's tool calls (get_task, read_file, write_file, report_result) add to
the context. By task 4 in a worker, the context includes all prior tasks'
history. There is no way to clear conversation context mid-session in gemini
CLI's non-interactive mode — the `/clear` command only works in interactive mode,
and stdin piping doesn't work (approach #2 above).

### Conclusion

The MQ pool trades cold start savings for loop overhead. For short independent
tasks (~20-30s work each), the 2 extra API calls per task (+200s total) exceed
the cold start savings (-225s). **Batch subprocess remains faster** for this
workload pattern.

The MQ pool may win for:
- Very long tasks (minutes each) where cold start is a larger fraction
- Very high task-to-worker ratios (100+ tasks, 5 workers)
- A lighter communication protocol that avoids extra model API calls

Both implementations are retained in the codebase. The coordinator tries MQ pool
first (can be skipped with `OMG_SKIP_MQ_POOL=1`) and falls back to batch
subprocess.

## Decision

The current MCP-based polling design is retained because:

- Non-blocking execution is genuinely useful for production workflows beyond
  benchmarks.
- The polling cost (now ~2 turns with adaptive polling) is minimal relative to
  typical turn budgets (50+).
- The concurrency fix (`concurrencyOverride`) resolved the actual performance
  bottleneck — the architectural pattern was not the issue.
- The infrastructure is shared with `delegate_task` and `background_output`,
  reducing maintenance burden.
- Structured JSON output, adaptive polling, and minimal sub-agent MCP servers
  address the main efficiency gaps identified in the comparison.

import { z } from "zod"

export const ParallelTaskStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
])

export type ParallelTaskStatus = z.infer<typeof ParallelTaskStatusSchema>

export const ParallelTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  prompt: z.string(),
  status: ParallelTaskStatusSchema,
  agent: z.string().default("sisyphus-junior"),
  category: z.string().optional(),
  skills: z.array(z.string()).default([]),
  taskId: z.string().optional(), // BackgroundManager task ID
  sessionID: z.string().optional(), // Subagent session ID
  workingDirectory: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  logDir: z.string().optional(), // Directory containing per-agent log files
})

export type ParallelTask = z.infer<typeof ParallelTaskSchema>

export const ParallelConfigSchema = z.object({
  maxParallel: z.number().min(1).default(5),
  waveDelayMs: z.number().min(0).default(2000),
  pollIntervalMs: z.number().min(500).default(2000),
  stopOnFirstFailure: z.boolean().default(false),
  isolation: z.boolean().default(false),
  synthesis: z.boolean().default(false),
  /** Skip pre-warmed process pool (for testing) */
  skipPool: z.boolean().default(false),
  /**
   * Execution mode:
   * - read_only:  Direct API calls (zero cold start, text-only output, no tool access)
   * - read_write: SubAgentPool subprocesses (cold start, full tool/shell access)
   */
  mode: z.enum(['read_only', 'read_write']).default('read_only'),
})

export type ParallelConfig = z.infer<typeof ParallelConfigSchema>

export interface ParallelProgress {
  total: number
  completed: number
  failed: number
  running: number
  queued: number
  percent: number
}

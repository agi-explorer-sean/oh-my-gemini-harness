export type BackgroundTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

export type BackgroundTaskType = 'task' | 'parallel_exec';

export interface TaskProgress {
  toolCalls: number;
  lastTool?: string;
  lastUpdate: Date;
  lastMessage?: string;
  lastMessageAt?: Date;
}

export interface BackgroundTask {
  id: string;
  type?: BackgroundTaskType;
  sessionID?: string;
  parentSessionID: string;
  parentMessageID: string;
  description: string;
  prompt: string;
  agent: string;
  status: BackgroundTaskStatus;
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  progress?: TaskProgress;
  parentModel?: {providerID: string; modelID: string};
  model?: {providerID: string; modelID: string; variant?: string};
  /** Active concurrency slot key */
  concurrencyKey?: string;
  /** Persistent key for re-acquiring concurrency on resume */
  concurrencyGroup?: string;
  /** Parent session's agent name for notification */
  parentAgent?: string;
  /** Marks if the task was launched from an unstable agent/category */
  isUnstableAgent?: boolean;
  /** Category used for this task (e.g., 'quick', 'visual-engineering') */
  category?: string;
  /** Skills loaded for this task */
  skills?: string[];
  /** Working directory for this task */
  directory?: string;
  /** Last message count for stability detection */
  lastMsgCount?: number;
  /** Number of consecutive polls with stable message count */
  stablePolls?: number;
  /** Skip sending notifications on completion (used by blocking parallel_exec) */
  skipNotification?: boolean;
}

export interface ParallelTaskResult {
  description: string;
  status: string;
  output?: string;
  error?: string;
  taskId?: string;
}

export interface CompositeBackgroundTask extends BackgroundTask {
  type: 'parallel_exec';
  subTaskIds: string[];
  parallelConfig?: any; // Will be ParallelConfig but avoid circular dep
  /** Cached results from coordinator, persisted after coordinator is deleted */
  parallelResults?: ParallelTaskResult[];
}

export interface LaunchInput {
  description: string;
  prompt: string;
  agent: string;
  parentSessionID: string;
  parentMessageID: string;
  parentModel?: {providerID: string; modelID: string};
  parentAgent?: string;
  model?: {providerID: string; modelID: string; variant?: string};
  isUnstableAgent?: boolean;
  skills?: string[];
  skillContent?: string;
  category?: string;
  directory?: string;
  /** Override the default concurrency limit for this launch.
   *  Used by ParallelCoordinator which manages its own concurrency. */
  concurrencyOverride?: number;
  /** Directory to write per-agent log files (stdout, stderr, metadata) */
  logDir?: string;
  /** Pre-started subprocess from a warm pool. If provided, the manager skips
   *  spawning a new gemini process and uses this one instead (piping prompt
   *  via stdin). The process must already be initialized and waiting for input. */
  preStartedProcess?: import('bun').Subprocess;
  /** Skip sending notifications when the task completes. Used by
   *  ParallelCoordinator in blocking (foreground) mode where the MCP tool
   *  already returns the combined report — individual notifications would
   *  trigger redundant model turns. */
  skipNotification?: boolean;
}

export interface ResumeInput {
  sessionId: string;
  prompt: string;
  parentSessionID: string;
  parentMessageID: string;
  parentModel?: {providerID: string; modelID: string};
  parentAgent?: string;
}

import type {BackgroundTaskConfig} from '../../config/schema';
import {log} from '../../shared/logger';

/**
 * Queue entry with settled-flag pattern to prevent double-resolution.
 *
 * The settled flag ensures that cancelWaiters() doesn't reject
 * an entry that was already resolved by release().
 */
interface QueueEntry {
  resolve: () => void;
  rawReject: (error: Error) => void;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export class ConcurrencyManager {
  private config?: BackgroundTaskConfig;
  private counts: Map<string, number> = new Map();
  private queues: Map<string, QueueEntry[]> = new Map();
  private readonly ACQUIRE_TIMEOUT_MS = 60000; // 60 seconds timeout for queueing

  constructor(config?: BackgroundTaskConfig) {
    this.config = config;
  }

  getConcurrencyLimit(model: string): number {
    const modelLimit = this.config?.modelConcurrency?.[model];
    if (modelLimit !== undefined) {
      return modelLimit === 0 ? Infinity : modelLimit;
    }
    const provider = model.split('/')[0];
    const providerLimit = this.config?.providerConcurrency?.[provider];
    if (providerLimit !== undefined) {
      return providerLimit === 0 ? Infinity : providerLimit;
    }
    const defaultLimit = this.config?.defaultConcurrency;
    if (defaultLimit !== undefined) {
      return defaultLimit === 0 ? Infinity : defaultLimit;
    }
    return 5;
  }

  async acquire(model: string, overrideLimit?: number): Promise<void> {
    const limit = overrideLimit ?? this.getConcurrencyLimit(model);
    if (limit === Infinity) {
      return;
    }

    const current = this.counts.get(model) ?? 0;
    if (current < limit) {
      this.counts.set(model, current + 1);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(model) ?? [];

      const timer = setTimeout(() => {
        if (entry.settled) return;
        entry.settled = true;

        // Remove from queue
        const currentQueue = this.queues.get(model);
        if (currentQueue) {
          const index = currentQueue.indexOf(entry);
          if (index !== -1) {
            currentQueue.splice(index, 1);
          }
        }

        const error = new Error(
          `Concurrency acquire timed out after ${this.ACQUIRE_TIMEOUT_MS}ms for model: ${model}`,
        );
        log(`[concurrency] ${error.message}`);
        reject(error);
      }, this.ACQUIRE_TIMEOUT_MS);

      const entry: QueueEntry = {
        resolve: () => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          resolve();
        },
        rawReject: (err) => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          reject(err);
        },
        settled: false,
        timer,
      };

      queue.push(entry);
      this.queues.set(model, queue);
    });
  }

  release(model: string): void {
    const limit = this.getConcurrencyLimit(model);
    if (limit === Infinity) {
      return;
    }

    const queue = this.queues.get(model);

    // Try to hand off to a waiting entry (skip any settled entries from cancelWaiters or timeouts)
    while (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (!next.settled) {
        // Hand off the slot to this waiter (count stays the same)
        next.resolve();
        return;
      }
    }

    // No handoff occurred - decrement the count to free the slot
    const current = this.counts.get(model) ?? 0;
    if (current > 0) {
      this.counts.set(model, current - 1);
    }
  }

  /**
   * Cancel all waiting acquires for a model. Used during cleanup.
   */
  cancelWaiters(model: string): void {
    const queue = this.queues.get(model);
    if (queue) {
      for (const entry of queue) {
        if (!entry.settled) {
          entry.rawReject(
            new Error(`Concurrency queue cancelled for model: ${model}`),
          );
        }
      }
      this.queues.delete(model);
    }
  }

  /**
   * Clear all state. Used during manager cleanup/shutdown.
   * Cancels all pending waiters.
   */
  clear(): void {
    for (const [model] of this.queues) {
      this.cancelWaiters(model);
    }
    this.counts.clear();
    this.queues.clear();
  }

  /**
   * Get current count for a model (for testing/debugging)
   */
  getCount(model: string): number {
    return this.counts.get(model) ?? 0;
  }

  /**
   * Get queue length for a model (for testing/debugging)
   */
  getQueueLength(model: string): number {
    return this.queues.get(model)?.length ?? 0;
  }
}

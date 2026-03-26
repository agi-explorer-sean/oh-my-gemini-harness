/**
 * Background Task Notification via AfterAgent.
 *
 * In the session API path, BackgroundManager.notifyParentSession() calls
 * session.prompt() to inject notifications. In Gemini CLI mode, session.prompt
 * is unavailable, so notifications are written to a file. This AfterAgent
 * handler reads and drains that file on each model turn.
 *
 * When background tasks are active but no notification file exists yet, the
 * handler sleep-polls (blocking the hook process, NOT the model) until either
 * notifications appear or a timeout expires. This ensures the model receives
 * results without user intervention.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {AfterAgentHandler, AfterAgentResult} from '../../cli/dispatch/after-agent';

const NOTIFICATION_FILE = '.gemini/omg-background-notifications.json';
const TASK_STATE_FILE = '.gemini/omg-background-tasks.json';

/** Default timeout for sleep-polling: 9 minutes.
 * Must be shorter than hooks.json AfterAgent timeout (600000ms = 10 min).
 * 9 minutes covers 20-file parallel runs with max_parallel=10 (2 waves ×
 * ~3-4 min each). If the poll times out, the relay pattern continues:
 * Gemini CLI fires AfterAgent for deny responses, so a second poll cycle
 * picks up results that arrive after the first timeout. */
const PARALLEL_WAIT_TIMEOUT_MS = 540_000;
/** Polling interval: 2 seconds */
const POLL_INTERVAL_MS = 2_000;

/**
 * Write a notification to the file-based queue.
 * Called by BackgroundManager.notifyParentSession() when session.prompt fails.
 */
export function writeNotification(directory: string, notification: string): void {
  const filePath = path.join(directory, NOTIFICATION_FILE);
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  let existing: string[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }
  existing.push(notification);
  fs.writeFileSync(filePath, JSON.stringify(existing));
}

/**
 * Read and drain all pending notifications.
 * Returns the notifications and removes the file atomically.
 */
function readAndDrainNotifications(directory: string): string[] {
  const filePath = path.join(directory, NOTIFICATION_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as string[];
    fs.unlinkSync(filePath);
    return data;
  } catch {
    return [];
  }
}

/**
 * Check whether there are running background tasks by reading the state file
 * written by BackgroundManager.persistTaskState().
 */
function hasRunningBackgroundTasks(directory: string): boolean {
  const filePath = path.join(directory, TASK_STATE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Grace period after tasks disappear from state file before giving up.
 * Covers the race between persistTaskState() and writeNotification() in
 * the MCP server process — the state file is cleared before the notification
 * file is written. */
const GRACE_PERIOD_MS = 10_000;

/**
 * Sleep-poll for notifications. The hook process blocks (synchronous sleep)
 * while waiting — no model tokens are burned during the wait.
 *
 * Returns collected notifications, or an empty array on timeout.
 */
function pollForNotifications(
  directory: string,
  timeoutMs: number = PARALLEL_WAIT_TIMEOUT_MS,
  intervalMs: number = POLL_INTERVAL_MS,
): string[] {
  const start = Date.now();
  let graceDeadline = 0;

  while (Date.now() - start < timeoutMs) {
    const notifications = readAndDrainNotifications(directory);
    if (notifications.length > 0) return notifications;

    const hasRunning = hasRunningBackgroundTasks(directory);

    if (!hasRunning) {
      // Tasks are no longer running. But notification write may lag behind
      // state file update (persistTaskState runs before writeNotification
      // in the MCP server process). Give a grace period.
      if (graceDeadline === 0) {
        graceDeadline = Date.now() + GRACE_PERIOD_MS;
      }
      if (Date.now() >= graceDeadline) {
        return []; // Grace period expired, truly no notifications
      }
    } else {
      graceDeadline = 0; // Reset grace if tasks reappear
    }

    // Synchronous sleep — this is a hook process, blocking is intentional
    Bun.sleepSync(intervalMs);
  }
  return [];
}

export const backgroundNotificationAfterAgentHandler: AfterAgentHandler = {
  name: 'background-notification',
  priority: 40,
  handle: (ctx): AfterAgentResult => {
    // Quick check: any notifications already waiting?
    const immediate = readAndDrainNotifications(ctx.directory);
    if (immediate.length > 0) {
      return {
        decision: 'deny',
        reason: immediate.join('\n\n'),
        hookSpecificOutput: {hookEventName: 'AfterAgent', clearContext: false},
      };
    }

    // Check if background tasks are currently running
    if (!hasRunningBackgroundTasks(ctx.directory)) {
      return {decision: 'allow'};
    }

    // Sleep-poll until notifications arrive or timeout
    const notifications = pollForNotifications(ctx.directory);
    if (notifications.length > 0) {
      return {
        decision: 'deny',
        reason: notifications.join('\n\n'),
        hookSpecificOutput: {hookEventName: 'AfterAgent', clearContext: false},
      };
    }

    // Timeout: tell model tasks are still running. Note: Gemini CLI only
    // gives ONE deny turn per user message, so this is effectively the
    // last chance. The user will need to send a follow-up message.
    return {
      decision: 'deny',
      reason: '<system-reminder>Background tasks still in progress. Say "Background tasks are still running. Waiting for next update cycle..." and nothing else. Do NOT call any tools. The system will continue polling automatically.</system-reminder>',
      hookSpecificOutput: {hookEventName: 'AfterAgent', clearContext: false},
    };
  },
};

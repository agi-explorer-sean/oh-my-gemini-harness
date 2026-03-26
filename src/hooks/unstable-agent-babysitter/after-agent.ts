/**
 * Unstable Agent Babysitter via AfterAgent.
 *
 * In the session API path, the babysitter uses session.idle + session.messages
 * + session.prompt. In Gemini CLI mode, AfterAgent fires after each model turn.
 * This handler reads task state from a file persisted by BackgroundManager.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {AfterAgentHandler, AfterAgentResult} from '../../cli/dispatch/after-agent';

const TASK_STATE_FILE = '.gemini/omg-background-tasks.json';
const DEFAULT_TIMEOUT_MS = 120_000;

interface TaskState {
  id: string;
  description: string;
  agent?: string;
  status: string;
  startedAt?: number;
  lastMessageAt?: number;
  isUnstableAgent?: boolean;
  model?: {modelID?: string};
}

function isUnstableTask(task: TaskState): boolean {
  if (task.isUnstableAgent) return true;
  const modelId = task.model?.modelID?.toLowerCase();
  return modelId
    ? modelId.includes('gemini') || modelId.includes('minimax')
    : false;
}

function readTaskState(directory: string): TaskState[] {
  try {
    const filePath = path.join(directory, TASK_STATE_FILE);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

export const babysitterAfterAgentHandler: AfterAgentHandler = {
  name: 'unstable-agent-babysitter',
  priority: 50,
  handle: (ctx): AfterAgentResult => {
    const tasks = readTaskState(ctx.directory);
    const now = Date.now();

    for (const task of tasks) {
      if (task.status !== 'running') continue;
      if (!isUnstableTask(task)) continue;

      const idleMs = now - (task.lastMessageAt ?? task.startedAt ?? now);
      if (idleMs < DEFAULT_TIMEOUT_MS) continue;

      const idleSeconds = Math.round(idleMs / 1000);
      const reminder = `<system-reminder>
Unstable background agent appears idle for ${idleSeconds}s.
Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent ?? 'unknown'}
Use background_output task_id="${task.id}" to check status.
</system-reminder>`;

      return {decision: 'deny', reason: reminder};
    }
    return {decision: 'allow'};
  },
};

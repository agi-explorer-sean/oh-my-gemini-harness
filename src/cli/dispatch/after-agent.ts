/**
 * AfterAgent handler registry for Gemini CLI dispatch.
 *
 * Gemini CLI's AfterAgent hook fires after every model turn and can return
 * {decision: "deny", reason: "<prompt>"} to force a new turn. This module
 * provides a priority-ordered handler registry so multiple features can
 * participate in AfterAgent without modifying dispatch logic.
 */

export interface AfterAgentHandler {
  name: string;
  priority: number; // lower = higher priority
  handle: (
    ctx: AfterAgentContext,
  ) => Promise<AfterAgentResult> | AfterAgentResult;
}

export interface AfterAgentContext {
  directory: string;
  prompt: string;
  promptResponse: string;
  stopHookActive: boolean;
}

export interface AfterAgentResult {
  decision: 'allow' | 'deny';
  reason?: string;
  continue?: boolean;
  systemMessage?: string;
  hookSpecificOutput?: {hookEventName: 'AfterAgent'; clearContext?: boolean};
}

/**
 * Run all AfterAgent handlers in priority order (lowest number first).
 * First handler returning `deny` wins — its result is returned immediately.
 * If all handlers return `allow`, returns `{decision: "allow"}`.
 */
export async function runAfterAgentHandlers(
  handlers: AfterAgentHandler[],
  ctx: AfterAgentContext,
): Promise<AfterAgentResult> {
  const sorted = [...handlers].sort((a, b) => a.priority - b.priority);
  for (const handler of sorted) {
    try {
      const result = await handler.handle(ctx);
      if (result.decision === 'deny') {
        return result;
      }
    } catch {
      // Individual handler failure should not block other handlers
    }
  }
  return {decision: 'allow'};
}

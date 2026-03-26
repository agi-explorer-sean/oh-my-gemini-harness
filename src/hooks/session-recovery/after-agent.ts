/**
 * Session Recovery via AfterAgent.
 *
 * Detects recoverable errors in promptResponse and applies storage-level fixes.
 * Only thinking_block_order and thinking_disabled_violation are recoverable
 * via AfterAgent (these operate on local message files, no session API needed).
 * tool_result_missing requires tool_use IDs from the failed message which
 * aren't available in promptResponse text — deferred.
 */

import type {AfterAgentHandler, AfterAgentResult} from '../../cli/dispatch/after-agent';
import {detectErrorType} from './index';
import {
  findMessagesWithOrphanThinking,
  findMessagesWithThinkingBlocks,
  prependThinkingPart,
  stripThinkingParts,
} from './storage';

const RECOVERY_RESUME_TEXT = '[session recovered - continuing previous task]';

export const sessionRecoveryAfterAgentHandler: AfterAgentHandler = {
  name: 'session-recovery',
  priority: 10,
  handle: (ctx): AfterAgentResult => {
    // Check prompt_response for error patterns
    const errorType = detectErrorType({message: ctx.promptResponse});
    if (!errorType) return {decision: 'allow'};

    // Apply storage-level fixes (local message files, no session API)
    let fixed = false;
    const sessionID = 'native-session';

    if (errorType === 'thinking_block_order') {
      const orphans = findMessagesWithOrphanThinking(sessionID);
      for (const msgId of orphans) {
        if (prependThinkingPart(sessionID, msgId)) fixed = true;
      }
    } else if (errorType === 'thinking_disabled_violation') {
      const msgs = findMessagesWithThinkingBlocks(sessionID);
      for (const msgId of msgs) {
        if (stripThinkingParts(msgId)) fixed = true;
      }
    }
    // tool_result_missing: requires tool_use IDs from the failed assistant
    // message. In AfterAgent, we only have promptResponse (text) — skip for
    // now, let model retry naturally.

    if (!fixed) return {decision: 'allow'};

    return {
      decision: 'deny',
      reason: RECOVERY_RESUME_TEXT,
      hookSpecificOutput: {hookEventName: 'AfterAgent', clearContext: false},
    };
  },
};

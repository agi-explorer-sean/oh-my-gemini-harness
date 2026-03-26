/**
 * Claude Code Hooks Stop via AfterAgent.
 *
 * Runs Stop hooks at end of agent turn. In the session API path, Stop hooks
 * fire on session.idle events. In Gemini CLI mode, we use AfterAgent instead.
 */

import type {AfterAgentHandler, AfterAgentResult} from '../../cli/dispatch/after-agent';
import {getClaudeHooksConfig} from './config';
import {getPluginExtendedConfig} from './config-loader';
import {executeStopHooks, type StopContext} from './stop';

export const stopHookAfterAgentHandler: AfterAgentHandler = {
  name: 'claude-code-hooks-stop',
  priority: 30,
  handle: async (ctx): Promise<AfterAgentResult> => {
    // Prevent recursion: if this turn is already a retry from a previous deny,
    // allow it through.
    if (ctx.stopHookActive) return {decision: 'allow'};

    const claudeConfig = await getClaudeHooksConfig();
    const extendedConfig = await getPluginExtendedConfig();

    const stopCtx: StopContext = {
      sessionId: 'native-session',
      cwd: ctx.directory,
    };

    const result = await executeStopHooks(stopCtx, claudeConfig, extendedConfig);

    if (result.block && result.injectPrompt) {
      return {decision: 'deny', reason: result.injectPrompt};
    }
    return {decision: 'allow'};
  },
};

import type {Hooks, PluginInput} from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {OhMyGeminiPlugin} from '../../index';
import {runAfterAgentHandlers, type AfterAgentContext} from './after-agent';
import {ralphLoopAfterAgentHandler, getSessionEndContinuation} from '../../hooks/ralph-loop';
import {sessionRecoveryAfterAgentHandler} from '../../hooks/session-recovery/after-agent';
import {stopHookAfterAgentHandler} from '../../hooks/claude-code-hooks/after-agent';
import {backgroundNotificationAfterAgentHandler} from '../../hooks/background-notification/after-agent';
import {babysitterAfterAgentHandler} from '../../hooks/unstable-agent-babysitter/after-agent';

interface DispatchContext extends PluginInput {
  isDispatch: boolean;
}

function createMockCtx(directory: string): DispatchContext {
  const port = process.env.GEMINI_SERVER_PORT || '4097';
  const hostname = process.env.GEMINI_SERVER_HOSTNAME || 'localhost';
  return {
    directory,
    worktree: directory,
    serverUrl: new URL(`http://${hostname}:${port}`),
    client: {
      tui: {
        showToast: async () => {},
        showStatus: async () => ({stop: () => {}}),
      },
      session: {
        prompt: async () => ({}),
        messages: async () => ({data: []}),
      },
    } as unknown as PluginInput['client'],
    project: {
      name: path.basename(directory),
    } as unknown as PluginInput['project'],
    $: (() => {}) as unknown as PluginInput['$'],
    isDispatch: true,
  };
}

let cachedPlugin: Hooks | null = null;

async function getPlugin(directory: string): Promise<Hooks> {
  if (cachedPlugin) return cachedPlugin;
  const ctx = createMockCtx(directory);
  cachedPlugin = await OhMyGeminiPlugin(ctx);
  return cachedPlugin;
}

export async function dispatch(event: string) {
  const inputData = (await new Response(process.stdin).json()) as Record<
    string,
    unknown
  >;
  const directory = process.cwd();

  const logPath = path.join(directory, '.gemini', 'hook-dispatch.log');
  fs.mkdirSync(path.dirname(logPath), {recursive: true});

  const ts = () => new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts()}] [${event}] Dispatch started\n`);

  try {
    const plugin = await getPlugin(directory);
    fs.appendFileSync(logPath, `[${ts()}] [${event}] Plugin loaded\n`);

    if (event === 'BeforeAgent') {
      if (plugin['chat.message']) {
        // The user's message is in inputData.prompt (not llm_request.messages)
        const userPrompt = inputData.prompt as string | undefined;
        fs.appendFileSync(
          logPath,
          `[${ts()}] [BeforeAgent] prompt=${userPrompt?.slice(0, 100)}\n`,
        );

        if (userPrompt) {
          const input = {
            sessionID: inputData.session_id || 'native-session',
            agent: undefined, // no agent when dispatched without @agent
            model: undefined,
          };

          const output = {
            message: {},
            parts: [{type: 'text', text: userPrompt}],
          };

          await plugin['chat.message'](input as any, output as any);

          const injectedText = output.parts[0].text;
          fs.appendFileSync(
            logPath,
            `[${ts()}] [BeforeAgent] after chat.message: changed=${injectedText !== userPrompt}\n`,
          );
          if (injectedText !== userPrompt) {
            // Extract only the newly injected portion to avoid duplicating
            // the original message text in the prompt (the Gemini CLI
            // appends additionalContext to the existing prompt).
            const addedText = injectedText.startsWith(userPrompt)
              ? injectedText.slice(userPrompt.length)
              : injectedText;
            const hookOutput = {
              hookSpecificOutput: {
                hookEventName: 'BeforeAgent',
                additionalContext: addedText,
              },
            };
            fs.appendFileSync(
              logPath,
              `[${ts()}] [BeforeAgent] stdout JSON: ${JSON.stringify(hookOutput)}\n`,
            );
            console.log(JSON.stringify(hookOutput));
            return;
          }
        }
      }
    }

    if (event === 'BeforeTool') {
      if (plugin['tool.execute.before']) {
        const input = {
          tool: inputData.tool_name,
          sessionID: inputData.session_id || 'native-session',
          callID: inputData.call_id || 'native-call',
        };
        const output = {
          args: inputData.tool_input,
        };

        await plugin['tool.execute.before'](input as any, output as any);

        console.log(
          JSON.stringify({
            decision: 'allow',
            tool_input: output.args,
          }),
        );
        return;
      }
    }

    if (event === 'AfterAgent') {
      // Sub-agent processes (spawned by delegate_task / parallel_exec) set
      // OMG_PARENT_AGENT. They must NOT participate in AfterAgent handlers
      // (ralph-loop, background notifications, etc.) — those are parent-only.
      if (process.env.OMG_PARENT_AGENT) {
        fs.appendFileSync(
          logPath,
          `[${ts()}] [AfterAgent] Skipping — sub-agent process (OMG_PARENT_AGENT=${process.env.OMG_PARENT_AGENT})\n`,
        );
        console.log(JSON.stringify({decision: 'allow'}));
        return;
      }

      const afterAgentCtx: AfterAgentContext = {
        directory,
        prompt: (inputData.prompt as string) ?? '',
        promptResponse: (inputData.prompt_response as string) ?? '',
        stopHookActive: (inputData.stop_hook_active as boolean) ?? false,
      };

      fs.appendFileSync(
        logPath,
        `[${ts()}] [AfterAgent] prompt=${afterAgentCtx.prompt.slice(0, 100)} promptResponse=${afterAgentCtx.promptResponse.slice(0, 200)} stopHookActive=${afterAgentCtx.stopHookActive}\n`,
      );

      const result = await runAfterAgentHandlers(
        [
          sessionRecoveryAfterAgentHandler,
          ralphLoopAfterAgentHandler,
          stopHookAfterAgentHandler,
          backgroundNotificationAfterAgentHandler,
          babysitterAfterAgentHandler,
        ],
        afterAgentCtx,
      );

      fs.appendFileSync(
        logPath,
        `[${ts()}] [AfterAgent] result: decision=${result.decision}\n`,
      );

      console.log(JSON.stringify(result));
      return;
    }

    if (event === 'SessionStart') {
      if (plugin.event) {
        await plugin.event({
          event: {
            type: 'session.created',
            properties: {
              info: {id: inputData.session_id},
            },
          },
        } as any);
      }
      console.log(JSON.stringify({}));
      return;
    }

    if (event === 'SessionEnd') {
      if (plugin.event) {
        // Add a safety timeout for cleanup operations to prevent hanging the CLI
        const cleanupPromise = plugin.event({
          event: {
            type: 'session.deleted',
            properties: {
              info: {id: inputData.session_id},
            },
          },
        } as any);

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('SessionEnd cleanup timed out')),
            2000,
          ),
        );

        await Promise.race([cleanupPromise, timeoutPromise]).catch((err) => {
          fs.appendFileSync(
            logPath,
            `[WARN] SessionEnd cleanup: ${err.message}\n`,
          );
        });
      }

      // Ralph Loop multi-turn: Gemini CLI's AfterAgent fires once per
      // session (deny gives 1 bonus turn, no recursive AfterAgent). For
      // true multi-turn, spawn a new gemini process after session ends.
      fs.appendFileSync(
        logPath,
        `[${ts()}] [SessionEnd] Checking Ralph Loop continuation (OMG_PARENT_AGENT=${process.env.OMG_PARENT_AGENT || 'unset'})\n`,
      );
      if (!process.env.OMG_PARENT_AGENT && !process.env.RALPH_LOOP_NO_SPAWN) {
        const continuation = getSessionEndContinuation(directory, (inputData.session_id as string) || '');
        fs.appendFileSync(
          logPath,
          `[${ts()}] [SessionEnd] getSessionEndContinuation: shouldContinue=${continuation.shouldContinue}, hasPrompt=${!!continuation.prompt}\n`,
        );
        if (continuation.shouldContinue && continuation.prompt) {
          fs.appendFileSync(
            logPath,
            `[${ts()}] [SessionEnd] Ralph Loop continuation — spawning new gemini process\n`,
          );

          // Find the gemini binary
          const geminiPath =
            process.env.GEMINI_PATH ||
            'gemini';

          // Reuse the parent's proxy if available
          const proxyAddress = process.env.GOOGLE_GEMINI_BASE_URL;
          const args: string[] = [];
          if (proxyAddress) {
            args.push(`--proxy_address=${proxyAddress}`);
          }
          args.push('-y', '-p', continuation.prompt);

          const {spawn} = await import('node:child_process');
          const child = spawn(geminiPath, args, {
            cwd: directory,
            stdio: 'inherit',
            detached: true,
            env: {
              ...process.env,
              // Prevent sub-agent guard from blocking the continuation
              OMG_PARENT_AGENT: undefined,
            },
          });

          // Detach: let the child run independently
          child.unref();

          fs.appendFileSync(
            logPath,
            `[${ts()}] [SessionEnd] Spawned continuation PID=${child.pid}\n`,
          );
        }
      }
    }
  } catch (err) {
    fs.appendFileSync(
      logPath,
      `[ERROR] ${err instanceof Error ? err.stack : String(err)}\n`,
    );
  }

  console.log(JSON.stringify({}));
}

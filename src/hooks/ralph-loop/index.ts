import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync, copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import {
  HOOK_NAME,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MIN_ITERATIONS,
  DEFAULT_COMPLETION_PROMISE,
} from "./constants"
import type { RalphLoopState, RalphLoopOptions } from "./types"
import type { AfterAgentHandler } from "../../cli/dispatch/after-agent"

export * from "./types"
export * from "./constants"
export { readState, writeState, clearState, incrementIteration } from "./storage"

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

const VERIFICATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}} — VERIFY]

You declared the task complete, but a minimum of {{MIN}} iteration(s) is required. Please verify your work before finalizing:

- Re-read every file you created or modified
- Check for missing pieces, edge cases, or incomplete logic
- Confirm everything is correct and truly done

When fully verified, output: <promise>{{PROMISE}}</promise>

Original task:
{{PROMPT}}`

const TEST_INJECTION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - RALPH LOOP {{ITERATION}}/{{MAX}} — TESTS INJECTED]

Test files have been added to your workspace. Run the tests and fix all failures. Do NOT modify any *_test.go files — only fix the source files. Run \`go test ./...\` to verify.

When ALL tests pass with 0 failures, output: <promise>{{PROMISE}}</promise>

Original task:
{{PROMPT}}`

export interface AfterAgentResult {
  decision: "allow" | "deny"
  reason?: string
  continue?: boolean
  systemMessage?: string
  hookSpecificOutput?: { hookEventName: "AfterAgent"; clearContext: boolean }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Copy test files from a source directory into a target directory.
 * Returns the number of files copied.
 */
export function injectTests(fromDir: string, toDir: string): number {
  if (!existsSync(fromDir)) {
    log(`[${HOOK_NAME}] inject_tests_from directory does not exist: ${fromDir}`)
    return 0
  }

  if (!existsSync(toDir)) {
    mkdirSync(toDir, { recursive: true })
  }

  const files = readdirSync(fromDir).filter(f => f.endsWith("_test.go") || f.endsWith(".test.ts"))
  for (const file of files) {
    copyFileSync(join(fromDir, file), join(toDir, file))
  }

  log(`[${HOOK_NAME}] Injected ${files.length} test files from ${fromDir} to ${toDir}`)
  return files.length
}

export function handleAfterAgent(
  directory: string,
  prompt: string,
  promptResponse: string,
  stopHookActive: boolean,
  stateDir?: string,
): AfterAgentResult {
  // When stop_hook_active is true, this turn is already a retry from a
  // previous deny. Still check for the completion promise so we can
  // detect success on the retry turn and clear the state.
  if (stopHookActive) {
    const state = readState(directory, stateDir)
    if (state?.active) {
      const stopPattern = new RegExp(
        `<promise>\\s*${escapeRegex(state.completion_promise)}\\s*</promise>`,
        "is",
      )
      if (stopPattern.test(promptResponse)) {
        log(`[${HOOK_NAME}] Completion detected on retry turn`, {
          iteration: state.iteration,
          promise: state.completion_promise,
        })
        clearState(directory, stateDir)

        const label = state.ultrawork ? "ULTRAWORK LOOP" : "Ralph Loop"
        return {
          decision: "allow",
          continue: false,
          systemMessage: `✅ ${label} complete — Task completed after ${state.iteration} iteration(s)`,
        }
      }
    }
    return { decision: "allow" }
  }

  const state = readState(directory, stateDir)
  log(`[${HOOK_NAME}] handleAfterAgent: directory=${directory}, stateDir=${stateDir}, state=${JSON.stringify(state)?.slice(0, 200)}`)
  if (!state || !state.active) {
    log(`[${HOOK_NAME}] No active state found — returning allow`)
    return { decision: "allow" }
  }

  // Check if the model's response contains the completion promise
  const pattern = new RegExp(
    `<promise>\\s*${escapeRegex(state.completion_promise)}\\s*</promise>`,
    "is",
  )

  if (pattern.test(promptResponse)) {
    const minIter = state.min_iterations ?? DEFAULT_MIN_ITERATIONS
    if (state.iteration < minIter) {
      // Promise seen but min iterations not yet met — force a verification turn
      log(`[${HOOK_NAME}] Completion detected early (iter ${state.iteration} < min ${minIter}), forcing verification`)
      const newState = incrementIteration(directory, stateDir)
      if (!newState) {
        log(`[${HOOK_NAME}] Failed to increment iteration`)
        return { decision: "allow" }
      }
      const verifyPrompt = VERIFICATION_PROMPT
        .replace("{{ITERATION}}", String(newState.iteration))
        .replace("{{MAX}}", String(newState.max_iterations))
        .replace("{{MIN}}", String(minIter))
        .replace("{{PROMISE}}", newState.completion_promise)
        .replace("{{PROMPT}}", newState.prompt)
      newState.next_prompt = verifyPrompt
      writeState(directory, newState, stateDir)
      return {
        decision: "deny",
        reason: verifyPrompt,
        hookSpecificOutput: { hookEventName: "AfterAgent", clearContext: true },
      }
    }

    log(`[${HOOK_NAME}] Completion detected in prompt_response`, {
      iteration: state.iteration,
      promise: state.completion_promise,
    })
    clearState(directory, stateDir)

    const label = state.ultrawork ? "ULTRAWORK LOOP" : "Ralph Loop"
    const flavor = state.ultrawork
      ? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)`
      : `Task completed after ${state.iteration} iteration(s)`

    return {
      decision: "allow",
      continue: false,
      systemMessage: `✅ ${label} complete — ${flavor}`,
    }
  }

  // Max iterations reached
  if (state.iteration >= state.max_iterations) {
    log(`[${HOOK_NAME}] Max iterations reached`, {
      iteration: state.iteration,
      max: state.max_iterations,
    })
    clearState(directory, stateDir)

    return {
      decision: "allow",
      continue: false,
      systemMessage: `⚠️ Ralph Loop stopped — max iterations (${state.max_iterations}) reached without completion`,
    }
  }

  // Inject test files on the first continuation if configured
  let testsJustInjected = false
  if (state.inject_tests_from && state.inject_tests_to && !state.tests_injected) {
    const count = injectTests(state.inject_tests_from, state.inject_tests_to)
    if (count > 0) {
      state.tests_injected = true
      writeState(directory, state, stateDir)
      testsJustInjected = true
      log(`[${HOOK_NAME}] Test injection complete`, { count })
    }
  }

  // Increment iteration and build continuation prompt
  const newState = incrementIteration(directory, stateDir)
  if (!newState) {
    log(`[${HOOK_NAME}] Failed to increment iteration`)
    return { decision: "allow" }
  }

  log(`[${HOOK_NAME}] Continuing loop`, {
    iteration: newState.iteration,
    max: newState.max_iterations,
  })

  const promptTemplate = testsJustInjected ? TEST_INJECTION_PROMPT : CONTINUATION_PROMPT
  const continuationPrompt = promptTemplate
    .replace("{{ITERATION}}", String(newState.iteration))
    .replace("{{MAX}}", String(newState.max_iterations))
    .replace("{{PROMISE}}", newState.completion_promise)
    .replace("{{PROMPT}}", newState.prompt)

  const finalPrompt = newState.ultrawork
    ? `ultrawork ${continuationPrompt}`
    : continuationPrompt

  // Persist the continuation prompt so SessionEnd can spawn the next
  // invocation. Gemini CLI only fires AfterAgent once per session — the
  // deny gives one bonus turn but no recursive AfterAgent. For true
  // multi-turn, SessionEnd reads next_prompt and spawns a new process.
  newState.next_prompt = finalPrompt
  writeState(directory, newState, stateDir)

  return {
    decision: "deny",
    reason: finalPrompt,
    hookSpecificOutput: {
      hookEventName: "AfterAgent",
      clearContext: true,
    },
  }
}

export interface RalphLoopHook {
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number; minIterations?: number; completionPromise?: string; ultrawork?: boolean }
  ) => boolean
  cancelLoop: (sessionID?: string) => boolean
  getState: () => RalphLoopState | null
}

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions
): RalphLoopHook {
  const config = options?.config
  const stateDir = config?.state_dir

  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number; minIterations?: number; completionPromise?: string; ultrawork?: boolean }
  ): boolean => {
    const state: RalphLoopState = {
      active: true,
      iteration: 1,
      max_iterations:
        loopOptions?.maxIterations ?? config?.default_max_iterations ?? DEFAULT_MAX_ITERATIONS,
      min_iterations: loopOptions?.minIterations ?? DEFAULT_MIN_ITERATIONS,
      completion_promise: loopOptions?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
      ultrawork: loopOptions?.ultrawork,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeState(ctx.directory, state, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop started`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionPromise: state.completion_promise,
      })
    }
    return success
  }

  const cancelLoop = (sessionID?: string): boolean => {
    const state = readState(ctx.directory, stateDir)
    if (!state) {
      return false
    }

    const success = clearState(ctx.directory, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
    }
    return success
  }

  const getState = (): RalphLoopState | null => {
    return readState(ctx.directory, stateDir)
  }

  return {
    startLoop,
    cancelLoop,
    getState,
  }
}

/** AfterAgent handler wrapper for use in the dispatch handler registry. */
export const ralphLoopAfterAgentHandler: AfterAgentHandler = {
  name: 'ralph-loop',
  priority: 20,
  handle: (ctx) =>
    handleAfterAgent(ctx.directory, ctx.prompt, ctx.promptResponse, ctx.stopHookActive),
}

/**
 * Check if the Ralph Loop needs a continuation subprocess after SessionEnd.
 *
 * Gemini CLI's AfterAgent fires once per session — deny gives one bonus
 * continuation turn but no recursive AfterAgent. For true multi-turn looping,
 * SessionEnd calls this function. If the loop is still active (state exists,
 * next_prompt set), it returns the prompt to spawn a new gemini process with.
 */
export function getSessionEndContinuation(
  directory: string,
  sessionID: string,
  stateDir?: string,
): { shouldContinue: boolean; prompt?: string } {
  const state = readState(directory, stateDir)
  if (!state || !state.active || !state.next_prompt) {
    return { shouldContinue: false }
  }

  // Only spawn continuation if the ending session matches the loop's session.
  // This prevents background sub-agents from hijacking the parent's loop.
  if (state.session_id && state.session_id !== sessionID) {
    return { shouldContinue: false }
  }

  // Clear next_prompt to prevent double-spawning
  state.next_prompt = undefined
  writeState(directory, state, stateDir)

  return {
    shouldContinue: true,
    prompt: state.prompt, // Use original task prompt — the model reads its own files for context
  }
}

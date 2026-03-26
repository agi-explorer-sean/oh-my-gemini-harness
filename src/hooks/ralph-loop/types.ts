import type { RalphLoopConfig } from "../../config"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  /** Minimum iterations before a completion promise is accepted. Default 2. */
  min_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
  inject_tests_from?: string
  inject_tests_to?: string
  tests_injected?: boolean
  /** Set by handleAfterAgent to indicate the next invocation's prompt.
   *  Used by SessionEnd to spawn a continuation subprocess. */
  next_prompt?: string
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
}

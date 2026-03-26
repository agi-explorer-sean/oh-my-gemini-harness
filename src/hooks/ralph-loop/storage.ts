import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import type { RalphLoopState } from "./types"
import { DEFAULT_STATE_FILE, DEFAULT_COMPLETION_PROMISE, DEFAULT_MAX_ITERATIONS, DEFAULT_MIN_ITERATIONS } from "./constants"

export function getStateFilePath(directory: string, customPath?: string): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE)
}

function parseFrontmatterState(content: string): RalphLoopState | null {
  try {
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration

    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)

    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
      min_iterations: Number(data.min_iterations) || DEFAULT_MIN_ITERATIONS,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork: data.ultrawork === true || data.ultrawork === "true" ? true : undefined,
      inject_tests_from: data.inject_tests_from ? stripQuotes(data.inject_tests_from) : undefined,
      inject_tests_to: data.inject_tests_to ? stripQuotes(data.inject_tests_to) : undefined,
      tests_injected: data.tests_injected === true || data.tests_injected === "true" ? true : undefined,
    }
  } catch {
    return null
  }
}

function parseJsonState(content: string): RalphLoopState | null {
  try {
    const data = JSON.parse(content) as Record<string, unknown>

    if (typeof data.active !== "boolean" || typeof data.iteration !== "number") {
      return null
    }

    return {
      active: data.active,
      iteration: data.iteration,
      max_iterations: typeof data.max_iterations === "number" ? data.max_iterations : DEFAULT_MAX_ITERATIONS,
      min_iterations: typeof data.min_iterations === "number" ? data.min_iterations : DEFAULT_MIN_ITERATIONS,
      completion_promise: typeof data.completion_promise === "string" ? data.completion_promise : DEFAULT_COMPLETION_PROMISE,
      started_at: typeof data.started_at === "string" ? data.started_at : new Date().toISOString(),
      prompt: typeof data.prompt === "string" ? data.prompt : "",
      session_id: typeof data.session_id === "string" ? data.session_id : undefined,
      ultrawork: data.ultrawork === true ? true : undefined,
      inject_tests_from: typeof data.inject_tests_from === "string" ? data.inject_tests_from : undefined,
      inject_tests_to: typeof data.inject_tests_to === "string" ? data.inject_tests_to : undefined,
      tests_injected: data.tests_injected === true ? true : undefined,
    }
  } catch {
    return null
  }
}

export function readState(directory: string, customPath?: string): RalphLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")

    // Try JSON first, then fall back to frontmatter for migration
    return parseJsonState(content) ?? parseFrontmatterState(content)
  } catch {
    return null
  }
}

export function writeState(
  directory: string,
  state: RalphLoopState,
  customPath?: string
): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

export function clearState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

export function incrementIteration(
  directory: string,
  customPath?: string
): RalphLoopState | null {
  const state = readState(directory, customPath)
  if (!state) return null

  state.iteration += 1
  if (writeState(directory, state, customPath)) {
    return state
  }
  return null
}

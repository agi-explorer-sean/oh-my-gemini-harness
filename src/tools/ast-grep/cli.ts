import { spawn } from "bun"
import { existsSync } from "fs"
import {
  getSgCliPath,
  setSgCliPath,
  findSgCliPathSync,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_MATCHES,
} from "./constants"
import { ensureAstGrepBinary } from "./downloader"
import type { CliMatch, CliLanguage, SgResult } from "./types"

export interface RunOptions {
  pattern: string
  lang: CliLanguage
  paths?: string[]
  globs?: string[]
  rewrite?: string
  context?: number
  updateAll?: boolean
}

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getAstGrepPath(): Promise<string | null> {
  if (resolvedCliPath !== null && existsSync(resolvedCliPath)) {
    return resolvedCliPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const syncPath = findSgCliPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      setSgCliPath(syncPath)
      return syncPath
    }

    const downloadedPath = await ensureAstGrepBinary()
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      setSgCliPath(downloadedPath)
      return downloadedPath
    }

    return null
  })()

  return initPromise
}

export function startBackgroundInit(): void {
  if (!initPromise) {
    initPromise = getAstGrepPath()
    initPromise.catch(() => {})
  }
}

export async function runSg(options: RunOptions): Promise<SgResult> {
  // When updateAll is true, we need two passes:
  // 1. Preview pass with --json=compact to get match details for the response
  // 2. Apply pass with --update-all (without --json) to actually modify files
  //
  // ast-grep's --json flag and --update-all are mutually exclusive: when both
  // are passed, --json takes precedence and changes are NOT applied to disk.
  if (options.rewrite && options.updateAll) {
    // Pass 1: preview to get match info
    const preview = await runSgInternal({ ...options, updateAll: false })
    if (preview.error || preview.matches.length === 0) {
      return preview
    }

    // Pass 2: apply changes (no --json, with --update-all)
    const applyResult = await runSgApply(options)
    if (applyResult.error) {
      return { ...preview, error: applyResult.error }
    }

    return preview
  }

  return runSgInternal(options)
}

/**
 * Run ast-grep with --update-all and no --json flag to actually apply changes.
 * Returns only the count of changes applied (parsed from text output).
 */
async function runSgApply(options: RunOptions): Promise<{ error?: string; changesApplied: number }> {
  const args = ["run", "-p", options.pattern, "--lang", options.lang]

  if (options.rewrite) {
    args.push("-r", options.rewrite)
  }
  args.push("--update-all")

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob)
    }
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ["."]
  args.push(...paths)

  const cliPath = await resolveCliPath()
  if (!cliPath) {
    return { error: cliNotFoundError(), changesApplied: 0 }
  }

  try {
    const proc = spawn([cliPath, ...args], { stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    // Parse "Applied N changes" from stdout
    const match = stdout.match(/Applied (\d+) change/)
    const changesApplied = match ? parseInt(match[1], 10) : 0

    if (proc.exitCode !== 0 && stderr.trim()) {
      return { error: stderr.trim(), changesApplied }
    }

    return { changesApplied }
  } catch (e) {
    return { error: `Failed to apply: ${e instanceof Error ? e.message : String(e)}`, changesApplied: 0 }
  }
}

async function resolveCliPath(): Promise<string | null> {
  let cliPath = getSgCliPath()

  if (!existsSync(cliPath) && cliPath !== "sg") {
    const downloadedPath = await getAstGrepPath()
    if (downloadedPath) {
      cliPath = downloadedPath
    } else {
      return null
    }
  }

  return cliPath
}

function cliNotFoundError(): string {
  return (
    `ast-grep CLI binary not found.\n\n` +
    `Auto-download failed. Manual install options:\n` +
    `  bun add -D @ast-grep/cli\n` +
    `  cargo install ast-grep --locked\n` +
    `  brew install ast-grep`
  )
}

async function runSgInternal(options: RunOptions): Promise<SgResult> {
  const args = ["run", "-p", options.pattern, "--lang", options.lang, "--json=compact"]

  if (options.rewrite) {
    args.push("-r", options.rewrite)
  }

  if (options.context && options.context > 0) {
    args.push("-C", String(options.context))
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob)
    }
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ["."]
  args.push(...paths)

  let cliPath = getSgCliPath()

  if (!existsSync(cliPath) && cliPath !== "sg") {
    const downloadedPath = await getAstGrepPath()
    if (downloadedPath) {
      cliPath = downloadedPath
    }
  }

  const timeout = DEFAULT_TIMEOUT_MS

  const proc = spawn([cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const timeoutPromise = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      proc.kill()
      reject(new Error(`Search timeout after ${timeout}ms`))
    }, timeout)
    proc.exited.then(() => clearTimeout(id))
  })

  let stdout: string
  let stderr: string
  let exitCode: number

  try {
    stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
    stderr = await new Response(proc.stderr).text()
    exitCode = await proc.exited
  } catch (e) {
    const error = e as Error
    if (error.message?.includes("timeout")) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: true,
        truncatedReason: "timeout",
        error: error.message,
      }
    }

    const nodeError = e as NodeJS.ErrnoException
    if (
      nodeError.code === "ENOENT" ||
      nodeError.message?.includes("ENOENT") ||
      nodeError.message?.includes("not found")
    ) {
      const downloadedPath = await ensureAstGrepBinary()
      if (downloadedPath) {
        resolvedCliPath = downloadedPath
        setSgCliPath(downloadedPath)
        return runSgInternal(options)
      } else {
        return {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: cliNotFoundError(),
        }
      }
    }

    return {
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: `Failed to spawn ast-grep: ${error.message}`,
    }
  }

  if (exitCode !== 0 && stdout.trim() === "") {
    if (stderr.includes("No files found")) {
      return { matches: [], totalMatches: 0, truncated: false }
    }
    if (stderr.trim()) {
      return { matches: [], totalMatches: 0, truncated: false, error: stderr.trim() }
    }
    return { matches: [], totalMatches: 0, truncated: false }
  }

  if (!stdout.trim()) {
    return { matches: [], totalMatches: 0, truncated: false }
  }

  const outputTruncated = stdout.length >= DEFAULT_MAX_OUTPUT_BYTES
  const outputToProcess = outputTruncated ? stdout.substring(0, DEFAULT_MAX_OUTPUT_BYTES) : stdout

  let matches: CliMatch[] = []
  try {
    matches = JSON.parse(outputToProcess) as CliMatch[]
  } catch {
    if (outputTruncated) {
      try {
        const lastValidIndex = outputToProcess.lastIndexOf("}")
        if (lastValidIndex > 0) {
          const bracketIndex = outputToProcess.lastIndexOf("},", lastValidIndex)
          if (bracketIndex > 0) {
            const truncatedJson = outputToProcess.substring(0, bracketIndex + 1) + "]"
            matches = JSON.parse(truncatedJson) as CliMatch[]
          }
        }
      } catch {
        return {
          matches: [],
          totalMatches: 0,
          truncated: true,
          truncatedReason: "max_output_bytes",
          error: "Output too large and could not be parsed",
        }
      }
    } else {
      return { matches: [], totalMatches: 0, truncated: false }
    }
  }

  const totalMatches = matches.length
  const matchesTruncated = totalMatches > DEFAULT_MAX_MATCHES
  const finalMatches = matchesTruncated ? matches.slice(0, DEFAULT_MAX_MATCHES) : matches

  return {
    matches: finalMatches,
    totalMatches,
    truncated: outputTruncated || matchesTruncated,
    truncatedReason: outputTruncated ? "max_output_bytes" : matchesTruncated ? "max_matches" : undefined,
  }
}

export function isCliAvailable(): boolean {
  const path = findSgCliPathSync()
  return path !== null && existsSync(path)
}

export async function ensureCliAvailable(): Promise<boolean> {
  const path = await getAstGrepPath()
  return path !== null && existsSync(path)
}

import { spawn } from "bun"
import { createRequire } from "module"
import { dirname, join } from "path"
import { existsSync } from "fs"
import * as fs from "fs"
import { tmpdir } from "os"
import { getCachedBinaryPath, ensureCommentCheckerBinary } from "./downloader"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

function findCommentCheckerPathSync(): string | null {
  const binaryName = getBinaryName()

  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    debugLog("found binary in cache:", cachedPath)
    return cachedPath
  }

  // Guard against undefined import.meta.url (can happen on Windows during plugin loading)
  if (!import.meta.url) {
    debugLog("import.meta.url is undefined, skipping package resolution")
    return null
  }

  try {
    const require = createRequire(import.meta.url)
    const pkgName = "@agi-explorer-sean/comment-checker/package.json"
    const cliPkgPath = require.resolve(pkgName)
    const cliDir = dirname(cliPkgPath)
    const binaryPath = join(cliDir, "bin", binaryName)

    if (existsSync(binaryPath)) {
      debugLog("found binary in main package:", binaryPath)
      return binaryPath
    }
  } catch (err) {
    debugLog("main package not installed or resolution failed:", err)
  }

  debugLog("no binary found in known locations")
  return null
}

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getCommentCheckerPath(): Promise<string | null> {
  if (resolvedCliPath !== null) {
    return resolvedCliPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const syncPath = findCommentCheckerPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      debugLog("using sync-resolved path:", syncPath)
      return syncPath
    }

    debugLog("triggering lazy download...")
    const downloadedPath = await ensureCommentCheckerBinary()
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      debugLog("using downloaded path:", downloadedPath)
      return downloadedPath
    }

    debugLog("no binary available")
    return null
  })()

  return initPromise
}

export function getCommentCheckerPathSync(): string | null {
  return resolvedCliPath ?? findCommentCheckerPathSync()
}

export function startBackgroundInit(): void {
  if (!initPromise) {
    initPromise = getCommentCheckerPath()
    initPromise.then(path => {
      debugLog("background init complete:", path || "no binary")
    }).catch(err => {
      debugLog("background init error:", err)
    })
  }
}

export interface HookInput {
  session_id: string
  tool_name: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  tool_input: {
    file_path?: string
    content?: string
    old_string?: string
    new_string?: string
    edits?: Array<{ old_string: string; new_string: string }>
  }
  tool_response?: unknown
}

export interface CheckResult {
  hasComments: boolean
  message: string
}

export async function runCommentChecker(input: HookInput, cliPath?: string, customPrompt?: string): Promise<CheckResult> {
  const binaryPath = cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()
  
  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  if (!existsSync(binaryPath)) {
    debugLog("comment-checker binary does not exist:", binaryPath)
    return { hasComments: false, message: "" }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  try {
    const args = [binaryPath, "check"]
    if (customPrompt) {
      args.push("--prompt", customPrompt)
    }
    
    const proc = spawn(args, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    proc.stdin.write(jsonInput)
    proc.stdin.end()

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    debugLog("exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

    if (exitCode === 0) {
      return { hasComments: false, message: "" }
    }

    if (exitCode === 2) {
      // Comments detected - message is in stderr
      return { hasComments: true, message: stderr }
    }

    debugLog("unexpected exit code:", exitCode, "stderr:", stderr)
    return { hasComments: false, message: "" }
  } catch (err) {
    debugLog("failed to run comment-checker:", err)
    return { hasComments: false, message: "" }
  }
}

export function isCliAvailable(): boolean {
  const path = getCommentCheckerPathSync()
  return path !== null && existsSync(path)
}

export async function ensureCliAvailable(): Promise<boolean> {
  const path = await getCommentCheckerPath()
  return path !== null && existsSync(path)
}

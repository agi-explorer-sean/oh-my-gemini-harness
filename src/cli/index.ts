#!/usr/bin/env bun
import { Command } from "commander"
import * as path from "node:path"
import * as os from "node:os"
import { install } from "./install"
import { dispatch } from "./dispatch"
import { startMcpServer } from "../mcp-server"
import { createMcpOAuthCommand } from "./mcp-oauth"
import { setupVertexAI } from "./setup-vertex-ai"
import { authMode } from "./auth-mode"
import type { InstallArgs } from "./types"
import type { SetupVertexAIOptions } from "./setup-vertex-ai"
import type { AuthModeOptions, AuthMode } from "./auth-mode"
import packageJson from "../../package.json" with { type: "json" }

const GEMINI_HOME = process.env.GEMINI_CONFIG_DIR || path.join(os.homedir(), ".config", "gemini")
const GEMINI_DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share", "gemini")

process.env.GEMINI_CONFIG_DIR = GEMINI_HOME
process.env.GEMINI_DATA_DIR = GEMINI_DATA
process.env.GEMINI_LOG_DIR = path.join(GEMINI_DATA, "log")

const VERSION = packageJson.version

const program = new Command()

program
  .name("oh-my-gemini")
  .description("The ultimate Gemini plugin - multi-model orchestration, LSP tools, and more")
  .version(VERSION, "-v, --version", "Show version number")

program
  .command("install")
  .description("Install and configure oh-my-gemini with interactive setup")
  .option("--no-tui", "Run in non-interactive mode")
  .option("--skip-auth", "Skip authentication setup hints")
  .action(async (options) => {
    const args: InstallArgs = {
      tui: options.tui !== false,
      skipAuth: options.skipAuth ?? false,
    }
    const exitCode = await install(args)
    process.exit(exitCode)
  })

program
  .command("dispatch <event>")
  .description("Handle native Gemini CLI hooks")
  .action(async (event: string) => {
    await dispatch(event)
    process.exit(0)
  })

program
  .command("mcp-server")
  .description("Start the Oh My Gemini MCP server")
  .action(async () => {
    await startMcpServer()
  })

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`oh-my-gemini v${VERSION}`)
    process.exit(0)
  })

program
  .command("setup-vertex-ai")
  .description("Interactively configure Vertex AI for Claude models via MaaS")
  .option("--no-tui", "Run in non-interactive mode")
  .option("--project <id>", "GCP project ID")
  .option("--location <region>", "Vertex AI region (e.g. us-east5, global)")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-gemini setup-vertex-ai
  $ bunx oh-my-gemini setup-vertex-ai --project my-project --location us-east5
  $ bunx oh-my-gemini setup-vertex-ai --no-tui --project my-project

This command will:
  1. Check for gcloud CLI and ADC credentials
  2. Prompt for GCP project and region
  3. Optionally run 'gcloud auth application-default login'
  4. Add env vars to your shell profile (.bashrc/.zshrc)
  5. Register Claude models in Gemini CLI config

After setup, Claude models (claude-opus-4-6, claude-sonnet-4-5) will be
available through the Gemini CLI via Vertex AI MaaS.
`)
  .action(async (options) => {
    const setupOptions: SetupVertexAIOptions = {
      tui: options.tui !== false,
      project: options.project,
      location: options.location,
    }
    const exitCode = await setupVertexAI(setupOptions)
    process.exit(exitCode)
  })

program
  .command("auth-mode")
  .description("Switch Gemini CLI authentication mode (Google OAuth, Vertex AI, API Key)")
  .option("--no-tui", "Run in non-interactive mode")
  .option("--auto", "Auto-detect and apply the best available auth mode")
  .option("--mode <mode>", "Set a specific auth mode (google-oauth, vertex-ai, api-key)")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-gemini auth-mode              # Interactive TUI selector
  $ bunx oh-my-gemini auth-mode --auto       # Auto-detect and apply best mode
  $ bunx oh-my-gemini auth-mode --mode vertex-ai  # Set specific mode
  $ bunx oh-my-gemini auth-mode --no-tui     # Non-interactive status display

Auth Modes:
  google-oauth   Google OAuth via browser login (free tier, Gemini only)
  vertex-ai      Vertex AI with ADC + GCP project (supports Claude models)
  api-key        GEMINI_API_KEY environment variable
`)
  .action(async (options) => {
    const authModeOptions: AuthModeOptions = {
      tui: options.tui !== false,
      auto: options.auto ?? false,
      mode: options.mode as AuthMode | undefined,
    }
    const exitCode = await authMode(authModeOptions)
    process.exit(exitCode)
  })

program.addCommand(createMcpOAuthCommand())

program.parse()

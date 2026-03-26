# cli

This directory contains the entry points and core logic for the "oh-my-gemini"
CLI tool, built with Commander.js.

## Commands

| Command | Description |
|---------|-------------|
| `oh-my-gemini install` | Interactive setup — installs deps, builds, writes config, links the extension with Gemini CLI. |
| `oh-my-gemini run <message>` | Runs a task with todo/background-task completion enforcement. Unlike `gemini run`, waits until all todos are completed and all child sessions are idle. |
| `oh-my-gemini dispatch <event>` | Internal — handles native Gemini CLI hook events (`BeforeAgent`, `BeforeTool`, `SessionStart`, `SessionEnd`). |
| `oh-my-gemini mcp-server` | Starts the MCP server so other tools can consume oh-my-gemini's tools. |
| `oh-my-gemini mcp-oauth` | OAuth flow management for MCP servers. |

## Gemini Integration

1. **As a Gemini extension** — `install` runs `gemini extensions link .` to
   register oh-my-gemini as a native Gemini CLI extension. After linking, the
   plugin loads automatically when you run `gemini`.

2. **Via dispatch** — The Gemini CLI calls `oh-my-gemini dispatch <event>` with
   JSON on stdin for lifecycle events. The dispatch handler translates these
   into the plugin's hook system (`chat.message`, `tool.execute.before`,
   `event`).

3. **Via `run`** — Starts its own OpenCode SDK server, creates a session, sends
   the prompt, and polls until all todos and background tasks complete.

## Usage (Local Build)

This project is built and run locally — there is no npmjs registry dependency.

```bash
# 1. Build from source (from project root)
bun install
bun run build

# 2. Run CLI from built output
bun dist/cli/index.js install          # interactive TUI
bun dist/cli/index.js install --no-tui # non-interactive
bun dist/cli/index.js run "Fix the bug in index.ts"
bun dist/cli/index.js run --agent Sisyphus "Implement feature X"
bun dist/cli/index.js run --timeout 3600000 "Large refactoring task"

# Or run directly from source (no build step needed)
bun src/cli/index.ts install
bun src/cli/index.ts run "Fix the bug in index.ts"

# After install, the plugin loads automatically with gemini
gemini
```

### Agent resolution for `run`

Priority order:
1. `--agent` CLI flag
2. `GEMINI_DEFAULT_AGENT` env var
3. `oh-my-gemini.json` → `default_run_agent`
4. Sisyphus (fallback)

## File Sources

### Re-exported from oh-my-opencode

-   `run/completion.ts`
-   `mcp-oauth/index.ts`, `mcp-oauth/login.ts`, `mcp-oauth/logout.ts`,
    `mcp-oauth/status.ts`

### Modified / Wrapped

-   `run/events.ts`: Wraps vendor event processing logic.
-   `run/runner.ts`: Creates OpenCode SDK server+client, sends prompt, polls
    for completion. Translated to Gemini environment variables and branding.

### Local Implementation (Gemini Specific)

-   `index.ts`: Main CLI entry point — Commander program definition and env
    setup (`GEMINI_CONFIG_DIR`, `GEMINI_DATA_DIR`, `GEMINI_LOG_DIR`).
-   `install.ts`: 9-step installer (check gemini, deps, `bun install`, build,
    config, auth, providers, omg config, link). Supports both interactive TUI
    and non-interactive modes.
-   `config-manager.ts`: Reads/writes `gemini.json` and `oh-my-gemini.json`
    configuration files.
-   `model-fallback.ts`: Generates optimized model configurations based on
    available providers.
-   `dispatch/`: Bridge between Gemini CLI native hooks and the plugin hook
    system. Receives JSON on stdin and routes events to plugin handlers.
-   `run/types.ts`: Type definitions for the run command.
-   `types.ts`: CLI-related type definitions.

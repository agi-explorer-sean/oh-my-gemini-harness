# CLI Example: Run

Runs a task with full todo/background-task completion enforcement.

## How to run

```bash
# From project root
bash src/cli/examples/run/run_example.sh

# Real usage (requires a running Gemini server)
bun src/cli/index.ts run "Fix the bug in index.ts"
bun src/cli/index.ts run --agent Sisyphus "Implement feature X"
bun src/cli/index.ts run --timeout 3600000 "Large refactoring task"
bun src/cli/index.ts run --verbose "Debug with event logs"
```

## What it demonstrates

- **Help output**: shows all options and agent resolution order
- **Graceful failure**: when no Gemini server is available, the command exits
  with a clear error message instead of hanging

## How `run` works

1. Sets `GEMINI_CLI_RUN_MODE=true` for hooks to detect headless mode
2. Starts an OpenCode SDK server on port 4097
3. Creates a session and sends the prompt
4. Subscribes to SSE events and polls for completion
5. Exits only when all todos are completed and all background tasks are idle

Unlike `gemini run`, this command enforces full task completion — it does not
exit early when the main prompt returns.

## Options

- `--agent <name>` — agent to use (default resolution: `--agent` flag >
  `GEMINI_DEFAULT_AGENT` env > `oh-my-gemini.json` `default_run_agent` >
  Sisyphus)
- `--directory <path>` — working directory
- `--timeout <ms>` — timeout in milliseconds (0 = no timeout)
- `--verbose` — show SSE event logs during execution

## Prerequisites

The `run` command requires a running Gemini server. Without one, the command
will fail with "Failed to start server on port 4097".

## Output files

- `output/help.txt` — run command help text
- `output/no-server.txt` — expected error output when no server is available

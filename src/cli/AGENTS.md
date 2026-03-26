# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-gemini`. 4 commands with Commander.js + `@clack-prompts`
TUI.

**Commands**: install (interactive setup), run (session launcher)

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry (4 commands)
├── install.ts            # Interactive TUI (542 lines)
├── config-manager.ts     # JSONC parsing (667 lines)
├── types.ts              # InstallArgs, InstallConfig
├── model-fallback.ts     # Model fallback configuration
├── run/
│   └── index.ts          # Session launcher
├── mcp-oauth/
│   └── index.ts          # MCP OAuth flow
└── dispatch/
    └── index.ts          # Native hook dispatch
```

## COMMANDS

| Command | Purpose |
|---------|---------|
| `install` | Interactive setup with provider selection |
| `run` | Launch session with todo enforcement |

## TUI FRAMEWORK

-   **`@clack-prompts`**: `select()`, `spinner()`, `intro()`, `outro()`
-   **picocolors**: Terminal colors for status and headers
-   **Symbols**: ✓ (pass), ✗ (fail), ⚠ (warn), ℹ (info)

## ANTI-PATTERNS

- **Blocking in non-TTY**: Always check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()` from shared utils
- **Hardcoded paths**: Use `getGeminiConfigPaths()` from `config-manager.ts`

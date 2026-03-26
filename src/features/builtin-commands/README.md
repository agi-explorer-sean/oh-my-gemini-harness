# builtin-commands

This feature provides standard commands built into the orchestrator.

## File Sources

### Re-exported from oh-my-opencode

Templates for shared commands: - `templates/init-deep.ts` -
`templates/ralph-loop.ts` - `templates/start-work.ts` -
`templates/stop-continuation.ts` - `templates/refactor.ts` - `index.ts` -
`types.ts`

### Local Files (Modified for Gemini)

-   `commands.ts`:
    -   **Modified**: Renamed `loadBuiltinCommands` to `getBuiltinCommands`.
    -   **Modified**: Injected Gemini-specific loop commands and configuration
        mappings.
-   `templates/no-agent.ts`: Gemini-specific template for no-agent mode.
-   `templates/visualize-plan.ts`: Template for plan visualization.

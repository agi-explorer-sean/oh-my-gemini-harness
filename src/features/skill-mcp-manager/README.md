# skill-mcp-manager

This feature manages MCP servers embedded within skills.

## File Sources

### Re-exported from oh-my-opencode

-   `env-cleaner.ts`: Re-exported.
-   `index.ts`: Re-exported.
-   `types.ts`: Re-exported.

### Local Files (Modified for Gemini)

-   `manager.ts`:
    -   **Modified**: Added a `shutdown` method to cleanly disconnect all MCP
        clients, supporting Gemini's lifecycle management.
-   `manager.test.ts`: Localized tests.

# gemini-tasks

This feature provides a robust task tracking system for the CLI.

## File Sources

### Adapted from oh-my-opencode (claude-tasks)

This feature is a renaming and adaptation of the `claude-tasks` feature:

-   `storage.ts`:
    -   **Modified**: Updated imports to use `OhMyGeminiConfig` instead of
        `OhMyOpenCodeConfig`.
    -   **Modified**: Optimized file system operations by including `lstatSync`
        for better directory management.
-   `types.ts`:
    -   **Modified**: Re-exported from vendor while maintaining local
        compatibility.

### Re-exported from oh-my-opencode

-   `index.ts`: Re-exported.
-   `types.test.ts`: Localized tests.
-   `storage.test.ts`: Localized tests for persistence.

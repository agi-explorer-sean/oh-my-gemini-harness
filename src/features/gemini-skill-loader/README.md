# gemini-skill-loader

This feature manages the discovery and loading of skills from the workspace
(`skills/` directory).

## File Sources

### Adapted from oh-my-opencode (opencode-skill-loader)

This feature is a renaming and adaptation of the `opencode-skill-loader`
feature:

-   `loader.ts`:
    -   **Modified**: Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`.
-   `types.ts`:
    -   **Modified**: Updated `SkillScope` to use `gemini` and `gemini-project`
        instead of `opencode` and `opencode-project`.
-   `async-loader.ts`:
    -   **Modified**: Renamed `loadMcpJsonFromDirAsync` to
        `getMcpJsonFromDirAsync`.
-   `merger.ts`:
    -   **Modified**: Updated priority mapping to use `gemini` and
        `gemini-project`.
-   `skill-content.ts`:
    -   **Modified**: Updated the "Ultraworked with" footer URL to point to the
        `oh-my-gemini` repository.

### Re-exported from oh-my-opencode

-   `blocking.ts`: Re-exported.
-   `discover-worker.ts`: Re-exported.
-   `index.ts`: Local entry point.
-   `merger.ts`: (Shared logic, re-exported where possible).
-   `*.test.ts`: Localized tests.

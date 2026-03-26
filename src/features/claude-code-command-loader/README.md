# claude-code-command-loader

This feature enables loading commands designed for Claude Code into the Gemini
environment.

## File Sources

### Re-exported from oh-my-opencode

-   `index.ts`: Re-exports the entire feature from the third-party vendor to
    ensure maximum compatibility where modifications aren't required.

### Local Files (Modified for Gemini)

-   `loader.ts`: Significant adaptations from the vendor source:
    -   **Modified**: Renamed all `load*Commands` functions to `get*Commands`
        (e.g., `getUserCommands`, `getAllCommands`).
    -   **Modified**: Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`
        to point to Gemini-specific configuration paths.
    -   **Modified**: Updated `CommandScope` and internal source checks to use
        `gemini` and `gemini-project` instead of `opencode` and
        `opencode-project`.
-   `types.ts`:
    -   **Modified**: Updated `CommandScope` type definition to include `gemini`
        and `gemini-project`.

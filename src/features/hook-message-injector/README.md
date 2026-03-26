# hook-message-injector

This feature allows hooks to inject messages or data into the session stream.

## File Sources

### Re-exported from oh-my-opencode

-   `index.ts`: Re-exported.
-   `types.ts`: Re-exported.

### Local Files (Modified for Gemini)

-   `constants.ts`:
    -   **Modified**: Replaced `getOpenCodeStorageDir` with
        `getGeminiStorageDir` and updated `OPENCODE_STORAGE` to `GEMINI_STORAGE`
        (implied by usage).
-   `injector.ts`:
    -   **Modified**: Updated documentation comments to refer to `Gemini`
        instead of `OpenCode`.

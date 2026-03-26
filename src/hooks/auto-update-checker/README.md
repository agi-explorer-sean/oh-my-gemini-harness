# auto-update-checker

Periodically checks for plugin updates and performs background installations.

## File Comparisons

### cache.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-update-checker/cache.ts`
-   **Modifications**: None.

### checker.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-update-checker/checker.ts`
-   **Modifications**:
    -   Replaced `USER_OPENCODE_CONFIG` with `USER_GEMINI_CONFIG`.
    -   Updated config path lookups to search for `.gemini/gemini.json`.
    -   Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`.

### constants.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-update-checker/constants.ts`
-   **Modifications**:
    -   Changed `PACKAGE_NAME` to `oh-my-gemini`.
    -   Replaced cache and config directory names from `opencode` to `gemini`.

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-update-checker/index.ts`
-   **Modifications**:
    -   Updated branding strings from `OpenCode` to `Gemini` in toast messages.
    -   Updated startup messages (e.g., `Gemini is now on Steroids`).

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-update-checker/types.ts`
-   **Modifications**: Renamed `OpencodeConfig` to `GeminiConfig`.

# session-recovery

Orchestrates recovery from various LLM errors (thinking order, tool results
missing).

## File Comparisons

### index.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/session-recovery/index.ts`
-   **Modifications**: None (logic identical, operating on local modules).

### constants.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/session-recovery/constants.ts`
-   **Modifications**:
    -   Replaced `getOpenCodeStorageDir` with `getGeminiStorageDir`.
    -   Renamed `OPENCODE_STORAGE` to `GEMINI_STORAGE`.

### storage.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/session-recovery/storage.ts`
-   **Modifications**: None.

### types.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/session-recovery/types.ts`
-   **Modifications**: Renamed `OpenCodeSessionMessage` to
    `GeminiSessionMessage`.

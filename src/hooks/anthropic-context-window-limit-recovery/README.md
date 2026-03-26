# anthropic-context-window-limit-recovery

Specialized recovery for Anthropic token limit errors, including aggressive
truncation of tool outputs.

## File Comparisons

### executor.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/executor.ts`
-   **Modifications**: Updated imports to point to local
    `session-recovery/storage`.

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/index.ts`
-   **Modifications**: None.

### parser.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/parser.ts`
-   **Modifications**: None.

### pruning-deduplication.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/pruning-deduplication.ts`
-   **Modifications**: Updated imports to point to local
    `features/hook-message-injector`.

### storage.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/storage.ts`
-   **Modifications**:
    -   Replaced `getOpenCodeStorageDir` with `getGeminiStorageDir`.
    -   Renamed `OPENCODE_STORAGE` to `GEMINI_STORAGE`.

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/anthropic-context-window-limit-recovery/types.ts`
-   **Modifications**: None.

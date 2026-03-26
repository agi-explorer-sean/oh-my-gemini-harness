# ralph-loop

Implements self-referential development loops.

## File Comparisons

### index.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/ralph-loop/index.ts`
-   **Modifications**:
    -   Replaced `OpenCodeSessionMessage` with `GeminiSessionMessage`.
    -   Updated agent names and session persistence logic for Gemini.
    -   Added support for `MessageAbortedError` and `AbortError` detection.

### constants.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/ralph-loop/constants.ts`
-   **Modifications**: None.

### storage.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/ralph-loop/storage.ts`
-   **Modifications**: None.

### types.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/ralph-loop/types.ts`
-   **Modifications**: None.

### parser.ts

-   **Source**: Local implementation.
-   **Purpose**: Parses ralph-loop output for structured processing.

### parser.test.ts

-   Tests for `parser.ts`.

# non-interactive-env

Injects non-interactive environment variables into bash commands to prevent
hangs.

## File Comparisons

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/non-interactive-env/index.ts`
-   **Modifications**: Updated comments to mention Gemini environment.

### constants.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/non-interactive-env/constants.ts`
-   **Modifications**: None.

### detector.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/non-interactive-env/detector.ts`
-   **Modifications**: Replaced `OPENCODE_RUN` and `OPENCODE_NON_INTERACTIVE`
    with `GEMINI_RUN` and `GEMINI_NON_INTERACTIVE`.

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/non-interactive-env/types.ts`
-   **Modifications**: None.

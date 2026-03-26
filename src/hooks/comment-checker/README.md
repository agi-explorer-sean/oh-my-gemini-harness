# comment-checker

Prevents agents from committing/writing code with "AI comments" (e.g., `// ...
existing code ...`).

## File Comparisons

### cli.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/comment-checker/cli.ts`
-   **Modifications**:
    -   Replaced `@code-yeongyu/comment-checker` with
        `@agi-explorer-sean/comment-checker`.

### downloader.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/comment-checker/downloader.ts`
-   **Modifications**:
    -   Replaced `code-yeongyu/go-claude-code-comment-checker` with
        `agi-explorer-sean/go-claude-code-comment-checker`.
    -   Changed cache directory name to `oh-my-gemini`.

### index.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/comment-checker/index.ts`
-   **Modifications**: None.

### types.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/comment-checker/types.ts`
-   **Modifications**: None.

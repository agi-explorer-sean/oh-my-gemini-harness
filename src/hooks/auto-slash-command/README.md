# auto-slash-command

Automatically expands slash commands (e.g., `/commit`) into their template
instructions.

## File Comparisons

### constants.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-slash-command/constants.ts`
-   **Modifications**: None.

### detector.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-slash-command/detector.ts`
-   **Modifications**: None.

### executor.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-slash-command/executor.ts`
-   **Modifications**:
    -   Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`.
    -   Added support for `.gemini/command` and global Gemini config
        directories.
    -   Changed `opencode` model sanitization to `gemini`.
    -   Updated imports to point to local `gemini-skill-loader`.

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-slash-command/index.ts`
-   **Modifications**: Added support for asynchronous skill discovery via
    `getSkills` option.

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/auto-slash-command/types.ts`
-   **Modifications**: None.

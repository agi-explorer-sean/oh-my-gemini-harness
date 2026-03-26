# claude-code-hooks

Bridge for running original Claude Code hooks within the Gemini environment.

## File Comparisons

### config-loader.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/config-loader.ts`
-   **Modifications**:
    -   Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`.
    -   Renamed config file to `gemini-cc-plugin.json`.

### config.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/config.ts`
-   **Modifications**: None.

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/index.ts`
-   **Modifications**: None (logic identical, operating on local modules).

### post-tool-use.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/post-tool-use.ts`
-   **Modifications**: Changed `hook_source` from `opencode-plugin` to
    `gemini-plugin`.

### pre-compact.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/pre-compact.ts`
-   **Modifications**: Changed `hook_source` from `opencode-plugin` to
    `gemini-plugin`.

### pre-tool-use.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/pre-tool-use.ts`
-   **Modifications**: Changed `hook_source` from `opencode-plugin` to
    `gemini-plugin`.

### stop.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/claude-code-hooks/stop.ts`
-   **Modifications**: Changed `hook_source` from `opencode-plugin` to
    `gemini-plugin`.

### todo.ts

-   **Source**: `third_party/oh-my-opencode/src/hooks/claude-code-hooks/todo.ts`
-   **Modifications**: Renamed `OpenCodeTodo` to `GeminiTodo`.

### tool-input-cache.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/tool-input-cache.ts`
-   **Modifications**: None.

### transcript.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/transcript.ts`
-   **Modifications**:
    -   Renamed `OpenCodeMessage` interfaces to `GeminiMessage`.
    -   Changed temporary file prefix to `gemini-transcript-`.

### plugin-config.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/plugin-config.ts`
-   **Modifications**: None.

### user-prompt-submit.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/user-prompt-submit.ts`
-   **Modifications**: None.

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/claude-code-hooks/types.ts`
-   **Modifications**: Changed `HookSource` to `gemini-plugin`.

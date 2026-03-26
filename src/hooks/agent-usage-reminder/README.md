# agent-usage-reminder

Reminds users to use specialized agents instead of direct search tools.

## File Comparisons

### constants.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/agent-usage-reminder/constants.ts`
-   **Modifications**:
    -   Replaced `getOpenCodeStorageDir` with `getGeminiStorageDir`.
    -   Renamed `OPENCODE_STORAGE` to `GEMINI_STORAGE`.
    -   Changed `call_omo_agent` to `call_subagent` in `AGENT_TOOLS`.

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/agent-usage-reminder/index.ts`
-   **Modifications**: None (logic identical, imports local constants).

### storage.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/agent-usage-reminder/storage.ts`
-   **Modifications**: None (imports local constants).

### types.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/agent-usage-reminder/types.ts`
-   **Modifications**: None.

# category-skill-reminder

Encourages the use of category-based delegation for better task routing.

## File Comparisons

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/category-skill-reminder/index.ts`
-   **Modifications**:
    -   Changed `call_omo_agent` to `call_subagent` in `DELEGATION_TOOLS`.
    -   Added logic to handle `sisyphus` and `atlas` keywords in agent name
        detection.

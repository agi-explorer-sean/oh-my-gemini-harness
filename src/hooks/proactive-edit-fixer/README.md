# proactive-edit-fixer

Corrects minor whitespace/indentation discrepancies in Edit tool calls before
execution.

## File Comparisons

### index.ts

-   **Source**: Local implementation only.
-   **Purpose**: Fixes common "oldString not found" errors by performing fuzzy
    whitespace matching against the actual file content.

# task

A system for tracking and managing hierarchical mission TODOs.

## Differences from Vendor Core

| Feature | Local (`src/tools/task`)     | Vendor                             |
:         :                              : (`third_party/oh-my-opencode/...`) :
| ------- | ---------------------------- | ---------------------------------- |
| Teams   | Full **Agent Teams** support | Single-user only                   |
| Sync    | Internal Gemini Todo API     | Local files only                   |

## Re-imported from oh-my-opencode

-   Zod schemas for task objects and status transitions.
-   Action-based tool interface (create, list, get, update).
-   Atomic JSON writing logic.

## Modified for Gemini

-   **Team-Awareness**: Added the `teamName` parameter to all task actions. This
    redirects task storage to `.gemini/teams/{team}/tasks/`, enabling multiple
    agents in a stateful team to collaborate on a shared mission.
-   **Internal API Integration**: The `todo-sync` utility is overhauled to use
    the `gemini/session/todo` internal loader, allowing tasks to sync with the
    native Gemini Todo UI.
-   **Enhanced Summaries**: The `taskList` tool is modified to automatically
    filter blocked tasks, providing a high-signal "Ready for Work" view for
    parallels.

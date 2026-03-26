# task-toast-manager

This feature provides visual feedback for background task status via CLI
"toasts".

## File Sources

### Local Files (Modified for Gemini)

-   **types.ts**:

    -   **Change**: Created as a local re-export from
        `third_party/oh-my-opencode/src/features/task-toast-manager/types`.
    -   **Difference**: The vendor version contains the raw definitions; the
        local file ensures these types are discoverable within the `src/`
        hierarchy.
    -   **Issues Solved**: Resolves TypeScript error TS2307 (Module not found)
        in `src/tools/delegate-task/executor.ts` and other tools that depend on
        `TaskStatus` or `TaskToastOptions`.

-   **index.ts**:

    -   **Change**: Local re-export.
    -   **Difference**: Ensures the local `types.ts` takes precedence during
        resolution.
    -   **Issues Solved**: Maintains structural consistency for the
        `src/features` barrel exports.

### Re-exported from oh-my-opencode

The manager logic is provided by the vendor core via `index.ts`.

# background-agent

This feature manages background tasks and parallel execution.

## File Sources

### Re-exported from oh-my-opencode

These files are identical to the vendor core and are loaded via re-exports: -
`concurrency.test.ts` - `result-handler.ts`

### Local Files (Modified for Gemini)

These files contain adaptations for Gemini-specific workflows, stability, and
branding:

-   **manager.ts**:

    -   **Change**: Added `baseUrl` sanitization in the constructor, a fail-fast
        `isServerRunning` check in `startTask`, and robust concurrency slot
        release in `try-catch` blocks.
    -   **Difference**: The vendor version does not sanitize the server URL
        (potentially leading to double slashes) and lacks a pre-flight
        connectivity check, assuming the Gemini server is always reachable.
    -   **Issues Solved**: Prevents "Invalid request path" errors caused by
        malformed URLs and avoids tasks getting stuck in a "running" state when
        the Gemini server is unreachable. Ensures concurrency slots are never
        leaked if a task fails to start.

-   **concurrency.ts**:

    -   **Change**: Promoted from re-export to local file. Added a `60000ms`
        (60s) timeout to the `acquire` queue and timer-based cleanup.
    -   **Difference**: The vendor version uses a simple queue that can hang
        indefinitely if a slot is never released or if an agent stalls.
    -   **Issues Solved**: Eliminates permanent deadlocks in parallel execution
        parallels by timing out requests that have been queued for too long,
        allowing the system to recover from environment-induced stalls.

-   **constants.ts**:

    -   **Modified**: `POLLING_INTERVAL_MS` reduced from 3000ms to 1000ms for
        more responsive background task monitoring in the Gemini environment.

-   **spawner.ts**:

    -   **Modified**: Added more robust error handling with explicit `any` type
        casting for caught errors in session retrieval.

-   **state.ts**:

    -   **Modified**: Enhanced `getAllDescendantTasks` with cycle detection
        using a `Set` to prevent infinite recursion in complex task hierarchies.

-   **types.ts**:

    -   **Modified**: Introduced `BackgroundTaskType` ("task" | "parallel_exec")
        to support specialized parallel parallel coordination.

-   **manager.test.ts**:

    -   **Modified**: Added mocks for `shared` utilities and
        `claude-code-session-state` to support isolated testing in the Gemini
        repository.

-   **index.ts**: Local entry point connecting the modified components.

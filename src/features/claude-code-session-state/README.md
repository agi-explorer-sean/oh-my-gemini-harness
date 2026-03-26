# claude-code-session-state

This feature maintains session state compatibility with Claude Code.

## File Sources

### Re-exported from oh-my-opencode

-   `index.ts`: Re-exports the session state manager from the third-party
    vendor.

### Local Files

-   `state.test.ts`: Local tests adapted from the vendor.
    -   **Modified**: Uses dynamic session IDs in tests to avoid collision
        during parallel test execution.

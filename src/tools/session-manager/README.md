# session-manager

Tools for exploring and auditing agent session history.

## Differences from Vendor Core

Feature  | Local (`src/tools/session-manager`) | Vendor (`third_party/oh-my-opencode/...`)
-------- | ----------------------------------- | -----------------------------------------
Storage  | `GEMINI_STORAGE`                    | `OPENCODE_STORAGE`
Branding | "Gemini sessions"                   | "OpenCode sessions"

## Re-imported from oh-my-opencode

-   Multi-threaded search logic across message history.
-   Formatting utilities for tabular session lists and indented message history.
-   Storage scanning logic for identifying active sessions.

## Modified for Gemini

-   **Storage Redirection**: All lookups are redirected to the Gemini storage
    directory, ensuring that sessions from other framework instances are not
    mixed in.
-   **Improved Information Aggregation**: The `session_info` tool is enhanced to
    better report on agents used within a session, which is critical for
    debugging complex Gemini delegation chains.

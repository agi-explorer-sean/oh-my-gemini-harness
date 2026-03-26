# call-subagent

High-level tool for spawning specialized sub-agents (`explore`, `librarian`).

## Differences from Vendor Core

| Feature   | Local                       | Vendor                             |
:           : (`src/tools/call-subagent`) : (`third_party/oh-my-opencode/...`) :
| --------- | --------------------------- | ---------------------------------- |
| Tool Name | `call_subagent`             | `call_omo_agent`                   |
| Identity  | Gemini CLI Native           | Oh-My-OpenCode Core                |

## Re-imported from oh-my-opencode

-   Session creation and management logic using the internal plugin client.
-   Polling stability detection (STABILITY_REQUIRED) to determine when a
    sub-agent has finished its turn.
-   Message history reconstruction for returning results to the primary agent.

## Modified for Gemini

-   **Branding and Mapping**: Renamed the tool to `call_subagent` to align with
    Gemini's naming conventions and system prompt instructions.
-   **Enhanced Parent Resolution**: Improved the logic for identifying the
    calling agent's identity to ensure that sub-agents correctly inherit context
    and tool restrictions.
-   **Interactive Safety**: Strictly enforces `question: deny` in sub-agent
    sessions to prevent CLI hangs during background or nested execution.

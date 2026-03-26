# skill-mcp

Tool for invoking operations from skill-embedded MCP servers.

## Differences from Vendor Core

| Feature | Local                   | Vendor                             |
:         : (`src/tools/skill-mcp`) : (`third_party/oh-my-opencode/...`) :
| ------- | ----------------------- | ---------------------------------- |
| Manager | `SkillMcpManager`       | Vendor manager                     |
:         : (Gemini)                :                                    :

## Re-imported from oh-my-opencode

-   Parameter validation for tool/resource/prompt operations.
-   Grep filtering for large MCP outputs.
-   JSON argument parsing logic.

## Modified for Gemini

-   **Branding and Context**: Integrated with the local `skill-mcp-manager` to
    ensure consistent session IDs and error reporting within the Gemini
    ecosystem.
-   **Error Guidance**: Enhanced error messages to suggest the exact `skill`
    command needed to activate an MCP server before calling it.

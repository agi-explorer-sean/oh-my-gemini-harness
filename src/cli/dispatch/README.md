# dispatch

This directory contains the logic for handling native Gemini CLI hooks via the
`oh-my-gemini dispatch` command.

## File Sources

### Local Implementation

-   `index.ts`: Implements the dispatch loop that receives events from the
    Gemini CLI (BeforeAgent, BeforeTool, etc.) and routes them to the plugin's
    hook handlers.

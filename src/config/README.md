# config

This directory contains the configuration schema and validation logic for
OhMyGemini.

## File Sources

### Re-exported from oh-my-opencode

-   `index.ts`: Barrel export for schema and types.

### Local Implementation

-   `schema.ts`: Defines the Zod schema for `oh-my-gemini.json`. This is
    specific to Gemini and includes definitions for all Gemini-only features
    like `agent_teams`, `ralph_loop`, and `browser_automation_engine`.

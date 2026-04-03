# Commands

This directory contains static TOML templates for slash commands (e.g., `/refactor`, `/sisyphus`). These templates define the initial instructions sent to the agent when a command is invoked.

## Dynamic Injection Placeholders

When writing or modifying a command template, you can use the following placeholders to inject dynamic context:

- `$ARGUMENTS` (Preferred)
- `${user_message}` (Legacy)

### Why `$ARGUMENTS` and `${user_message}` matter:

1. **Contextualizing Static Templates:** When you run a command like `/refactor src/index.ts`, the system loads the static `refactor.toml` template. These placeholders are where `src/index.ts` is injected. Without them, a command could only ever execute a hardcoded prompt and couldn't operate on user-specified files or instructions.
2. **Agent Handoff:** In commands that switch to sub-agents (like `/atlas` or `/sisyphus`), these placeholders ensure that the exact question or task you typed is forwarded to the newly spawned agent's initial prompt, maintaining context across the handoff.
3. **Backwards Compatibility:** The presence of both `$ARGUMENTS` and `${user_message}` in the substitution logic (as seen in `src/tools/slashcommand/tools.ts`) ensures backwards compatibility. It allows older templates using the `${user_message}` syntax to continue functioning while the codebase transitions to the cleaner `$ARGUMENTS` standard. 

By replacing these placeholders at runtime, the CLI transforms generic, reusable prompt templates into highly specific, actionable directives for the AI agents.

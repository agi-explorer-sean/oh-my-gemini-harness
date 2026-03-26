export const NO_AGENT_TEMPLATE = `Toggle no-agent mode for the current session.

When no-agent mode is enabled:
- Messages are NOT automatically delegated to the default agent (sisyphus)
- The base Gemini session handles requests directly
- All extension tools (workspace, etc.) are available
- You can still explicitly invoke agents with @agent syntax

When no-agent mode is disabled (default):
- Messages are routed to the default agent for software engineering tasks
- Agent delegation provides orchestration, planning, and specialized capabilities

This is a per-session toggle. The mode resets when the session ends.`;

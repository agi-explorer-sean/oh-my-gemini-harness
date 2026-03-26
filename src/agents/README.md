# agents

This directory contains the agent configurations for Gemini. Builtin agents
(oracle, librarian, explore, etc.) are now defined as markdown files in the
`agents/` directory at the project root and loaded dynamically at runtime.
The `sisyphus-junior` subagent is the only agent that still has a TypeScript
wrapper, as it is used by the delegate-task and background-agent systems.

## Files

- `AGENTS.md`: Gemini-specific agent context for AI assistants.
- `index.ts`: Central export point — re-exports types and `createBuiltinAgents`.
- `types.ts`: Agent-related type definitions (`BuiltinAgentName`,
  `AgentOverrideConfig`, `AgentOverrides`).
- `utils.ts`: Primary agent registry. Loads markdown-based agent definitions
  from `agents/`, resolves models via the fallback pipeline, applies per-agent
  config (maxTokens, color, thinking), environment context, category overrides,
  and user overrides.
- `sisyphus-junior/index.ts`: Wraps the base Sisyphus-Junior subagent from
  `oh-my-opencode`, applying Gemini branding (`OhMyOpenCode` → `OhMyGemini`)
  and tool name mappings (`call_omo_agent` → `call_subagent`).
- `sisyphus-junior/index.test.ts`: Tests for the Sisyphus-Junior subagent wrapper.

/**
 * Agent tool restrictions for session.prompt calls.
 * Gemini SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

/**
 * Gemini CLI built-in tools that must be explicitly enabled when spawning
 * subagent sessions via session.prompt(). These tools do not automatically
 * propagate to programmatically-created child sessions.
 */
export const BUILTIN_TOOLS_TO_PROPAGATE: Record<string, boolean> = {
  google_web_search: true,
};

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
  call_subagent: false,
};

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    delegate_task: false,
  },

  'multimodal-looker': {
    read: true,
  },

  'sisyphus-junior': {
    task: false,
    delegate_task: false,
  },
};

function findRestrictions(
  agentName: string,
): Record<string, boolean> | undefined {
  return (
    AGENT_RESTRICTIONS[agentName] ??
    Object.entries(AGENT_RESTRICTIONS).find(
      ([key]) => key.toLowerCase() === agentName.toLowerCase(),
    )?.[1]
  );
}

export function getAgentToolRestrictions(
  agentName: string,
): Record<string, boolean> {
  return findRestrictions(agentName) ?? {};
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = findRestrictions(agentName);
  return restrictions !== undefined && Object.keys(restrictions).length > 0;
}

import { 
  createSisyphusJuniorAgentWithOverrides as createBaseSisyphusJuniorAgentWithOverrides, 
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt as buildBaseSisyphusJuniorPrompt
} from "../../../third_party/oh-my-opencode/src/agents/sisyphus-junior"
import type { AgentOverrideConfig } from "@config/schema"
import type { AgentConfig } from "@opencode-ai/sdk";

export { SISYPHUS_JUNIOR_DEFAULTS, getSisyphusJuniorPromptSource }

/**
 * Builds the appropriate Sisyphus-Junior prompt based on model.
 * Wraps the base prompt and applies Gemini branding.
 */
export function buildSisyphusJuniorPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const prompt = buildBaseSisyphusJuniorPrompt(model, useTaskSystem, promptAppend)
  return prompt
    .replace(/OhMyOpenCode/g, "OhMyGemini")
    .replace(/call_omo_agent/g, "call_subagent")
}

/**
 * Sisyphus-Junior agent for Gemini.
 * Wraps the base Sisyphus-Junior agent and adds Gemini-specific branding.
 */
export function createSisyphusJuniorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  const agent = createBaseSisyphusJuniorAgentWithOverrides(
    override,
    systemDefaultModel,
    useTaskSystem
  ) as AgentConfig
  
  // Apply branding and tool names to the prompt
  if (agent.prompt) {
    agent.prompt = agent.prompt
      .replace(/OhMyOpenCode/g, "OhMyGemini")
      .replace(/call_omo_agent/g, "call_subagent")
  }
    
  // Apply branding to description
  if (agent.description) {
    agent.description = agent.description.replace("OhMyOpenCode", "OhMyGemini")
  }
  
  // Map permissions from OpenCode tool names to Gemini tool names
  if (agent.permission) {
    const permission = agent.permission as any
    if ("call_omo_agent" in permission) {
      permission.call_subagent = permission.call_omo_agent
      delete permission.call_omo_agent
    }
    
    // Add Gemini-specific blocked tools
    permission.parallel_exec = "deny"
  }
  
  return agent
}

createSisyphusJuniorAgentWithOverrides.mode = "subagent" as const

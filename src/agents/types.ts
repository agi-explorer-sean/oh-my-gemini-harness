import type { AgentConfig } from "@opencode-ai/sdk";

export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || model.startsWith("github-copilot/gpt-")
}

export type BuiltinAgentName =
  | "sisyphus"
  | "hephaestus"
  | "oracle"
  | "librarian"
  | "explore"
  | "multimodal-looker"
  | "metis"
  | "momus"
  | "atlas"

export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

export type AgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string
  variant?: string
}

export type AgentOverrides = Partial<Record<OverridableAgentName, AgentOverrideConfig>>

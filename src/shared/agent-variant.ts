import type {OhMyGeminiConfig} from '../config';
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from './model-requirements';

type AgentOverride = {variant?: string; category?: string};

function findAgentOverride(
  config: OhMyGeminiConfig,
  agentName: string,
): AgentOverride | undefined {
  const overrides = config.agents as Record<string, AgentOverride> | undefined;
  if (!overrides) return undefined;
  return (
    overrides[agentName] ??
    Object.entries(overrides).find(
      ([key]) => key.toLowerCase() === agentName.toLowerCase(),
    )?.[1]
  );
}

export function resolveAgentVariant(
  config: OhMyGeminiConfig,
  agentName?: string,
): string | undefined {
  if (!agentName) return undefined;

  const agentOverride = findAgentOverride(config, agentName);
  if (!agentOverride) return undefined;
  if (agentOverride.variant) return agentOverride.variant;

  const categoryName = agentOverride.category;
  if (!categoryName) return undefined;

  return config.categories?.[categoryName]?.variant;
}

export function resolveVariantForModel(
  config: OhMyGeminiConfig,
  agentName: string,
  currentModel: {providerID: string; modelID: string},
): string | undefined {
  const agentOverride = findAgentOverride(config, agentName);
  if (agentOverride?.variant) {
    return agentOverride.variant;
  }

  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentName];
  if (agentRequirement) {
    return findVariantInChain(agentRequirement.fallbackChain, currentModel);
  }
  const categoryName = agentOverride?.category;
  if (categoryName) {
    const categoryRequirement = CATEGORY_MODEL_REQUIREMENTS[categoryName];
    if (categoryRequirement) {
      return findVariantInChain(
        categoryRequirement.fallbackChain,
        currentModel,
      );
    }
  }

  return undefined;
}

function findVariantInChain(
  fallbackChain: {providers: string[]; model: string; variant?: string}[],
  currentModel: {providerID: string; modelID: string},
): string | undefined {
  for (const entry of fallbackChain) {
    if (
      entry.providers.includes(currentModel.providerID) &&
      entry.model === currentModel.modelID
    ) {
      return entry.variant;
    }
  }
  return undefined;
}

export function applyAgentVariant(
  config: OhMyGeminiConfig,
  agentName: string | undefined,
  message: {variant?: string} | undefined,
): void {
  if (!message) return;
  const variant = resolveAgentVariant(config, agentName);
  if (variant !== undefined && message.variant === undefined) {
    message.variant = variant;
  }
}

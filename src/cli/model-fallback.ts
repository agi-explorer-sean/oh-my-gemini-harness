import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
} from "../shared/model-requirements"
import type { InstallConfig } from "./types"

interface ProviderAvailability {
  native: {
    gemini: boolean
  }
  geminiZen: boolean
  isMaxPlan: boolean
}

interface AgentConfig {
  model: string
  variant?: string
}

interface CategoryConfig {
  model: string
  variant?: string
}

export interface GeneratedOmgConfig {
  $schema: string
  agents?: Record<string, AgentConfig>
  categories?: Record<string, CategoryConfig>
  [key: string]: unknown
}

const ULTIMATE_FALLBACK = "google/gemini-2.5-flash-lite"
const SCHEMA_URL = "https://raw.githubusercontent.com/agi-explorer-sean/omg-harness/master/assets/oh-my-gemini.schema.json"

function toProviderAvailability(config: InstallConfig): ProviderAvailability {
  return {
    native: {
      gemini: config.hasGemini,
    },
    geminiZen: config.hasGeminiZen ?? false,
    isMaxPlan: config.isMax20 ?? false,
  }
}

function isProviderAvailable(provider: string, avail: ProviderAvailability): boolean {
  const mapping: Record<string, boolean> = {
    google: avail.native.gemini,
    gemini: avail.geminiZen,
  }
  return mapping[provider] ?? false
}

function resolveModelFromChain(
  fallbackChain: FallbackEntry[],
  avail: ProviderAvailability
): { model: string; variant?: string } | null {
  for (const entry of fallbackChain) {
    for (const provider of entry.providers) {
      if (isProviderAvailable(provider, avail)) {
        return {
          model: `${provider}/${entry.model}`,
          variant: entry.variant,
        }
      }
    }
  }
  return null
}

function getSisyphusFallbackChain(): FallbackEntry[] {
  return AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain
}

function isAnyFallbackEntryAvailable(
  fallbackChain: FallbackEntry[],
  avail: ProviderAvailability
): boolean {
  return fallbackChain.some((entry) =>
    entry.providers.some((provider) => isProviderAvailable(provider, avail))
  )
}

function isRequiredModelAvailable(
  requiresModel: string,
  fallbackChain: FallbackEntry[],
  avail: ProviderAvailability
): boolean {
  const matchingEntry = fallbackChain.find((entry) => entry.model === requiresModel)
  if (!matchingEntry) return false
  return matchingEntry.providers.some((provider) => isProviderAvailable(provider, avail))
}

export function generateModelConfig(config: InstallConfig): GeneratedOmgConfig {
  const avail = toProviderAvailability(config)
  const hasAnyProvider =
    avail.native.gemini ||
    avail.geminiZen

  if (!hasAnyProvider) {
    return {
      $schema: SCHEMA_URL,
      agents: Object.fromEntries(
        Object.entries(AGENT_MODEL_REQUIREMENTS)
          .filter(([role, req]) => !(role === "sisyphus" && req.requiresAnyModel))
          .map(([role]) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CATEGORY_MODEL_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, AgentConfig> = {}
  const categories: Record<string, CategoryConfig> = {}

  for (const [role, req] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
    if (role === "sisyphus") {
      const fallbackChain = getSisyphusFallbackChain()
      if (req.requiresAnyModel && !isAnyFallbackEntryAvailable(fallbackChain, avail)) {
        continue
      }
      const resolved = resolveModelFromChain(fallbackChain, avail)
      if (resolved) {
        const variant = resolved.variant ?? req.variant
        agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
      }
      continue
    }

    if (req.requiresModel && !isRequiredModelAvailable(req.requiresModel, req.fallbackChain, avail)) {
      continue
    }

    const resolved = resolveModelFromChain(req.fallbackChain, avail)
    if (resolved) {
      const variant = resolved.variant ?? req.variant
      agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
    } else {
      agents[role] = { model: ULTIMATE_FALLBACK }
    }
  }

  for (const [cat, req] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
    // Special case: unspecified-high downgrades to unspecified-low when not isMaxPlan
    const fallbackChain =
      cat === "unspecified-high" && !avail.isMaxPlan
        ? CATEGORY_MODEL_REQUIREMENTS["unspecified-low"].fallbackChain
        : req.fallbackChain

    if (req.requiresModel && !isRequiredModelAvailable(req.requiresModel, req.fallbackChain, avail)) {
      continue
    }

    const resolved = resolveModelFromChain(fallbackChain, avail)
    if (resolved) {
      const variant = resolved.variant ?? req.variant
      categories[cat] = variant ? { model: resolved.model, variant } : { model: resolved.model }
    } else {
      categories[cat] = { model: ULTIMATE_FALLBACK }
    }
  }

  return {
    $schema: SCHEMA_URL,
    agents,
    categories,
  }
}


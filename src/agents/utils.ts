import type {AgentConfig} from '@opencode-ai/sdk';
import type {
  BrowserAutomationProvider,
  CategoriesConfig,
  CategoryConfig,
  GitMasterConfig,
} from '../config/schema';
import type {LoadedSkill} from '../features/gemini-skill-loader/types';
import {
  AGENT_MODEL_REQUIREMENTS,
  deepMerge,
  fetchAvailableModels,
  isAnyFallbackModelAvailable,
  isModelAvailable,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from '../shared';
import {DEFAULT_CATEGORIES} from '../tools/delegate-task/constants';
import type {
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinAgentName,
} from './types';
import {isGptModel} from './types';

import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {isMarkdownFile} from '../shared/file-utils';
import {parseFrontmatter} from '../shared/frontmatter';

/** All builtin agents — all built from markdown, no TypeScript factories. */
const ALL_BUILTIN_AGENTS: BuiltinAgentName[] = [
  'oracle',
  'librarian',
  'explore',
  'multimodal-looker',
  'metis',
  'momus',
  'sisyphus',
  'hephaestus',
  'atlas',
];

/** Non-prompt config fields that were previously set by TypeScript factories. */
const AGENT_EXTRA_CONFIG: Partial<
  Record<BuiltinAgentName, (model: string) => Partial<AgentConfig>>
> = {
  sisyphus: (model) => ({
    maxTokens: 64000,
    color: '#00CED1',
    ...(isGptModel(model)
      ? {reasoningEffort: 'medium' as const}
      : {thinking: {type: 'enabled', budgetTokens: 32000}}),
  }),
  hephaestus: () => ({
    maxTokens: 32000,
    color: '#FF4500',
    reasoningEffort: 'medium' as const,
  }),
  atlas: () => ({
    color: '#10B981',
  }),
};

/** Primary agents inherit the UI-selected model. */
const PRIMARY_AGENTS = new Set<BuiltinAgentName>(['sisyphus', 'atlas']);

/** Agents that get environment context (date/time/timezone) appended to prompt. */
const ENV_CONTEXT_AGENTS = new Set<BuiltinAgentName>([
  'sisyphus',
  'hephaestus',
  'librarian',
]);

/** Default variant overrides per agent. */
const AGENT_DEFAULT_VARIANT: Partial<Record<BuiltinAgentName, string>> = {
  hephaestus: 'medium',
};

interface AgentMarkdownData {
  name?: string;
  display_name?: string;
  description?: string;
  tools?: string[] | string;
}

async function loadMarkdownAgentsFromDir(
  agentsDir: string,
): Promise<Record<string, AgentConfig>> {
  if (!existsSync(agentsDir)) {
    return {};
  }

  const entries = await readdir(agentsDir, {withFileTypes: true});
  const agents: Record<string, AgentConfig> = {};

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue;

    const agentPath = join(agentsDir, entry.name);
    const agentName = basename(entry.name, '.md');

    try {
      const content = await readFile(agentPath, 'utf-8');
      const {data, body} = parseFrontmatter<AgentMarkdownData>(content);

      const name = data.name || agentName;

      const config: AgentConfig = {
        description: data.description || '',
        prompt: body.trim(),
      };

      if (data.tools) {
        const tools: Record<string, boolean> = {};
        const toolsArray = Array.isArray(data.tools)
          ? data.tools
          : data.tools.split(',').map((t) => t.trim());

        for (const tool of toolsArray) {
          tools[tool] = true;
        }
        config.tools = tools;
      }

      agents[name] = config;
    } catch {
      continue;
    }
  }

  return agents;
}

function createEnvContext(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;

  const dateStr = now.toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const timeStr = now.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return `
<omg-env>
  Current date: ${dateStr}
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</omg-env>`;
}

function applyCategoryOverride(
  config: AgentConfig,
  categoryName: string,
  mergedCategories: Record<string, CategoryConfig>,
): AgentConfig {
  const categoryConfig = mergedCategories[categoryName];
  if (!categoryConfig) return config;

  const result = {...config} as AgentConfig & Record<string, unknown>;
  if (categoryConfig.model) result.model = categoryConfig.model;
  if (categoryConfig.variant !== undefined)
    result.variant = categoryConfig.variant;
  if (categoryConfig.temperature !== undefined)
    result.temperature = categoryConfig.temperature;
  if (categoryConfig.reasoningEffort !== undefined)
    result.reasoningEffort = categoryConfig.reasoningEffort;
  if (categoryConfig.textVerbosity !== undefined)
    result.textVerbosity = categoryConfig.textVerbosity;
  if (categoryConfig.thinking !== undefined)
    result.thinking = categoryConfig.thinking;
  if (categoryConfig.top_p !== undefined) result.top_p = categoryConfig.top_p;
  if (categoryConfig.maxTokens !== undefined)
    result.maxTokens = categoryConfig.maxTokens;

  return result as AgentConfig;
}

function applyModelResolution(input: {
  uiSelectedModel?: string;
  userModel?: string;
  requirement?: {
    fallbackChain?: {providers: string[]; model: string; variant?: string}[];
  };
  availableModels: Set<string>;
  systemDefaultModel?: string;
}) {
  const {
    uiSelectedModel,
    userModel,
    requirement,
    availableModels,
    systemDefaultModel,
  } = input;
  return resolveModelPipeline({
    intent: {uiSelectedModel, userModel},
    constraints: {availableModels},
    policy: {fallbackChain: requirement?.fallbackChain, systemDefaultModel},
  });
}

function getFirstFallbackModel(requirement?: {
  fallbackChain?: {providers: string[]; model: string; variant?: string}[];
}) {
  const entry = requirement?.fallbackChain?.[0];
  if (!entry || entry.providers.length === 0) return undefined;
  return {
    model: `${entry.providers[0]}/${entry.model}`,
    provenance: 'provider-fallback' as const,
    variant: entry.variant,
  };
}

function applyEnvironmentContext(
  config: AgentConfig,
  directory?: string,
): AgentConfig {
  if (!directory || !config.prompt) return config;
  const envContext = createEnvContext();
  return {...config, prompt: config.prompt + envContext};
}

function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>,
): AgentConfig {
  let result = config;
  const overrideCategory = (override as Record<string, unknown> | undefined)
    ?.category as string | undefined;
  if (overrideCategory) {
    result = applyCategoryOverride(result, overrideCategory, mergedCategories);
  }

  if (override) {
    result = mergeAgentConfig(result, override);
  }

  return result;
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig,
): AgentConfig {
  const {prompt_append, ...rest} = override;
  const merged = deepMerge(base, rest as Partial<AgentConfig>);

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + '\n' + prompt_append;
  }

  return merged;
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  _gitMasterConfig?: GitMasterConfig,
  _discoveredSkills: LoadedSkill[] = [],
  _client?: any,
  _browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string,
  _availableToolNames?: string[],
): Promise<Record<string, AgentConfig>> {
  const connectedProviders = readConnectedProvidersCache();
  // Avoid passing client here; calling client API during plugin init causes deadlock.
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  });
  const isFirstRunNoCache =
    availableModels.size === 0 &&
    (!connectedProviders || connectedProviders.length === 0);

  const result: Record<string, AgentConfig> = {};

  const mergedCategories = categories
    ? {...DEFAULT_CATEGORIES, ...categories}
    : DEFAULT_CATEGORIES;

  const markdownAgents = await loadMarkdownAgentsFromDir(
    join(process.cwd(), 'agents'),
  );

  for (const agentName of ALL_BUILTIN_AGENTS) {
    // Skip disabled agents
    if (
      disabledAgents.some(
        (name) => name.toLowerCase() === agentName.toLowerCase(),
      )
    )
      continue;

    // Must have a markdown file
    const mdConfig = markdownAgents[agentName];
    if (!mdConfig) continue;

    const override =
      agentOverrides[agentName] ??
      Object.entries(agentOverrides).find(
        ([key]) => key.toLowerCase() === agentName.toLowerCase(),
      )?.[1];
    const requirement = AGENT_MODEL_REQUIREMENTS[agentName];

    // requiresModel check: skip if the specific model isn't available
    if (
      requirement?.requiresModel &&
      availableModels &&
      availableModels.size > 0
    ) {
      if (
        !isModelAvailable(requirement.requiresModel, availableModels) &&
        !override?.model
      ) {
        continue;
      }
    }

    // requiresAnyModel check (sisyphus): skip if no fallback model is available
    if (requirement?.requiresAnyModel) {
      const meetsRequirement =
        override !== undefined ||
        isFirstRunNoCache ||
        isAnyFallbackModelAvailable(requirement.fallbackChain, availableModels);
      if (!meetsRequirement) continue;
    }

    // Resolve model — primary agents inherit uiSelectedModel
    const isPrimary = PRIMARY_AGENTS.has(agentName);
    let resolution = applyModelResolution({
      uiSelectedModel: isPrimary ? uiSelectedModel : undefined,
      userModel: override?.model,
      requirement,
      availableModels,
      systemDefaultModel,
    });

    if (
      !resolution &&
      isFirstRunNoCache &&
      !override?.model &&
      (!isPrimary || !uiSelectedModel)
    ) {
      resolution = getFirstFallbackModel(requirement);
    }

    if (!resolution) continue;
    const {model, variant: resolvedVariant} = resolution;

    // Build config from markdown
    let config: AgentConfig = {...mdConfig, model};

    // Apply per-agent non-prompt config (maxTokens, color, thinking, etc.)
    const extraConfigFn = AGENT_EXTRA_CONFIG[agentName];
    if (extraConfigFn) {
      config = {...config, ...extraConfigFn(model)};
    }

    // Apply variant: resolved from model pipeline, or agent-specific default
    const variant = resolvedVariant ?? AGENT_DEFAULT_VARIANT[agentName];
    if (variant) {
      config = {...config, variant};
    }

    // Apply environment context for eligible agents
    if (ENV_CONTEXT_AGENTS.has(agentName)) {
      config = applyEnvironmentContext(config, directory);
    }

    // Apply user overrides
    config = applyOverrides(config, override, mergedCategories);

    result[agentName] = config;
  }

  return result;
}

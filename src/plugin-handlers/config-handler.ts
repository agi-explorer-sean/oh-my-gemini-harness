import {
  PROMETHEUS_PERMISSION,
  PROMETHEUS_SYSTEM_PROMPT,
} from '../../third_party/oh-my-opencode/src/agents/prometheus';
import {createBuiltinAgents} from '../agents';
import {createSisyphusJuniorAgentWithOverrides} from '../agents/sisyphus-junior';
import type {OhMyGeminiConfig} from '../config';
import type {CategoryConfig} from '../config/schema';
import {getBuiltinCommands} from '../features/builtin-commands';
import {
  getGeminiGlobalAgents,
  getGeminiProjectAgents,
  getProjectAgents,
  getUserAgents,
} from '../features/claude-code-agent-loader';
import {
  getExtensionCommands,
  getGeminiGlobalCommands,
  getGeminiProjectCommands,
  getProjectCommands,
  getUserCommands,
} from '../features/claude-code-command-loader';
import {getMcpConfigs} from '../features/claude-code-mcp-loader';
import {getAllPluginComponents} from '../features/claude-code-plugin-loader';
import {
  discoverGeminiGlobalSkills,
  discoverGeminiProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
  getGeminiGlobalSkills,
  getGeminiProjectSkills,
  getProjectSkills,
  getUserSkills,
} from '../features/gemini-skill-loader';
import {createBuiltinMcps} from '../mcp';
import type {ModelCacheState} from '../plugin-state';
import {
  fetchAvailableModels,
  log,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from '../shared';
import {getGeminiConfigPaths} from '../shared/gemini-config-dir';
import {AGENT_NAME_MAP} from '../shared/migration';
import {AGENT_MODEL_REQUIREMENTS} from '../shared/model-requirements';
import {migrateAgentConfig} from '../shared/permission-compat';
import {DEFAULT_CATEGORIES} from '../tools/delegate-task/constants';

export interface ConfigHandlerDeps {
  ctx: {directory: string; client?: any};
  pluginConfig: OhMyGeminiConfig;
  modelCacheState: ModelCacheState;
  availableToolNames?: string[];
}

export function resolveCategoryConfig(
  categoryName: string,
  userCategories?: Record<string, CategoryConfig>,
): CategoryConfig | undefined {
  return userCategories?.[categoryName] ?? DEFAULT_CATEGORIES[categoryName];
}

const CORE_AGENT_ORDER = [
  'sisyphus',
  'hephaestus',
  'prometheus',
  'atlas',
] as const;

function reorderAgentsByPriority(
  agents: Record<string, unknown>,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const key of CORE_AGENT_ORDER) {
    if (Object.prototype.hasOwnProperty.call(agents, key)) {
      ordered[key] = agents[key];
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(agents)) {
    if (!seen.has(key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const {ctx, pluginConfig, modelCacheState, availableToolNames} = deps;

  return async (config: Record<string, unknown>) => {
    type ProviderConfig = {
      options?: {headers?: Record<string, string>};
      models?: Record<string, {limit?: {context?: number}}>;
    };
    const providers = config.provider as
      | Record<string, ProviderConfig>
      | undefined;

    const anthropicBeta =
      providers?.anthropic?.options?.headers?.['anthropic-beta'];
    modelCacheState.anthropicContext1MEnabled =
      anthropicBeta?.includes('context-1m') ?? false;

    if (providers) {
      for (const [providerID, providerConfig] of Object.entries(providers)) {
        const models = providerConfig?.models;
        if (models) {
          for (const [modelID, modelConfig] of Object.entries(models)) {
            const contextLimit = modelConfig?.limit?.context;
            if (contextLimit) {
              modelCacheState.modelContextLimitsCache.set(
                `${providerID}/${modelID}`,
                contextLimit,
              );
            }
          }
        }
      }
    }

    const pluginComponents =
      pluginConfig.claude_code?.plugins ?? true
        ? await getAllPluginComponents({
            enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
          })
        : {
            commands: {},
            skills: {},
            agents: {},
            mcpServers: {},
            hooksConfigs: [],
            plugins: [],
            errors: [],
          };

    if (pluginComponents.plugins.length > 0) {
      log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
        plugins: pluginComponents.plugins.map((p) => `${p.name}@${p.version}`),
      });
    }

    if (pluginComponents.errors.length > 0) {
      log(`Plugin load errors`, {errors: pluginComponents.errors});
    }

    const migratedDisabledAgents = (pluginConfig.disabled_agents ?? []).map(
      (agent) => {
        return (
          AGENT_NAME_MAP[agent.toLowerCase()] ?? AGENT_NAME_MAP[agent] ?? agent
        );
      },
    ) as typeof pluginConfig.disabled_agents;

    const includeClaudeSkillsForAwareness =
      pluginConfig.claude_code?.skills ?? true;
    const [
      discoveredUserSkills,
      discoveredProjectSkills,
      discoveredGeminiGlobalSkills,
      discoveredGeminiProjectSkills,
    ] = await Promise.all([
      includeClaudeSkillsForAwareness
        ? discoverUserClaudeSkills()
        : Promise.resolve([]),
      includeClaudeSkillsForAwareness
        ? discoverProjectClaudeSkills()
        : Promise.resolve([]),
      discoverGeminiGlobalSkills(),
      discoverGeminiProjectSkills(),
    ]);

    const allDiscoveredSkills = [
      ...discoveredGeminiProjectSkills,
      ...discoveredProjectSkills,
      ...discoveredGeminiGlobalSkills,
      ...discoveredUserSkills,
    ];

    const browserProvider =
      pluginConfig.browser_automation_engine?.provider ?? 'playwright';
    const currentModel = config.model as string | undefined;
    const builtinAgents = await createBuiltinAgents(
      migratedDisabledAgents,
      pluginConfig.agents,
      ctx.directory,
      undefined, // systemDefaultModel - let fallback chain handle this
      pluginConfig.categories,
      pluginConfig.git_master,
      allDiscoveredSkills,
      ctx.client,
      browserProvider,
      currentModel, // uiSelectedModel - takes highest priority
      availableToolNames,
    );

    // Claude Code agents use whitelist-based tools (no permission migration needed)
    const userAgents =
      pluginConfig.claude_code?.agents ?? true ? getUserAgents() : {};
    const projectAgents =
      pluginConfig.claude_code?.agents ?? true ? getProjectAgents() : {};
    const geminiGlobalAgents = getGeminiGlobalAgents();
    const geminiProjectAgents = getGeminiProjectAgents();

    const rawPluginAgents = pluginComponents.agents;
    const pluginAgents = Object.fromEntries(
      Object.entries(rawPluginAgents).map(([k, v]) => [
        k,
        v ? migrateAgentConfig(v as Record<string, unknown>) : v,
      ]),
    );

    const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;
    const builderEnabled =
      pluginConfig.sisyphus_agent?.default_builder_enabled ?? false;
    const plannerEnabled = pluginConfig.sisyphus_agent?.planner_enabled ?? true;
    const replacePlan = pluginConfig.sisyphus_agent?.replace_plan ?? true;
    const shouldDemotePlan = plannerEnabled && replacePlan;

    type AgentConfig = Record<string, Record<string, unknown> | undefined> & {
      build?: Record<string, unknown>;
      plan?: Record<string, unknown>;
      explore?: {tools?: Record<string, unknown>};
      librarian?: {tools?: Record<string, unknown>};
      'multimodal-looker'?: {tools?: Record<string, unknown>};
      atlas?: {tools?: Record<string, unknown>};
      sisyphus?: {tools?: Record<string, unknown>};
    };
    const configAgent = config.agent as AgentConfig | undefined;

    if (isSisyphusEnabled && builtinAgents.sisyphus) {
      (config as {default_agent?: string}).default_agent = 'sisyphus';

      const agentConfig: Record<string, unknown> = {
        sisyphus: builtinAgents.sisyphus,
      };

      agentConfig['sisyphus-junior'] = createSisyphusJuniorAgentWithOverrides(
        pluginConfig.agents?.['sisyphus-junior'],
        config.model as string | undefined,
      );

      if (builderEnabled) {
        const {name: _buildName, ...buildConfigWithoutName} =
          configAgent?.build ?? {};
        const migratedBuildConfig = migrateAgentConfig(
          buildConfigWithoutName as Record<string, unknown>,
        );
        const geminiBuilderOverride = pluginConfig.agents?.['Gemini-Builder'];
        const geminiBuilderBase = {
          ...migratedBuildConfig,
          description: `${configAgent?.build?.description ?? 'Build agent'} (Gemini default)`,
        };

        agentConfig['Gemini-Builder'] = geminiBuilderOverride
          ? {...geminiBuilderBase, ...geminiBuilderOverride}
          : geminiBuilderBase;
      }

      if (plannerEnabled) {
        const prometheusOverride = pluginConfig.agents?.['prometheus'] as
          | (Record<string, unknown> & {
              category?: string;
              model?: string;
              variant?: string;
              reasoningEffort?: string;
              textVerbosity?: string;
              thinking?: {type: string; budgetTokens?: number};
              temperature?: number;
              top_p?: number;
              maxTokens?: number;
            })
          | undefined;

        const categoryConfig = prometheusOverride?.category
          ? resolveCategoryConfig(
              prometheusOverride.category,
              pluginConfig.categories,
            )
          : undefined;

        const prometheusRequirement = AGENT_MODEL_REQUIREMENTS['prometheus'];
        const connectedProviders = readConnectedProvidersCache();
        // Must use cache-only mode: calling client API here deadlocks (issue #1301)
        const availableModels = await fetchAvailableModels(undefined, {
          connectedProviders: connectedProviders ?? undefined,
        });
        const isFirstRunNoCache =
          availableModels.size === 0 &&
          (!connectedProviders || connectedProviders.length === 0);

        let modelResolution = resolveModelPipeline({
          intent: {
            uiSelectedModel: currentModel,
            userModel: prometheusOverride?.model ?? categoryConfig?.model,
          },
          constraints: {availableModels},
          policy: {
            fallbackChain: prometheusRequirement?.fallbackChain,
            systemDefaultModel: undefined,
          },
        });

        if (
          !modelResolution &&
          isFirstRunNoCache &&
          !prometheusOverride?.model &&
          !categoryConfig?.model &&
          !currentModel
        ) {
          const entry = prometheusRequirement?.fallbackChain?.[0];
          if (entry && entry.providers.length > 0) {
            modelResolution = {
              model: `${entry.providers[0]}/${entry.model}`,
              provenance: 'provider-fallback',
              variant: entry.variant,
            };
          }
        }

        const resolvedModel = modelResolution?.model;
        const resolvedVariant = modelResolution?.variant;

        const variantToUse = prometheusOverride?.variant ?? resolvedVariant;
        const reasoningEffortToUse =
          prometheusOverride?.reasoningEffort ??
          categoryConfig?.reasoningEffort;
        const textVerbosityToUse =
          prometheusOverride?.textVerbosity ?? categoryConfig?.textVerbosity;
        const thinkingToUse =
          prometheusOverride?.thinking ?? categoryConfig?.thinking;
        const temperatureToUse =
          prometheusOverride?.temperature ?? categoryConfig?.temperature;
        const topPToUse = prometheusOverride?.top_p ?? categoryConfig?.top_p;
        const maxTokensToUse =
          prometheusOverride?.maxTokens ?? categoryConfig?.maxTokens;
        const prometheusBase = {
          name: 'prometheus',
          ...(resolvedModel ? {model: resolvedModel} : {}),
          ...(variantToUse ? {variant: variantToUse} : {}),
          mode: 'all' as const,
          prompt: PROMETHEUS_SYSTEM_PROMPT,
          permission: PROMETHEUS_PERMISSION,
          description: `${configAgent?.plan?.description ?? 'Plan agent'} (Prometheus - OhMyGemini)`,
          color: (configAgent?.plan?.color as string) ?? '#9D4EDD', // Amethyst Purple - wisdom/foresight
          ...(temperatureToUse !== undefined
            ? {temperature: temperatureToUse}
            : {}),
          ...(topPToUse !== undefined ? {top_p: topPToUse} : {}),
          ...(maxTokensToUse !== undefined ? {maxTokens: maxTokensToUse} : {}),
          ...(categoryConfig?.tools ? {tools: categoryConfig.tools} : {}),
          ...(thinkingToUse ? {thinking: thinkingToUse} : {}),
          ...(reasoningEffortToUse !== undefined
            ? {reasoningEffort: reasoningEffortToUse}
            : {}),
          ...(textVerbosityToUse !== undefined
            ? {textVerbosity: textVerbosityToUse}
            : {}),
        };

        // Append prompt_append instead of shallow spread (issue #723)
        if (prometheusOverride) {
          const {prompt_append, ...restOverride} = prometheusOverride as Record<
            string,
            unknown
          > & {prompt_append?: string};
          const merged = {...prometheusBase, ...restOverride};
          if (prompt_append && merged.prompt) {
            merged.prompt = merged.prompt + '\n' + prompt_append;
          }
          agentConfig['prometheus'] = merged;
        } else {
          agentConfig['prometheus'] = prometheusBase;
        }
      }

      const filteredConfigAgents = configAgent
        ? Object.fromEntries(
            Object.entries(configAgent)
              .filter(([key]) => {
                if (key === 'build') return false;
                if (key === 'plan' && shouldDemotePlan) return false;
                // Prevent Gemini defaults from overwriting user config (issue #472)
                if (key in builtinAgents) return false;
                return true;
              })
              .map(([key, value]) => [
                key,
                value
                  ? migrateAgentConfig(value as Record<string, unknown>)
                  : value,
              ]),
          )
        : {};

      const migratedBuild = configAgent?.build
        ? migrateAgentConfig(configAgent.build as Record<string, unknown>)
        : {};

      const planDemoteConfig = shouldDemotePlan
        ? {mode: 'subagent' as const}
        : undefined;

      config.agent = {
        ...agentConfig,
        ...Object.fromEntries(
          Object.entries(builtinAgents).filter(([k]) => k !== 'sisyphus'),
        ),
        ...geminiGlobalAgents,
        ...userAgents,
        ...projectAgents,
        ...geminiProjectAgents,
        ...pluginAgents,
        ...filteredConfigAgents,
        build: {...migratedBuild, mode: 'subagent', hidden: true},
        ...(planDemoteConfig ? {plan: planDemoteConfig} : {}),
      };
    } else {
      config.agent = {
        ...builtinAgents,
        ...geminiGlobalAgents,
        ...userAgents,
        ...projectAgents,
        ...geminiProjectAgents,
        ...pluginAgents,
        ...configAgent,
      };
    }

    if (config.agent) {
      config.agent = reorderAgentsByPriority(
        config.agent as Record<string, unknown>,
      );
    }

    const agentResult = config.agent as AgentConfig;

    config.tools = {
      ...(config.tools as Record<string, unknown>),
      'grep_app_*': false,
      LspHover: false,
      LspCodeActions: false,
      LspCodeActionResolve: false,
      'task_*': false,
      teammate: false,
      parallel_exec: true,
      ...(pluginConfig.experimental?.task_system
        ? {todowrite: false, todoread: false}
        : {}),
    };

    type AgentWithPermission = {permission?: Record<string, unknown>};

    // In CLI run mode, deny Question tool for all agents (no TUI to answer questions)
    const isCliRunMode = process.env.GEMINI_CLI_RUN_MODE === 'true';
    const questionPermission = isCliRunMode ? 'deny' : 'allow';

    if (agentResult.librarian) {
      const agent = agentResult.librarian as AgentWithPermission;
      agent.permission = {...agent.permission, 'grep_app_*': 'allow'};
    }
    if (agentResult['multimodal-looker']) {
      const agent = agentResult['multimodal-looker'] as AgentWithPermission;
      agent.permission = {...agent.permission, task: 'deny', look_at: 'deny'};
    }
    if (agentResult['atlas']) {
      const agent = agentResult['atlas'] as AgentWithPermission;
      agent.permission = {
        ...agent.permission,
        task: 'deny',
        call_subagent: 'deny',
        delegate_task: 'allow',
        parallel_exec: 'allow',
        'task_*': 'allow',
        teammate: 'allow',
      };
    }
    if (agentResult.sisyphus) {
      const agent = agentResult.sisyphus as AgentWithPermission;
      agent.permission = {
        ...agent.permission,
        call_subagent: 'deny',
        delegate_task: 'allow',
        parallel_exec: 'allow',
        question: questionPermission,
        'task_*': 'allow',
        teammate: 'allow',
      };
    }
    if (agentResult.hephaestus) {
      const agent = agentResult.hephaestus as AgentWithPermission;
      agent.permission = {
        ...agent.permission,
        call_subagent: 'deny',
        delegate_task: 'allow',
        parallel_exec: 'allow',
        question: questionPermission,
      };
    }
    if (agentResult['prometheus']) {
      const agent = agentResult['prometheus'] as AgentWithPermission;
      agent.permission = {
        ...agent.permission,
        call_subagent: 'deny',
        delegate_task: 'allow',
        parallel_exec: 'allow',
        question: questionPermission,
        'task_*': 'allow',
        teammate: 'allow',
      };
    }
    if (agentResult['sisyphus-junior']) {
      const agent = agentResult['sisyphus-junior'] as AgentWithPermission;
      agent.permission = {
        ...agent.permission,
        delegate_task: 'allow',
        parallel_exec: 'deny',
        'task_*': 'allow',
        teammate: 'allow',
      };
    }

    config.permission = {
      ...(config.permission as Record<string, unknown>),
      webfetch: 'allow',
      external_directory: 'allow',
      delegate_task: 'deny',
      parallel_exec: 'ask',
    };

    const mcpResult =
      pluginConfig.claude_code?.mcp ?? true
        ? await getMcpConfigs()
        : {servers: {}};

    config.mcp = {
      ...createBuiltinMcps(pluginConfig.disabled_mcps, pluginConfig.websearch),
      ...(config.mcp as Record<string, unknown>),
      ...mcpResult.servers,
      ...pluginComponents.mcpServers,
    };

    const builtinCommands = getBuiltinCommands(pluginConfig.disabled_commands);
    const systemCommands = (config.command as Record<string, unknown>) ?? {};

    const includeClaudeCommands = pluginConfig.claude_code?.commands ?? true;
    const includeClaudeSkills = pluginConfig.claude_code?.skills ?? true;

    const [
      extensionCommands,
      userCommands,
      projectCommands,
      geminiGlobalCommands,
      geminiProjectCommands,
      userSkills,
      projectSkills,
      geminiGlobalSkills,
      geminiProjectSkills,
    ] = await Promise.all([
      getExtensionCommands(),
      includeClaudeCommands ? getUserCommands() : Promise.resolve({}),
      includeClaudeCommands ? getProjectCommands() : Promise.resolve({}),
      getGeminiGlobalCommands(),
      getGeminiProjectCommands(),
      includeClaudeSkills ? getUserSkills() : Promise.resolve({}),
      includeClaudeSkills ? getProjectSkills() : Promise.resolve({}),
      getGeminiGlobalSkills(),
      getGeminiProjectSkills(),
    ]);

    config.command = {
      ...extensionCommands,
      ...builtinCommands,
      ...userCommands,
      ...userSkills,
      ...geminiGlobalCommands,
      ...geminiGlobalSkills,
      ...systemCommands,
      ...projectCommands,
      ...projectSkills,
      ...geminiProjectCommands,
      ...geminiProjectSkills,
      ...pluginComponents.commands,
      ...pluginComponents.skills,
    };
  };
}

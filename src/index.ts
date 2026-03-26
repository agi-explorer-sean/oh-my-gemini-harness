import type {Plugin, PluginInput} from '@opencode-ai/plugin';
import type {ToolDefinition} from '@opencode-ai/plugin/tool';
import {createBuiltinAgents} from './agents';
import {type HookName} from './config';
import {BackgroundManager} from './features/background-agent';
import {clearBoulderState} from './features/boulder-state';
import {createBuiltinSkills} from './features/builtin-skills';
import {getSystemMcpServerNames} from './features/claude-code-mcp-loader';
import {
  clearSessionAgent,
  getMainSessionID,
  getSessionAgent,
  setMainSession,
  setSessionAgent,
  subagentSessions,
  updateSessionAgent,
} from './features/claude-code-session-state';
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from './features/context-injector';
import {
  discoverGeminiGlobalSkills,
  discoverGeminiProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
  mergeSkills,
} from './features/gemini-skill-loader';
import {SkillMcpManager} from './features/skill-mcp-manager';
import {initTaskToastManager} from './features/task-toast-manager';
import {
  createAgentUsageReminderHook,
  createAnthropicContextWindowLimitRecoveryHook,
  createAtlasHook,
  createAutoSlashCommandHook,
  createAutoUpdateCheckerHook,
  createBackgroundNotificationHook,
  createCategorySkillReminderHook,
  createClaudeCodeHooksHook,
  createCommentCheckerHooks,
  createCompactionContextInjector,
  createContextWindowMonitorHook,
  createDelegateTaskRetryHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEditErrorRecoveryHook,
  createEmptyTaskResponseDetectorHook,
  createKeywordDetectorHook,
  createNonInteractiveEnvHook,
  createPreemptiveCompactionHook,
  createProactiveEditFixerHook,
  createPrometheusMdOnlyHook,
  createQuestionLabelTruncatorHook,
  createRalphLoopHook,
  createRulesInjectorHook,
  createSessionNotification,
  createSessionRecoveryHook,
  createSisyphusJuniorNotepadHook,
  createStartWorkHook,
  createStopContinuationGuardHook,
  createTaskResumeInfoHook,
  createTasksTodowriteDisablerHook,
  createThinkingBlockValidatorHook,
  createThinkModeHook,
  createTodoContinuationEnforcer,
  createToolOutputTruncatorHook,
  createUnstableAgentBabysitterHook,
  parseRalphLoopArgs,
} from './hooks';
import {createBuiltinMcps} from './mcp';
import {getPluginConfig} from './plugin-config';
import {createConfigHandler} from './plugin-handlers';
import {createModelCacheState} from './plugin-state';
import {
  detectExternalNotificationPlugin,
  GEMINI_NATIVE_AGENTS_INJECTION_VERSION,
  getGeminiVersion,
  getNotificationConflictWarning,
  hasConnectedProvidersCache,
  isGeminiVersionAtLeast,
  isServerRunning,
  log,
  resetMessageCursor,
} from './shared';
import {getAgentDisplayName} from './shared/agent-display-names';
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from './shared/agent-variant';
import {createFirstMessageVariantGate} from './shared/first-message-variant';
import {isSystemDirective} from './shared/system-directive';
import {
  builtinTools,
  createBackgroundTools,
  createCallSubagent,
  createDelegateTask,
  createLookAt,
  createParallelExecTool,
  createWorkerGetTaskTool,
  createWorkerReportResultTool,
  isWorkerMode,
  createParallelStatusTool,
  createSkillMcpTool,
  createSkillTool,
  createSlashcommandTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  discoverCommandsSync,
  lspManager,
  sessionExists,
} from './tools';

// Patterns that suggest the user wants to use other extension tools directly
const SKIP_AGENT_PATTERNS = [
  /\b@workspace\b/i,
  /\bworkspace\s+(search|find|open|list)\b/i,
  /\buse\s+workspace\b/i,
];

function shouldSkipAgentInjection(text: string): boolean {
  return SKIP_AGENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Extended plugin context with fields added by dispatch and MCP modes */
interface ExtendedPluginContext extends PluginInput {
  isDispatch?: boolean;
  isMcpMode?: boolean;
}

export const OhMyGeminiPlugin: Plugin = async (rawCtx) => {
  const ctx = rawCtx as ExtendedPluginContext;
  log('[OhMyGeminiPlugin] ENTRY - plugin loading', {
    directory: ctx.directory,
    serverUrl: ctx.serverUrl,
  });

  const isDispatch = ctx.isDispatch;
  const serverUrlStr = ctx.serverUrl?.toString();
  // Use a much shorter timeout in dispatch mode to avoid hanging tool execution
  const serverRunning = serverUrlStr
    ? await isServerRunning(serverUrlStr, isDispatch ? 500 : 3000)
    : false;
  if (serverUrlStr && !serverRunning) {
    log(
      '[OhMyGeminiPlugin] No opencode server at ' +
        serverUrlStr +
        '. Background agents will use subprocess mode (gemini -- -y -p).',
    );
  }
  log('[OhMyGeminiPlugin] ctx keys:', Object.keys(ctx).join(', '));
  const clientObj = ctx.client as unknown as Record<string, unknown>;
  log('[OhMyGeminiPlugin] Client keys:', Object.keys(clientObj).join(', '));
  if (clientObj.config) {
    log('[OhMyGeminiPlugin] Client config:', JSON.stringify(clientObj.config));
  }
  const pluginConfig = getPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();

  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  /**
   * Lazy hook initialization: delays construction until first property access.
   * Saves startup time for hooks that may never be triggered in a session.
   */
  function lazyHook<T extends object>(factory: () => T): T {
    let instance: T | null = null;
    return new Proxy({} as T, {
      get(_, prop) {
        instance ??= factory();
        return (instance as Record<string | symbol, unknown>)[prop];
      },
    });
  }

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled('context-window-monitor')
    ? createContextWindowMonitorHook(ctx)
    : null;
  const preemptiveCompaction =
    isHookEnabled('preemptive-compaction') &&
    pluginConfig.experimental?.preemptive_compaction
      ? createPreemptiveCompactionHook(ctx, pluginConfig as any)
      : null;
  const sessionRecovery = isHookEnabled('session-recovery')
    ? createSessionRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;

  let sessionNotification = null;
  if (isHookEnabled('session-notification')) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false;
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory);

    if (externalNotifier.detected && !forceEnable) {
      log(getNotificationConflictWarning(externalNotifier.pluginName!));
      log('session-notification disabled due to external notifier conflict', {
        detected: externalNotifier.pluginName,
        allPlugins: externalNotifier.allPlugins,
      });
    } else {
      sessionNotification = createSessionNotification(ctx);
    }
  }

  const commentChecker = isHookEnabled('comment-checker')
    ? createCommentCheckerHooks(pluginConfig.comment_checker)
    : null;
  const toolOutputTruncator = isHookEnabled('tool-output-truncator')
    ? createToolOutputTruncatorHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  let directoryAgentsInjector = null;
  if (isHookEnabled('directory-agents-injector')) {
    const currentVersion = getGeminiVersion();
    const hasNativeSupport =
      currentVersion !== null &&
      isGeminiVersionAtLeast(GEMINI_NATIVE_AGENTS_INJECTION_VERSION);

    if (hasNativeSupport) {
      log(
        'directory-agents-injector auto-disabled due to native Gemini support',
        {
          currentVersion,
          nativeVersion: GEMINI_NATIVE_AGENTS_INJECTION_VERSION,
        },
      );
    } else {
      directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
    }
  }
  const directoryReadmeInjector = isHookEnabled('directory-readme-injector')
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled(
    'empty-task-response-detector',
  )
    ? lazyHook(() => createEmptyTaskResponseDetectorHook(ctx))
    : null;
  const thinkMode = isHookEnabled('think-mode')
    ? lazyHook(() => createThinkModeHook())
    : null;
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks: pluginConfig.claude_code?.hooks ?? true ? undefined : true,
      keywordDetectorDisabled: !isHookEnabled('keyword-detector'),
    },
    contextCollector,
  );
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    'anthropic-context-window-limit-recovery',
  )
    ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  const rulesInjector = isHookEnabled('rules-injector')
    ? createRulesInjectorHook(ctx)
    : null;
  const keywordDetector = isHookEnabled('keyword-detector')
    ? createKeywordDetectorHook(ctx, contextCollector)
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);
  const agentUsageReminder = isHookEnabled('agent-usage-reminder')
    ? createAgentUsageReminderHook(ctx)
    : null;
  const nonInteractiveEnv = isHookEnabled('non-interactive-env')
    ? createNonInteractiveEnvHook(ctx)
    : null;
  const thinkingBlockValidator = isHookEnabled('thinking-block-validator')
    ? createThinkingBlockValidatorHook()
    : null;

  const categorySkillReminder = isHookEnabled('category-skill-reminder')
    ? createCategorySkillReminderHook(ctx)
    : null;

  const editErrorRecovery = isHookEnabled('edit-error-recovery')
    ? lazyHook(() => createEditErrorRecoveryHook(ctx))
    : null;

  const proactiveEditFixer = isHookEnabled('proactive-edit-fixer')
    ? lazyHook(() => createProactiveEditFixerHook(ctx))
    : null;

  const delegateTaskRetry = isHookEnabled('delegate-task-retry')
    ? createDelegateTaskRetryHook(ctx)
    : null;

  const startWork = isHookEnabled('start-work')
    ? createStartWorkHook(ctx)
    : null;

  const prometheusMdOnly = isHookEnabled('prometheus-md-only')
    ? lazyHook(() => createPrometheusMdOnlyHook(ctx))
    : null;

  const sisyphusJuniorNotepad = isHookEnabled('sisyphus-junior-notepad')
    ? lazyHook(() => createSisyphusJuniorNotepadHook(ctx))
    : null;

  const tasksTodowriteDisabler = isHookEnabled('tasks-todowrite-disabler')
    ? createTasksTodowriteDisablerHook({
        experimental: pluginConfig.experimental,
      })
    : null;

  const questionLabelTruncator = createQuestionLabelTruncatorHook();

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(
    ctx,
    pluginConfig.background_task,
    {serverRunning},
  );

  const ralphLoop = isHookEnabled('ralph-loop')
    ? createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
      })
    : null;

  const atlasHook = isHookEnabled('atlas')
    ? createAtlasHook(ctx, {directory: ctx.directory, backgroundManager})
    : null;

  const autoUpdateChecker =
    isHookEnabled('auto-update-checker') && !ctx.isDispatch
      ? createAutoUpdateCheckerHook(ctx, {
          showStartupToast: isHookEnabled('startup-toast'),
          isSisyphusEnabled: sisyphusJuniorNotepad !== null,
          autoUpdate: pluginConfig.notification?.auto_update ?? true,
        })
      : null;

  initTaskToastManager(ctx.client);

  const stopContinuationGuard = isHookEnabled('stop-continuation-guard')
    ? createStopContinuationGuardHook(ctx)
    : null;

  const compactionContextInjector = isHookEnabled('compaction-context-injector')
    ? createCompactionContextInjector({
        ctx,
        backgroundManager: backgroundManager as any,
      })
    : null;

  const todoContinuationEnforcer = isHookEnabled('todo-continuation-enforcer')
    ? createTodoContinuationEnforcer(ctx, {
        backgroundManager: backgroundManager as any,
        isContinuationStopped: stopContinuationGuard?.isStopped,
      })
    : null;

  const unstableAgentBabysitter = isHookEnabled('unstable-agent-babysitter')
    ? createUnstableAgentBabysitterHook(
        {
          directory: ctx.directory,
          client: {
            session: {
              messages: async (args) => {
                const result = await ctx.client.session.messages(args);
                if (Array.isArray(result)) return result;
                if (
                  typeof result === 'object' &&
                  result !== null &&
                  'data' in result
                ) {
                  const record = result as Record<string, unknown>;
                  return {data: record.data};
                }
                return [];
              },
              prompt: async (args) => {
                await ctx.client.session.prompt(args);
              },
            },
          },
        },
        {
          backgroundManager: backgroundManager as any,
          config: pluginConfig.babysitting,
        },
      )
    : null;

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete,
    );
  }

  const backgroundNotificationHook = isHookEnabled('background-notification')
    ? createBackgroundNotificationHook(backgroundManager as any)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallSubagent(ctx, backgroundManager);
  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === 'multimodal-looker',
  );
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null;
  const browserProvider =
    pluginConfig.browser_automation_engine?.provider ?? 'playwright';
  const isMcpMode = !!ctx.isMcpMode;
  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.['sisyphus-junior']?.model,
    browserProvider,
    isMcpMode,
  });
  const parallelExec = createParallelExecTool({
    manager: backgroundManager,
    directory: ctx.directory,
    client: ctx.client,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.['sisyphus-junior']?.model,
    browserProvider,
  });
  const parallelStatus = createParallelStatusTool({
    manager: backgroundManager,
  });
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills({browserProvider}).filter(
    (skill) => {
      if (disabledSkills.has(skill.name as never)) return false;
      if (skill.mcpConfig) {
        for (const mcpName of Object.keys(skill.mcpConfig)) {
          if (systemMcpNames.has(mcpName)) return false;
        }
      }
      return true;
    },
  );
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;

  let _mergedSkills: any[] | null = null;
  const getMergedSkills = async () => {
    if (_mergedSkills) return _mergedSkills;
    const [userSkills, globalSkills, projectSkills, geminiProjectSkills] =
      await Promise.all([
        includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
        discoverGeminiGlobalSkills(),
        includeClaudeSkills
          ? discoverProjectClaudeSkills()
          : Promise.resolve([]),
        discoverGeminiProjectSkills(),
      ]);
    _mergedSkills = mergeSkills(
      builtinSkills,
      pluginConfig.skills,
      userSkills,
      globalSkills,
      projectSkills,
      geminiProjectSkills,
    );
    return _mergedSkills;
  };

  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || '';

  const skillTool = createSkillTool({
    getSkills: getMergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
  } as any);

  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: getMergedSkills,
    getSessionID: getSessionIDForMcp,
  } as any);

  const slashcommandTool = createSlashcommandTool({
    getSkills: getMergedSkills,
  } as any);

  const autoSlashCommand = isHookEnabled('auto-slash-command')
    ? createAutoSlashCommandHook({getSkills: getMergedSkills} as any)
    : null;

  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? false;

  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx),
      }
    : {};

  const tools: Record<string, ToolDefinition> = {
    ...builtinTools,
    ...backgroundTools,
    call_subagent: callOmoAgent,
    ...(lookAt ? {look_at: lookAt} : {}),
    delegate_task: delegateTask,
    parallel_exec: parallelExec,
    parallel_status: parallelStatus,
    ...(isWorkerMode()
      ? {
          worker_get_task: createWorkerGetTaskTool(),
          worker_report_result: createWorkerReportResultTool(),
        }
      : {}),
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    ...taskToolsRecord,
  };

  log('[index] Tools registered', {
    count: Object.keys(tools).length,
    names: Object.keys(tools),
  });

  const configHandler = createConfigHandler({
    ctx: {directory: ctx.directory, client: ctx.client},
    pluginConfig,
    modelCacheState,
    availableToolNames: Object.keys(tools),
  });

  const builtinMcps = createBuiltinMcps(
    pluginConfig.disabled_mcps ?? [],
    pluginConfig.websearch,
  );

  let providerCacheWarningShown = false;

  // Build event dispatch table once at init time for O(1) routing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EventHandler = (input: any) => void | Promise<void>;
  const allEventHandlers: EventHandler[] = [
    ...(backgroundNotificationHook
      ? [(i: any) => backgroundNotificationHook.event(i)]
      : []),
    ...(todoContinuationEnforcer
      ? [(i: any) => todoContinuationEnforcer.handler(i)]
      : []),
    ...(unstableAgentBabysitter
      ? [(i: any) => unstableAgentBabysitter.event(i)]
      : []),
    ...(contextWindowMonitor
      ? [(i: any) => contextWindowMonitor.event(i)]
      : []),
    ...(directoryAgentsInjector
      ? [(i: any) => directoryAgentsInjector.event(i)]
      : []),
    ...(directoryReadmeInjector
      ? [(i: any) => directoryReadmeInjector.event(i)]
      : []),
    ...(rulesInjector ? [(i: any) => rulesInjector.event(i)] : []),
    ...(thinkMode ? [(i: any) => thinkMode.event(i)] : []),
    ...(anthropicContextWindowLimitRecovery
      ? [(i: any) => anthropicContextWindowLimitRecovery.event(i)]
      : []),
    ...(agentUsageReminder ? [(i: any) => agentUsageReminder.event(i)] : []),
    ...(categorySkillReminder
      ? [(i: any) => categorySkillReminder.event(i)]
      : []),
    ...(stopContinuationGuard
      ? [(i: any) => stopContinuationGuard.event(i)]
      : []),
    ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ...(autoUpdateChecker ? [(i: any) => autoUpdateChecker.event(i)] : []),
  ];
  const eventRoutes: Record<string, EventHandler[]> = {
    'session.idle': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(unstableAgentBabysitter
        ? [(i: any) => unstableAgentBabysitter.event(i)]
        : []),
      ...(anthropicContextWindowLimitRecovery
        ? [(i: any) => anthropicContextWindowLimitRecovery.event(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
      ...(autoUpdateChecker ? [(i: any) => autoUpdateChecker.event(i)] : []),
    ],
    'session.error': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(unstableAgentBabysitter
        ? [(i: any) => unstableAgentBabysitter.event(i)]
        : []),
      ...(anthropicContextWindowLimitRecovery
        ? [(i: any) => anthropicContextWindowLimitRecovery.event(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
    'session.created': [
      ...(autoUpdateChecker ? [(i: any) => autoUpdateChecker.event(i)] : []),
    ],
    'session.deleted': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(contextWindowMonitor
        ? [(i: any) => contextWindowMonitor.event(i)]
        : []),
      ...(directoryAgentsInjector
        ? [(i: any) => directoryAgentsInjector.event(i)]
        : []),
      ...(directoryReadmeInjector
        ? [(i: any) => directoryReadmeInjector.event(i)]
        : []),
      ...(rulesInjector ? [(i: any) => rulesInjector.event(i)] : []),
      ...(thinkMode ? [(i: any) => thinkMode.event(i)] : []),
      ...(anthropicContextWindowLimitRecovery
        ? [(i: any) => anthropicContextWindowLimitRecovery.event(i)]
        : []),
      ...(agentUsageReminder ? [(i: any) => agentUsageReminder.event(i)] : []),
      ...(categorySkillReminder
        ? [(i: any) => categorySkillReminder.event(i)]
        : []),
      ...(stopContinuationGuard
        ? [(i: any) => stopContinuationGuard.event(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
    'session.compacted': [
      ...(directoryAgentsInjector
        ? [(i: any) => directoryAgentsInjector.event(i)]
        : []),
      ...(directoryReadmeInjector
        ? [(i: any) => directoryReadmeInjector.event(i)]
        : []),
      ...(rulesInjector ? [(i: any) => rulesInjector.event(i)] : []),
      ...(agentUsageReminder ? [(i: any) => agentUsageReminder.event(i)] : []),
      ...(categorySkillReminder
        ? [(i: any) => categorySkillReminder.event(i)]
        : []),
    ],
    'message.updated': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(anthropicContextWindowLimitRecovery
        ? [(i: any) => anthropicContextWindowLimitRecovery.event(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
    'message.part.updated': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
    'tool.execute.before': [
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
    'tool.execute.after': [
      ...(backgroundNotificationHook
        ? [(i: any) => backgroundNotificationHook.event(i)]
        : []),
      ...(todoContinuationEnforcer
        ? [(i: any) => todoContinuationEnforcer.handler(i)]
        : []),
      ...(atlasHook ? [(i: any) => atlasHook.handler(i)] : []),
    ],
  };

  let _cachedAgents: Record<string, any> | null = null;
  const getAgents = async () => {
    if (_cachedAgents) return _cachedAgents;
    const mergedSkills = await getMergedSkills();
    _cachedAgents = await createBuiltinAgents(
      pluginConfig.disabled_agents ?? [],
      pluginConfig.agents ?? {},
      ctx.directory,
      undefined,
      pluginConfig.categories,
      pluginConfig.git_master,
      mergedSkills,
      undefined, // client - avoid deadlock
      browserProvider,
      undefined, // currentModel
      Object.keys(tools),
    );
    return _cachedAgents;
  };

  // Track the current agent set via @agent syntax in chat.message.
  // Used by tool.execute.before to block self-delegation in call_subagent.
  // Module-level variable is more reliable than session ID lookups because
  // the Gemini CLI's LocalAgentExecutor may use different session IDs
  // internally than what oh-my-gemini's session tracking knows about.
  let currentChatAgent: string | undefined;

  return {
    get agent() {
      return getAgents();
    },
    tool: tools,
    tools: tools,

    mcp: builtinMcps,

    'chat.message': async (input, output) => {
      if (input.agent) {
        currentChatAgent = input.agent;
        const prevAgent = getSessionAgent(input.sessionID);
        setSessionAgent(input.sessionID, input.agent);
        if (prevAgent === undefined && !subagentSessions.has(input.sessionID)) {
          const displayName = getAgentDisplayName(input.agent);
          ctx.client.tui
            .showToast({
              body: {
                title: `Agent: ${displayName}`,
                message: `Session started with ${displayName}`,
                variant: 'info' as const,
                duration: 4000,
              },
            })
            .catch(() => {});
        }
      }

      // Inject default agent routing when no @agent is specified.
      // The Gemini CLI ignores config.default_agent, so we mimic the
      // @agent behaviour by appending a <system_note> to the message parts.
      // Falls back to 'sisyphus' when sisyphus is enabled and no explicit
      // default_agent is configured.
      const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;
      const effectiveDefaultAgent =
        pluginConfig.default_agent ??
        (isSisyphusEnabled ? 'sisyphus' : undefined);
      if (
        !input.agent &&
        !subagentSessions.has(input.sessionID) &&
        effectiveDefaultAgent
      ) {
        const defaultAgent = effectiveDefaultAgent;
        const parts = (output as {parts?: Array<{type: string; text?: string}>})
          .parts;
        if (parts) {
          const promptText = parts
            .filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text)
            .join('\n')
            .trim();
          // Skip injection for system directives (e.g. ralph-loop, todo continuation)
          // and messages that suggest the user wants other-extension tools
          if (
            promptText &&
            !isSystemDirective(promptText) &&
            !shouldSkipAgentInjection(promptText)
          ) {
            // Append to the last text part rather than pushing a new one,
            // because the native dispatch handler only checks parts[0].text
            // for changes and ignores additional parts.
            const lastTextPart = [...parts]
              .reverse()
              .find((p) => p.type === 'text' && p.text);
            const agentNote = `\n<agent-routing>
The default agent "${defaultAgent}" is available for software engineering tasks (coding, debugging, refactoring, architecture, research, file operations, git, testing).

For software engineering tasks: delegate to ${defaultAgent} using call_subagent.
For tasks involving other extension tools (workspace, etc.) or simple questions: respond directly without delegation.
Use your judgment based on what the user is asking for.
</agent-routing>`;
            if (lastTextPart) {
              lastTextPart.text = (lastTextPart.text ?? '') + agentNote;
            } else {
              parts.push({type: 'text', text: agentNote});
            }
            log('[chat.message] Injected default agent routing', {
              agent: defaultAgent,
              sessionID: input.sessionID,
            });
          }
        }
      }

      const message = (output as {message: {variant?: string}}).message;
      if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
        const variant =
          input.model && input.agent
            ? resolveVariantForModel(pluginConfig, input.agent, input.model)
            : resolveAgentVariant(pluginConfig, input.agent);
        if (variant !== undefined) {
          message.variant = variant;
        }
        firstMessageVariantGate.markApplied(input.sessionID);
      } else {
        if (input.model && input.agent && message.variant === undefined) {
          const variant = resolveVariantForModel(
            pluginConfig,
            input.agent,
            input.model,
          );
          if (variant !== undefined) {
            message.variant = variant;
          }
        } else {
          applyAgentVariant(pluginConfig, input.agent, message);
        }
      }

      await stopContinuationGuard?.['chat.message']?.(input);
      await keywordDetector?.['chat.message']?.(input, output);
      await claudeCodeHooks['chat.message']?.(input, output);
      await autoSlashCommand?.['chat.message']?.(input, output);
      await startWork?.['chat.message']?.(input, output);

      if (!hasConnectedProvidersCache() && !providerCacheWarningShown) {
        providerCacheWarningShown = true;
        ctx.client.tui
          .showToast({
            body: {
              title: '⚠️ Provider Cache Missing',
              message:
                'Model filtering disabled. RESTART Gemini to enable full functionality.',
              variant: 'warning' as const,
              duration: 6000,
            },
          })
          .catch(() => {});
      }

      if (ralphLoop) {
        const parts = (output as {parts?: Array<{type: string; text?: string}>})
          .parts;
        const promptText =
          parts
            ?.filter((p) => p.type === 'text' && p.text)
            .map((p) => p.text)
            .join('\n')
            .trim() || '';

        const isRalphLoopTemplate =
          promptText.includes('You are starting a Ralph Loop') &&
          promptText.includes('<user-task>');
        const isCancelRalphTemplate = promptText.includes(
          'Cancel the currently active Ralph Loop',
        );

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(
            /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i,
          );
          const rawTask = taskMatch?.[1]?.trim() || '';
          const parsed = parseRalphLoopArgs(rawTask);

          log('[ralph-loop] Starting loop from chat.message', {
            sessionID: input.sessionID,
            prompt: parsed.prompt,
          });
          ralphLoop.startLoop(input.sessionID, parsed.prompt, {
            maxIterations: parsed.maxIterations,
            minIterations: parsed.minIterations,
            completionPromise: parsed.completionPromise,
          });
        } else if (isCancelRalphTemplate) {
          log('[ralph-loop] Cancelling loop from chat.message', {
            sessionID: input.sessionID,
          });
          ralphLoop.cancelLoop(input.sessionID);
        }
      }
    },

    'experimental.chat.messages.transform': async (
      input: Record<string, never>,
      output: {messages: Array<{info: unknown; parts: unknown[]}>},
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await contextInjectorMessagesTransform?.[
        'experimental.chat.messages.transform'
      ]?.(input, output as any);
      await thinkingBlockValidator?.[
        'experimental.chat.messages.transform'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);
    },

    config: configHandler,

    event: async (input) => {
      // Universal handlers (respond to all event types)
      await claudeCodeHooks.event(input);
      await sessionNotification?.(input);

      // Type-specific routing via pre-built dispatch table
      const handlers = eventRoutes[input.event.type];
      if (handlers) {
        for (const h of handlers) await h(input);
      } else {
        // Fallback: for unknown event types, call all handlers
        for (const h of allEventHandlers) await h(input);
      }

      const {event} = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === 'session.created') {
        const sessionInfo = props?.info as
          | {id?: string; title?: string; parentID?: string}
          | undefined;
        log('[event] session.created', {sessionInfo, props});
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
        firstMessageVariantGate.markSessionCreated(sessionInfo);
      }

      if (event.type === 'session.deleted') {
        const sessionInfo = props?.info as {id?: string} | undefined;
        const isMainSession = sessionInfo?.id === getMainSessionID();

        if (isMainSession) {
          log('[index] Main session deleted, triggering full shutdown');
          setMainSession(undefined);
        }

        if (sessionInfo?.id) {
          clearSessionAgent(sessionInfo.id);
          resetMessageCursor(sessionInfo.id);
          firstMessageVariantGate.clear(sessionInfo.id);
          await skillMcpManager.disconnectSession(sessionInfo.id);
          await lspManager.cleanupTempDirectoryClients();
        }

        if (isMainSession) {
          await skillMcpManager.shutdown();
          await lspManager.stopAll().catch(() => {});
          await backgroundManager.shutdown();
        }
      }

      if (event.type === 'message.updated') {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;
        const agent = info?.agent as string | undefined;
        const role = info?.role as string | undefined;
        if (sessionID && agent && role === 'user') {
          const prevAgent = getSessionAgent(sessionID);
          updateSessionAgent(sessionID, agent);
          if (
            prevAgent !== undefined &&
            prevAgent !== agent &&
            !subagentSessions.has(sessionID)
          ) {
            const displayName = getAgentDisplayName(agent);
            ctx.client.tui
              .showToast({
                body: {
                  title: `Agent: ${displayName}`,
                  message: `Switched from ${getAgentDisplayName(prevAgent)}`,
                  variant: 'info' as const,
                  duration: 4000,
                },
              })
              .catch(() => {});
          }
        }
      }

      if (event.type === 'session.error') {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (sessionRecovery?.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: 'assistant' as const,
            sessionID,
            error,
          };
          const recovered =
            await sessionRecovery.handleSessionRecovery(messageInfo);

          if (
            recovered &&
            sessionID &&
            sessionID === getMainSessionID() &&
            !stopContinuationGuard?.isStopped(sessionID)
          ) {
            await ctx.client.session
              .prompt({
                path: {id: sessionID},
                body: {parts: [{type: 'text', text: 'continue'}]},
                query: {directory: ctx.directory},
              })
              .catch(() => {});
          }
        }
      }
    },

    'tool.execute.before': async (input, output) => {
      await questionLabelTruncator['tool.execute.before']?.(input, output);
      await claudeCodeHooks['tool.execute.before'](input, output);
      await nonInteractiveEnv?.['tool.execute.before'](input, output);
      await commentChecker?.['tool.execute.before']?.(input, output);
      await directoryAgentsInjector?.['tool.execute.before']?.(input, output);
      await directoryReadmeInjector?.['tool.execute.before']?.(input, output);
      await rulesInjector?.['tool.execute.before']?.(input, output);
      await tasksTodowriteDisabler?.['tool.execute.before']?.(input, output);
      await prometheusMdOnly?.['tool.execute.before']?.(input, output);
      await sisyphusJuniorNotepad?.['tool.execute.before']?.(input, output);
      await proactiveEditFixer?.['tool.execute.before']?.(input, output);
      await atlasHook?.['tool.execute.before']?.(input, output);

      if (input.tool === 'task') {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = ['explore', 'librarian'].some(
          (name) => name.toLowerCase() === (subagentType ?? '').toLowerCase(),
        );

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
          ...(isExploreOrLibrarian ? {call_subagent: false} : {}),
        };
      }

      // Block self-delegation: prevent agents from calling call_subagent
      // or delegate_task to spawn themselves. The currentChatAgent variable
      // is set in chat.message when @agent syntax is used.
      // NOTE: This only works in native plugin mode. In MCP mode, the guard
      // is in the tool execute() functions using OMG_PARENT_AGENT env var.
      if (
        (input.tool === 'call_subagent' || input.tool === 'delegate_task') &&
        currentChatAgent
      ) {
        const args = output.args as Record<string, unknown>;
        const targetAgent = (
          (args.subagent_type as string) ||
          (args.agent as string) ||
          ''
        ).toLowerCase();
        if (targetAgent === currentChatAgent.toLowerCase()) {
          log(
            `[tool.execute.before] Blocked self-delegation: ${currentChatAgent} tried to call ${input.tool} targeting itself`,
          );
          (output as {result?: string}).result =
            `You are already running as the ${currentChatAgent} agent. Use your available tools directly (web_search, web_fetch, grep_search, read_file, etc.) instead of delegating to yourself.`;
        }
      }

      if (ralphLoop && input.tool === 'slashcommand') {
        const args = output.args as {command?: string} | undefined;
        const command = args?.command?.replace(/^\//, '').toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === 'ralph-loop' && sessionID) {
          const rawArgs =
            args?.command?.replace(/^\/?(ralph-loop)\s*/i, '') || '';
          const parsed = parseRalphLoopArgs(rawArgs);
          ralphLoop.startLoop(sessionID, parsed.prompt, {
            maxIterations: parsed.maxIterations,
            minIterations: parsed.minIterations,
            completionPromise: parsed.completionPromise,
          });
        } else if (command === 'cancel-ralph' && sessionID) {
          ralphLoop.cancelLoop(sessionID);
        } else if (command === 'ulw-loop' && sessionID) {
          const rawArgs =
            args?.command?.replace(/^\/?(ulw-loop)\s*/i, '') || '';
          const parsed = parseRalphLoopArgs(rawArgs, {ultrawork: true});
          ralphLoop.startLoop(sessionID, parsed.prompt, {
            ultrawork: true,
            maxIterations: parsed.maxIterations,
            minIterations: parsed.minIterations,
            completionPromise: parsed.completionPromise,
          });
        }
      }

      if (input.tool === 'slashcommand') {
        const args = output.args as {command?: string} | undefined;
        const command = args?.command?.replace(/^\//, '').toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === 'stop-continuation' && sessionID) {
          stopContinuationGuard?.stop(sessionID);
          todoContinuationEnforcer?.cancelAllCountdowns();
          ralphLoop?.cancelLoop(sessionID);
          clearBoulderState(ctx.directory);
          log('[stop-continuation] All continuation mechanisms stopped', {
            sessionID,
          });
        }
      }
    },

    'tool.execute.after': async (input, output) => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return;
      }
      await claudeCodeHooks['tool.execute.after'](input, output);
      await toolOutputTruncator?.['tool.execute.after'](input, output);
      await preemptiveCompaction?.['tool.execute.after'](input, output);
      await contextWindowMonitor?.['tool.execute.after'](input, output);
      await commentChecker?.['tool.execute.after'](input, output);
      await directoryAgentsInjector?.['tool.execute.after'](input, output);
      await directoryReadmeInjector?.['tool.execute.after'](input, output);
      await rulesInjector?.['tool.execute.after'](input, output);
      await emptyTaskResponseDetector?.['tool.execute.after'](input, output);
      await agentUsageReminder?.['tool.execute.after'](input, output);
      await categorySkillReminder?.['tool.execute.after'](input, output);
      await editErrorRecovery?.['tool.execute.after'](input, output);
      await delegateTaskRetry?.['tool.execute.after'](input, output);
      await atlasHook?.['tool.execute.after']?.(input, output);
      await taskResumeInfo['tool.execute.after'](input, output);
    },

    'experimental.session.compacting': async (input: {sessionID: string}) => {
      if (!compactionContextInjector) {
        return;
      }
      await compactionContextInjector.event({
        event: {
          type: 'session.compacted',
          properties: { sessionID: input.sessionID }
        }
      });
    },
  };
};

export default OhMyGeminiPlugin;

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyGeminiConfig,
} from './config';

// NOTE: Do NOT export functions from main index.ts!
// Gemini treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type {ConfigLoadError} from './shared/config-errors';

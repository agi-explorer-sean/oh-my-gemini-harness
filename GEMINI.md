## HARNESS MODES

### 1. Interactive Sub-Agents (Inside `gemini` CLI)
You have access to specialized sub-agents. Use `@agent_name` to invoke them.

| Agent | Purpose |
|-------|---------|
| **Sisyphus** | Primary engineer and orchestrator |
| **Oracle** | High-IQ technical advisor and architect |
| **Librarian** | Research, documentation, and OSS expert |
| **Explore** | Codebase search and contextual grep |
| **Prometheus**| Strategic planning and design |
| **Hephaestus**| Autonomous deep implementation |
| **Atlas**     | Master orchestrator and team lead |
| **Metis**     | Performance and optimization consultant |
| **Momus**     | Critical reviewer and devil's advocate |
| **Looker**    | Multimodal analysis (PDF, images, etc.) |

> **Note**: For complex tasks requiring relentless execution and automated TODO management, simply include the magic word `ultrawork` (or `ulw`) in your prompt when chatting inside the `gemini` CLI.

---

## OVERVIEW

Gemini plugin: multi-model agent orchestration. 34 lifecycle hooks, 20+ tools (LSP, AST-Grep, delegation), 11 specialized agents, full Claude Code compatibility. Stateful Agent Teams and Stateless Parallel Execution support. "oh-my-zsh" for Gemini.

## STRUCTURE

```
oh-my-gemini/
├── src/               # Google-owned entry points and original logic
├── third_party/       # Isolated non-Google code (oh-my-opencode)
├── commands/          # Google-owned command templates
├── package.json       # Root bridge config (aliases to third_party)
├── tsconfig.json      # Root bridge config (aliases to third_party)
└── GEMINI.md          # Project instructions (MANDATORY)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Bridge Entry | `src/index.ts` | Connects Google code to third-party core |
| **Core Logic** | `third_party/oh-my-opencode/src/` | **IMMUTABLE VENDOR SOURCE**. Never modify. |
| Add Agent | `third_party/oh-my-opencode/src/agents/` | Factories and prompt templates |
| Add Hook | `third_party/oh-my-opencode/src/hooks/` | Lifecycle interceptors |
| Custom Hooks | `src/hooks/` | Google-owned hooks (e.g. `proactive-edit-fixer`) |
| Add Tool | `third_party/oh-my-opencode/src/tools/` | Core tool definitions |
| Custom Tools | `src/tools/` | Google-owned tools (e.g. `parallel-exec`) |
| Add Skill | `skills/` | Google-owned skill definitions (`.md`) |
| Add Command | `commands/` | Google-owned command templates (`.toml`) |
| Config Schema | `third_party/oh-my-opencode/src/config/schema.ts` | Zod validation |
| Background agents | `third_party/oh-my-opencode/src/features/background-agent/` | `manager.ts` (1418 lines) |
| Orchestrator | `third_party/oh-my-opencode/src/hooks/atlas/` | Main orchestration hook (757 lines) |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run rebuild        # Clean + Build
bun test               # 100 test files
```

### Sub-Agent AfterAgent Guard

Sub-agent `gemini` processes (spawned by `parallel_exec`, `delegate_task`,
`call_subagent`) load `gemini-extension.json` and fire their own lifecycle
hooks. The AfterAgent dispatch (`src/cli/dispatch/index.ts`) checks
`process.env.OMG_PARENT_AGENT` and immediately returns `{decision: "allow"}`
for sub-agents, preventing parent-only handlers (ralph-loop, background
notifications, session recovery, stop hooks, babysitter) from hijacking
sub-agent conversations.
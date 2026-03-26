# OMG Harness

This project is inspired by and ported from **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** (originally created by **code-yeongyu**), bringing its powerful orchestration patterns to the Gemini ecosystem.

### Development & License Compliance

- **AI-Powered Development**: This project was developed mainly using the **Gemini CLI** and **Gemini 3 Flash** combined with the original source code. The maintainer's involvement was primarily through high-level prompting.
- **License & Non-Commercial Use**: This project respects the [Sustainable Use License Version 1.0](./LICENSE.md) and is **not used for any commercial purpose**.

## To Beginner: Why OMG Harness?

If you are new to AI-powered terminal assistants, you might be wondering how **OMG Harness** fits into the landscape of tools like **Claude Code** and the standard **Gemini CLI**.

### The Landscape of AI CLIs

| Tool | Philosophy | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Claude Code** | The "Polished Architect" | Incredible reasoning (Sonnet 3.5), repo-scale awareness, highly polished UI. | Closed source, limited customization, tied strictly to Anthropic. |
| **Gemini CLI** | The "Extensible Foundation" | Open source, extremely extensible via hooks, generous free tier, multi-modal capabilities. | Raw out-of-the-box experience; feels more like a tool than an autonomous team. |
| **OpenCode** | The "Universal Runtime" | The core SDK/environment that allows building AI CLIs. Gemini CLI is built on this. | Can be complex to configure manually without a higher-level harness. |

### The Purpose of OMG Harness

Google's **Gemini CLI** provides a rich and powerful ecosystem through its **hook system**, but it's often a "blank canvas." (similar to OpenCode CLI) **OMG Harness** acts as the high-level harness that enriches the Gemini CLI with the orchestration patterns originally pioneered in **oh-my-opencode**.

Think of it as **"oh-my-zsh" for Gemini**. While the base CLI gives you a terminal assistant, OMG Harness turns it into a **full-scale autonomous development team**.

### Why is this a good idea?

1. **Multi-Agent Orchestration**: Why rely on one linear brain? OMG lets you invoke specialized agents like the **Oracle** (architecture) to review code written by **Sisyphus** (implementation) in real-time.
2. **Agent Teams**: Launch stateful, collaborative sessions that work together on shared tasks with inter-agent messaging and centralized leadership.
3. **Parallelism**: Unlike other CLIs that work sequentially, OMG can spawn a **Parallel Execution** batch to tackle large-scale refactors or codebase audits in minutes instead of hours.
4. **Batteries Included**: We've integrated production-grade LSP tools, AST-aware searching, and 15+ specialized "skills" that are ready to use from day one.
5. **Built for the Future**: By building on the Gemini CLI's open ecosystem, OMG remains highly customizable. You aren't just using a tool; you're using a platform that you can extend with your own hooks and MCPs.

## Installation

OMG Harness is installed as a Gemini CLI extension. This allows its tools and hooks to be available across all your Gemini sessions.

### Prerequisites

**Required:**
- **Bun** (v1.0+): Install from https://bun.sh or `curl -fsSL https://bun.sh/install | bash`
- **Gemini CLI**: Install from https://gemini.ai/docs

**Optional (checked during install):**
- **gh** (GitHub CLI): Needed by the Librarian agent for repo cloning, issue/PR search, and code search. Install from https://cli.github.com or `sudo apt install gh`
- **tmux**: Needed for Interactive Bash sessions (persistent terminal sessions). Install via `sudo apt install tmux`

### Automated Install (Recommended)

The installer handles dependencies, build, config, and extension linking in one command:

```bash
cd omg-harness/
bun run src/cli/index.ts install
```

This will:
1. Install npm dependencies (sets `BUN_CONFIG_REGISTRY` automatically)
2. Build the TypeScript extension (`dist/`)
3. Add the plugin to your Gemini config
4. Configure providers and auth
5. Auto-select the best authentication mode (Vertex AI > API Key > Google OAuth)
6. Link the extension with `gemini extensions link .`

### Manual Install

If the automated installer doesn't work, follow these steps:

```bash
cd omg-harness

# 1. Install dependencies
BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun install

# 2. Build the extension
bun run build

# 3. Register with Gemini CLI
gemini extensions link .
```

### Authentication Mode

The Gemini CLI supports multiple authentication modes. OMG Harness provides an interactive switcher to manage them:

| Mode | `selectedType` | Requirements | Claude Support |
| :--- | :--- | :--- | :--- |
| Google OAuth | `oauth-personal` | Browser login via `gemini auth login` | No |
| Vertex AI | `vertex-ai` | ADC + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` | Yes |
| API Key | `gemini-api-key` | `GEMINI_API_KEY` env var | No |

The installer auto-selects the best available mode. To switch manually:

```bash
# Interactive TUI selector
bun run src/cli/index.ts auth-mode

# Auto-detect and apply the best available mode
bun run src/cli/index.ts auth-mode --auto

# Set a specific mode
bun run src/cli/index.ts auth-mode --mode vertex-ai

# Non-interactive status display
bun run src/cli/index.ts auth-mode --no-tui
```

Auth mode selection is persisted in `~/.gemini/settings.json` under `security.auth.selectedType`. Switching modes also updates the Gemini CLI provider config (e.g., adding/removing Claude models for Vertex AI).

### Vertex AI Setup (for Claude Models)

To use Claude models (claude-opus-4-6, claude-sonnet-4-5) via Vertex AI MaaS:

```bash
bun run src/cli/index.ts setup-vertex-ai
```

This guides you through setting up ADC credentials, GCP project, and region. After setup, run `auth-mode --auto` or `auth-mode --mode vertex-ai` to activate it.

## Troubleshooting

### MCP Startup Failure
If you see "mcp omg-harness startup failure" when starting Gemini, check the following:

1.  **Ensure you have built the project**: Run `bun run build` in the extension directory.
2.  **Verify `bun` is in your PATH**: The MCP server is executed using `bun`.
3.  **Check logs**: Look at the logs in your system temp directory (e.g., `/tmp/omg-harness.log` or `%TEMP%\omg-harness.log`).
4.  **Absolute Paths**: Ensure you linked the extension correctly. If you moved the folder, you may need to `unlink` and `link` it again.
5.  **Missing `dist/`**: If `dist/` doesn't exist, run `bun run build` first.
6.  **NPM registry**: In restricted environments, set `BUN_CONFIG_REGISTRY=https://registry.npmjs.org` before `bun install`.

## Uninstallation

To remove omg-harness:

1. **Uninstall the Gemini Extension**

   ```bash
   gemini extensions uninstall omg-harness
   ```

2. **Remove the plugin from your Gemini config (Legacy)**

   Edit `~/.gemini/settings.json` or `~/.config/gemini/gemini.json` and remove the entry pointing to your local `omg-harness` directory from the `plugin` array.

## Features
**Quick Overview:**
  - **Agents**: Sisyphus (main), Prometheus (planner), Atlas (orchestrator), Oracle (architecture), Librarian (docs), Explore (grep), Metis (optimizer), Momus (critic), Hephaestus (deep worker), Multimodal Looker
  - **Background Agents**: Run multiple agents in parallel like a real dev team
  - **Agent Teams**: Stateful, collaborative multi-agent teams with shared mailbox and task locking
  - **Parallel Execution**: Stateless, orchestrate dozens of parallel sub-agents for massive tasks
  - **LSP & AST Tools**: Refactoring, rename, diagnostics, AST-aware code search
  - **Context Injection**: Auto-inject AGENTS.md, README.md, conditional rules
  - **Claude Code Compatibility**: Full hook system, commands, skills, agents, MCPs
  - **Built-in MCPs**: websearch (Exa, Tavily, Serper), context7 (docs), grep_app (GitHub search)
  - **Session Tools**: List, read, search, and analyze session history
  - **Auth Mode Switcher**: Interactive TUI to switch between Google OAuth, Vertex AI, and API Key modes
  - **Productivity Features**: Ralph Loop, Todo Enforcer, Comment Checker, Think Mode, and more


## Usage Examples

OMG Harness provides several entry points depending on the complexity of your task. Below are the most common patterns.

### 1. Specialized Agents (The "Expert" Team)
Invoke one of 10 specialized agents directly using `@agent_name` or via slash commands. Each agent has a distinct personality and toolset.

```text
/oracle Explain the architectural trade-offs of using a Redux-like state manager in a small React app.
```
*   **Sisyphus**: Primary engineer & implementation. (`/sisyphus`)
*   **Oracle**: High-IQ architecture & debugging. (`/oracle`)
*   **Librarian**: Docs, research, and OSS patterns. (`/librarian`)
*   **Explore**: Contextual codebase search. (`/explore`)
*   **Prometheus**: Strategic planning & design. (`/prometheus`)
*   **Hephaestus**: Autonomous deep implementation. (`/hephaestus`)
*   **Atlas**: Master orchestrator and team lead. (`/atlas`)
*   **Metis**: Performance and optimization consultant. (`/metis`)
*   **Momus**: Critical reviewer and devil's advocate. (`/momus`)
*   **Looker**: Multimodal analysis (PDF, images, etc.). (`/looker`)

### 2. Autonomous Orchestration (Atlas & Hephaestus)
For complex tasks, use **Atlas** to orchestrate a team or **Hephaestus** for deep, autonomous implementation. They research, plan, execute, and verify the work for you.

```text
Help me find best agent to explain what a mutex is in 1 sentence. then delegate the task to the agent
```

### 3. Parallel Execution (Massive Scale)
Use `parallel_exec` to partition a massive task (like refactoring 50 files or auditing a whole repo) into independent sub-agents that run simultaneously.

```text
/parallel-exec '[{"description":"Say Ping","prompt":"Say Ping"},{"description":"Say Pong","prompt":"Say Pong"}]'
```

### 4. Agent Teams (Stateful Collaboration)
Create a persistent team of agents that share a mailbox and task list. Perfect for "Pair Programming" with multiple AI specialists.

```text
/team create architects && @atlas Delegate one agent to say "Hello" and another to say "World".
```

### 5. Ralph Loop (Continuous TODO Management)
The Ralph Loop is an autonomous cycle that maintains a live TODO list, narrating its decisions and verifying every step until the goal is reached.

```text
/ralph-loop create a gemini extension like claude cowork at ~/Documents/cowork-gemini-extension. As you work, narrate each step you take — what files you are creating, what commands you are running, and what decisions you are making.
```

### 6. Ultrawork (Maximum Intensity)
For "impossible" tasks that require relentless focus and exhaustive verification, use **Ultrawork Mode** and specialized deep-work commands.

```text
/ulw-loop Implement a full-stack authentication system with JWT and refresh tokens. Include tests for all edge cases.
```
*   **/ulw-loop**: Continuous autonomous loop with automated TODO enforcement.
*   **/init-deep**: Bootstrap a new project or feature with deep research.
*   **/start-work**: Start a structured session with planning and strategy.
*   **/refactor**: Perform deep, multi-file refactors with LSP verification.
*   **/remove-deadcode**: Automatically identify and prune unused logic.

### 7. Multimodal Analysis (Looker)
Use the Looker agent to "see" and analyze non-text files like architecture diagrams, UI mockups, or technical PDFs.

```text
/looker Read the attached architecture.png and explain the data flow between the microservices.
```

### 8. Domain Skills & MCPs
Inject specialized expertise using the `load_skills` parameter or use built-in MCPs for web searching and documentation.

```bash
# Backend refactor with TypeScript expertise
delegate_task(category="ultrabrain", load_skills=["typescript-programmer"], prompt="Refactor the context manager to use generics")

# Search the web or documentation
web_search_exa(query="latest Bun.js release notes")
context7_get_docs(query="react-query useQuery hook")
```

## 🛠️ Behind the Scenes: Feature Recognition

How does the Gemini CLI know when to use the advanced features of **OMG Harness**? It's not magic—it's a multi-layered discovery and orchestration system.

1.  **Tool Registration:** Every new tool (like `delegate_task`, `parallel_exec`) is registered in the plugin's manifest. The Gemini model "sees" these tools and their descriptions in its system prompt, allowing it to choose the right tool for the task.
2.  **Keyword Detection (Proactive Injection):** The `keyword-detector` hook ([`src/hooks/keyword-detector/`](./src/hooks/keyword-detector/)) monitors your messages for words like "search," "analyze," or "ultrawork." When detected, it **injects specialized system instructions** (e.g., `[search-mode]`) into the prompt, guiding the model to use the high-power orchestration tools you've added.
3.  **Auto Slash Commands:** When you type a slash command (e.g., `/ralph-loop`), the `auto-slash-command` hook ([`src/hooks/auto-slash-command/`](./src/hooks/auto-slash-command/)) replaces your message with a **Command Template**. These templates contain detailed natural language instructions that the model follows to execute the feature correctly.
4.  **Interactive Orchestration (Atlas):** The **Atlas** orchestrator hook ([`src/hooks/atlas/`](./src/hooks/atlas/)) monitors tool outputs. If a task is complex or a tool fails, Atlas can inject follow-up instructions to steer the model back on track or suggest a parallelization strategy.

## 🧠 Project-Level AI Guidance (GEMINI.md)

You can provide persistent, hierarchical guidance to the Gemini model using **GEMINI.md** files.

### How to Inject Instructions
- **Project Level:** Create a `GEMINI.md` file in your project's root. The Gemini CLI automatically searches for this file and includes its content as "Instruction Context" in every session.
- **Global Level:** Use `~/.gemini/GEMINI.md` for instructions that should apply across all your projects.
- **Automatic Injection:** OMG Harness includes a `directory-agents-injector` hook. This hook proactively reads `AGENTS.md` and `README.md` in the current directory and provides them to the model, ensuring it always understands the local architecture.

### Will `gemini extensions link` work?
Yes! When you run `gemini extensions link .` in the OMG Harness directory:
1.  Gemini CLI creates a link to the project.
2.  The `GEMINI.md` within this directory (and any linked extensions) is **automatically merged** into the agent's memory.
3.  This means the specialized "harness instructions" for OMG Harness are always active without you having to manually copy-paste them.


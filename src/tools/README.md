# tools

This directory contains the implementations of the custom tools available to
agents.

## Why Gemini Specific Tools?

Unlike hooks or shared utilities, the tools in OhMyGemini are implemented
locally because they serve as the active interface between the model and the
system. They are precisely tuned to Gemini's capabilities and naming conventions.

### 1. Functional Superiority (Local Exclusives)

Several tools represent core Gemini features that do not exist in the vendor
core: - **`parallel-exec/`**: Orchestrator for stateless parallel execution
parallels. Handles wave-based partitioning and automated result synthesis. -
**`team/`**: Implements **Agent Teams**, allowing multiple agents to collaborate
on a shared mission via a stateful mailbox and task-claiming system.

### 2. Environment Stability and Safety

-   **`delegate-task/`**: Includes a unique "Supervised Mode" that detects
    unstable models (like early Gemini previews) and automatically converts
    synchronous calls into monitored background tasks to prevent CLI hangs.
-   **`interactive-bash/`**: Strictly isolates sub-agent shells by enforcing
    `omg-` tmux prefixes and blocking TUI-clashing subcommands.
-   **`ast-grep/` & `grep/`**: Redirect binary installations to
    `~/.cache/oh-my-gemini`, preventing state pollution and locking conflicts
    with other "Oh My" framework extensions.

### 3. Identity and Tool Mapping

Many tools are re-implemented to ensure that the agent's instructions match the
reality of the Gemini environment: - **`call-subagent/`**: Directly replaces the
vendor's `call_omo_agent`, ensuring that agents don't attempt to call missing
tools. - **`task/`**: Overhauled to support `teamName` parameters and
project-specific storage paths in `.gemini/`.

## File Sources

### Local Implementation

Unique features or heavily customized tools: - `ast-grep/`, `background-task/`,
`call-subagent/`, `delegate-task/`, `glob/`, `grep/`, `interactive-bash/`,
`look-at/`, `lsp/`, `parallel-exec/`, `session-manager/`, `skill/`,
`skill-mcp/`, `slashcommand/`, `task/`, `team/`, `visualize-plan/`.

### Registration

-   `index.ts`: Central registry that maps Gemini-specific tool names to their
    implementations.

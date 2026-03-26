# plugin-handlers

This directory contains handlers for plugin-wide lifecycle events.

## Why a Local Implementation?

The `config-handler.ts` is the architectural hub of the Gemini extension. While
it follows the structure of the `oh-my-opencode` core, it is implemented locally
to support several critical Gemini-specific features:

### 1. Advanced Model Resolution Pipeline

Gemini CLI implements a more sophisticated model fallback and resolution
system: - **UI-Model Priority**: It captures the currently selected model from
the Gemini UI (`config.model`) and prioritizes it as the `uiSelectedModel`
across all agents. - **First-Run Recovery**: Includes specialized logic to
resolve models from the fallback chain even when the provider cache is empty
(e.g., during the very first run), preventing deadlocks. - **Requirement
Mapping**: Integrates with `AGENT_MODEL_REQUIREMENTS` to ensure agents like
Prometheus are always paired with capable models.

### 2. Specialized Tool & Permission Mapping

-   **Tool Renaming**: Maps internal vendor tool names (like `call_omo_agent`)
    to Gemini's expected tool names (`call_subagent`) in the agent permission
    sets.
-   **Parallel Execution**: Orchestrates the `parallel_exec` tool, which is a
    core Gemini feature not present or handled differently in the vendor core.
-   **CLI Run Mode**: Dynamically adjusts tool permissions (like denying the
    `question` tool) when running in non-interactive `GEMINI_CLI_RUN_MODE`.

### 3. Deep Integration with Local Features

-   **Skill/Command Loaders**: Bridges to the local `gemini-skill-loader` and
    `claude-code-command-loader` to find instructions in `.gemini/` and global
    config directories.
-   **Built-in Agents**: Configures the local `sisyphus-junior` and other agents
    with Gemini-specific overrides.
-   **MCP Factory**: Passes local `websearch` provider configurations into the
    MCP creation loop.

## File Sources

### Local Implementation

-   `config-handler.ts`: The primary logic for initializing the plugin state. It
    handles model resolution, agent registration, command loading, and tool
    permission setup. It is heavily customized for Gemini's specific agent
    order, permission system, and model fallback logic.
-   `index.ts`: Export point for handlers.

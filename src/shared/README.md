# shared

This directory contains utility functions and shared logic used across the
plugin.

## Why Gemini Specific Shared Logic?

While we leverage the `oh-my-opencode` core for agnostic utilities, several
shared modules are modified to align with Gemini's architecture.

### 1. Project Identity and Path Isolation

To maintain strict branding and prevent state collision with other CLI
extensions: - **`data-path.ts` & `gemini-config-dir.ts`**: Redirects all storage
and configuration lookups from `.opencode` to `.gemini`. -
**`system-directive.ts`**: Rebrands internal headers to `[SYSTEM DIRECTIVE:
OH-MY-GEMINI]`, ensuring hooks can distinguish our messages from other
plugins. - **`logger.ts`**: Redirects logs to `oh-my-gemini.log` for isolated
troubleshooting.

### 2. Specialized Gemini Ecosystem Support

-   **`model-requirements.ts`**: Replaces the vendor's Anthropic-first fallback
    chains with **Gemini-first** logic, ensuring specialized agents like
    Prometheus always utilize high-reasoning Gemini 3 models.
-   **`agent-tool-restrictions.ts`**: Maps the vendor's `call_omo_agent` to
    Gemini's `call_subagent`, preventing "Tool Not Found" errors during agent
    delegation.
-   **`permission-compat.ts`**: Implements the Gemini 1.1.1+ permission system
    (allow/deny/ask), which is more granular than the vendor's legacy boolean
    toggles.
-   **`ollama-ndjson-parser.ts`**: A Gemini-specific utility for handling
    streaming responses from internal and Ollama-compatible inference endpoints.

### 3. User Experience and Migration

-   **`model-suggestion-retry.ts`**: Adds a unique "Did you mean?" recovery
    layer that automatically corrects model ID typos, reducing friction during
    first-time setup.
-   **`migration.ts`**: Orchestrates the rename mapping for users moving from
    legacy `omo-` prefixed configs to the current `omg-` standard.

## File Sources

### Re-exported from oh-my-opencode

These files are logically identical to the vendor core and are re-exported to
maintain API compatibility: - `agent-display-names.ts`, `binary-downloader.ts`,
`claude-config-dir.ts`, `command-executor.ts`, `config-errors.ts`,
`deep-merge.ts`, `dynamic-truncator.ts`, `file-reference-resolver.ts`,
`file-utils.ts`, `first-message-variant.ts`, `frontmatter.ts`,
`hook-disabled.ts`, `model-resolution-pipeline.ts`, `model-resolver.ts`,
`opencode-config-dir.ts`, `opencode-version.ts`, `pattern-matcher.ts`,
`session-cursor.ts`, `session-injected-paths.ts`, `session-utils.ts`,
`shell-env.ts`, `snake-case.ts`, `tool-name.ts`, `zip-extractor.ts`.

### Modified / Gemini Specific

Files that exist in vendor but are customized for Gemini: -
`agent-tool-restrictions.ts`, `connected-providers-cache.ts`, `data-path.ts`,
`external-plugin-detector.ts`, `logger.ts`, `migration.ts`,
`model-availability.ts`, `model-requirements.ts`, `model-suggestion-retry.ts`,
`permission-compat.ts`, `system-directive.ts`.

### Local Implementation

Unique features developed specifically for the Gemini extension: -
`agent-variant.ts`, `gemini-config-dir.ts`, `gemini-version.ts`,
`jsonc-parser.ts`, `model-sanitizer.ts`, `ollama-ndjson-parser.ts`,
`simple-toml.ts`, `tmux/`.

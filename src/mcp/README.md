# mcp

This directory contains the configurations for the built-in MCP (Model Context
Protocol) servers.

## Why a Local Implementation?

While much of the project aims for maximum vendor reuse, the MCP layer is
implemented locally to provide functional and architectural capabilities that
are not available in the `oh-my-opencode` core.

### 1. Multi-Provider Web Search Support

The vendor core is hardcoded to use **Exa** as the sole web search provider. Our
local implementation in `websearch.ts` provides a dynamic provider system that
currently supports: - **Exa** (`mcp.exa.ai`) - **Tavily** (`mcp.tavily.com`) -
**Serper** (`mcp.serper.dev`)

This flexibility is critical for Gemini users who may have existing API keys or
performance preferences for specific search engines.

### 2. Configuration Injection Architecture

The local `index.ts` factory (`createBuiltinMcps`) is designed to accept an
optional `WebsearchConfig` object. This allows the CLI to: - Pass user-defined
provider choices from `.gemini/config.json` directly into the MCP factory. -
Maintain type-safety against our local `WebsearchConfig` schema defined in
`src/config/schema.ts`. - Avoid the "Static Configuration" limitation of the
vendor core, where search settings are global and immutable.

### 3. Future-Proofing for Gemini

By maintaining a local layer, we can easily add Gemini-specific or internal
search tools (e.g., specialized documentation crawlers or internal search APIs)
without needing to upstream changes to the agnostic vendor core.

## File Sources

### Local Implementation

-   `context7.ts`: Configuration for the Context7 documentation server.
-   `grep-app.ts`: Configuration for the Grep.app search server.
-   `websearch.ts`: **Custom Logic** - Dynamic configuration for multiple search
    providers.
-   `index.ts`: **Custom Logic** - Configuration-aware factory for MCP creation.
-   `types.ts`: MCP-related type definitions (logically identical but maintained
    for dependency localism).

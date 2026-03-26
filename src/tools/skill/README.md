# skill

A tool for loading specialized skills and step-by-step guidance.

## Differences from Vendor Core

Feature | Local (`src/tools/skill`) | Vendor (`third_party/oh-my-opencode/...`)
------- | ------------------------- | -----------------------------------------
Loaders | `gemini-skill-loader`     | `opencode-skill-loader`
Scope   | `.gemini/skills/`         | `.opencode/skills/`

## Re-imported from oh-my-opencode

-   Skill XML formatting and schema display logic.
-   Agent restriction checks (preventing non-orchestrator agents from loading
    powerful skills).
-   MCP capability discovery within skill definitions.

## Modified for Gemini

-   **Path Isolation**: Redirected skill discovery to Gemini-specific paths.
-   **Git-Master Configuration**: Modified to use the local `gitMasterConfig`
    for watermarking and co-author settings during git operations.
-   **Lazy Loading**: Integrated with the `gemini-skill-loader` to support
    high-performance discovery of thousands of skills without startup overhead.

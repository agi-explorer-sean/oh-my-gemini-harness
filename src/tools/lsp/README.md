# lsp

LSP-based intelligence tools (definition, references, diagnostics, rename).

## Differences from Vendor Core

Feature       | Local (`src/tools/lsp`)     | Vendor (`third_party/oh-my-opencode/...`)
------------- | --------------------------- | -----------------------------------------
Configuration | `.gemini/oh-my-gemini.json` | `.opencode/oh-my-opencode.json`
Servers       | Synced with Gemini CLI      | Generic server list

## Re-imported from oh-my-opencode

-   Full JSON-RPC client implementation for interacting with LSP servers.
-   Server lifecycle management (start, stop, warmup, release).
-   Formatting utilities for locations, diagnostics, and workspace edits.

## Modified for Gemini

-   **Storage Redirection**: All project-level and user-level configuration is
    loaded from `.gemini/` and `~/.config/gemini/`, ensuring complete isolation
    from the vendor framework.
-   **Binary Lookups**: Added priority lookups in `~/.config/gemini/bin` and
    `getDataDir()/gemini/bin`.
-   **Sync with Gemini CLI**: `BUILTIN_SERVERS` and `EXT_TO_LANG` mappings are
    kept in sync with the upstream Gemini repository to ensure feature parity.

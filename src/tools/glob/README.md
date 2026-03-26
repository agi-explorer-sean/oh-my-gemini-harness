# glob

Fast file pattern matching tool.

## Differences from Vendor Core

Feature | Local (`src/tools/glob`) | Vendor (`third_party/oh-my-opencode/...`)
------- | ------------------------ | -----------------------------------------
Backend | Gemini Bundled Ripgrep   | Standard system `rg`/`find`

## Re-imported from oh-my-opencode

-   Shell argument builders for `ripgrep`, `find`, and `powershell`.
-   Result formatting and truncation logic.
-   Modification-time based sorting.

## Modified for Gemini

-   **Shared Constants**: Inherits ripgrep resolution from the local `grep`
    tool, ensuring it uses the Gemini-bundled binary (`~/.gemini/bin/rg`) as the
    highest priority backend.
-   **Path Isolation**: Follows the `oh-my-gemini` storage redirection for all
    binary lookups.

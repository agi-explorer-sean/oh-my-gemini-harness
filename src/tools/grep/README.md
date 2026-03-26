# grep

Regex-based content search tool.

## Differences from Vendor Core

| Feature       | Local                   | Vendor                             |
:               : (`src/tools/grep`)      : (`third_party/oh-my-opencode/...`) :
| ------------- | ----------------------- | ---------------------------------- |
| Binary Source | Gemini-bundled priority | System path priority               |
| Cache Path    | `~/.cache/oh-my-gemini` | `~/.cache/oh-my-opencode`          |

## Re-imported from oh-my-opencode

-   Core `spawn` logic and output parser for ripgrep's colon-delimited format.
-   Safety flags to prevent recursive symlink loops or binary file scanning.
-   Support for `fixedStrings`, `wholeWord`, and `caseSensitive` search options.

## Modified for Gemini

-   **Bundled Binary Support**: Specifically prioritizes the ripgrep binary
    bundled with the Gemini CLI (located in `getDataDir()/gemini/bin`).
-   **Cache Isolation**: The binary downloader installs to `oh-my-gemini`
    specific directories, avoiding interference with the vendor framework's own
    installations.

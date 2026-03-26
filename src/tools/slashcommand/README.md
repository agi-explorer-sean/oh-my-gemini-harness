# slashcommand

A tool for executing custom slash commands and task templates.

## Differences from Vendor Core

| Feature   | Local                      | Vendor                             |
:           : (`src/tools/slashcommand`) : (`third_party/oh-my-opencode/...`) :
| --------- | -------------------------- | ---------------------------------- |
| Templates | Support for `.toml`        | Markdown only                      |
:           : templates                  :                                    :
| Discovery | Expanded root `commands/`  | Hidden folder focus only           |

## Re-imported from oh-my-opencode

-   Frontmatter parsing and command metadata extraction.
-   Recursive variable substitution for `${user_message}` and file references.
-   Fuzzy matching for command names.

## Modified for Gemini

-   **TOML Support**: Added a parser for TOML-based command templates.
-   **Expanded Discovery**: Searches the root `commands/` directory by default,
    allowing for easier project-level automation without burying commands in
    hidden folders.
-   **Agent Mapping**: Aligned with Gemini-specific primary agent names to
    ensure task templates target the correct orchestrators.

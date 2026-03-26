# look-at

A multimodal analysis tool for processing images and PDFs.

## Differences from Vendor Core

| Feature   | Local                 | Vendor                             |
:           : (`src/tools/look-at`) : (`third_party/oh-my-opencode/...`) :
| --------- | --------------------- | ---------------------------------- |
| Sub-agent | `multimodal-looker`   | Vendor multimodal agent            |

## Re-imported from oh-my-opencode

-   MIME type inference logic for various file extensions.
-   Session creation and file passthrough mechanics.

## Modified for Gemini

-   **Agent Identity**: Mapped to the Gemini-optimized `multimodal-looker`
    agent.
-   **Robust Error Handling**: Added specific detection for JSON parse errors
    from early preview vision models, providing user-friendly advice on model
    availability and MIME type compatibility.

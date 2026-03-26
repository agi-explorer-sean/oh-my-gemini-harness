# delegate-task

The primary orchestration tool for task delegation and model selection.

## Differences from Vendor Core

| Feature | Local                       | Vendor                             |
:         : (`src/tools/delegate-task`) : (`third_party/oh-my-opencode/...`) :
| ------- | --------------------------- | ---------------------------------- |
| Models  | Optimized for Google Gemini | OpenAI/Claude focus                |
:         : (Pro/Flash)                 :                                    :
| Mode    | "Supervised Mode" for       | Direct execution only              |
:         : unstable models             :                                    :
| Teams   | Stateful **Agent Teams**    | Single-agent focus                 |
:         : protocol                    :                                    :

## Re-imported from oh-my-opencode

-   Category-based configuration system (visual, deep, quick, etc.).
-   Skill resolution and content injection logic.
-   Complex continuation logic (`session_id` resumption) for both sync and
    background tasks.

## Modified for Gemini

-   **Supervised Mode**: Includes specialized logic to detect
    experimental/preview models (e.g., Gemini-3 preview). It automatically
    converts synchronous calls into monitored background tasks to prevent CLI
    hangs while providing real-time feedback.
-   **Agent Teams Integration**: The `prompt-builder` is modified to inject team
    protocols (shared task lists, mailboxing) when an agent is part of a
    stateful team.
-   **Model Fallback Chain**: Redefined `DEFAULT_CATEGORIES` and fallback logic
    to prioritize Gemini-3-Pro and Flash models, ensuring cost-effective and
    low-latency delegation.

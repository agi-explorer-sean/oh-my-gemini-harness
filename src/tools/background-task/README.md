# background-task

Tools for managing and retrieving results from background agent tasks.

## Differences from Vendor Core

Feature          | Local (`src/tools/background-task`)   | Vendor (`third_party/oh-my-opencode/...`)
---------------- | ------------------------------------- | -----------------------------------------
Parallel Support | Full integration with `parallel-exec` | None
Report Logic     | Enhanced `formatParallelReport`       | Sequential task focus only

## Re-imported from oh-my-opencode

-   Base `BackgroundTask` and `BackgroundOutput` tool definitions.
-   Polling logic for synchronous waiting (`block=true`).
-   Message extraction and filtering (thinking/tool_result/text).

## Modified for Gemini

-   **Parallel Execution Reporting**: Overhauled `formatTaskResult` to detect
    `parallel_exec` task types. It invokes the `ParallelCoordinator` to generate
    partitioned wave-based reports rather than a flat message history.
-   **Thinking Truncation**: Added `thinking_max_chars` parameter to control the
    volume of reasoning content returned, optimized for Gemini's long reasoning
    outputs.
-   **Robustness**: Enhanced log traces for parent agent resolution to better
    track delegation chains in complex parallels.

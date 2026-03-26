# parallel-exec

A local exclusive tool for orchestrating stateless parallel execution parallels.

## Differences from Vendor Core

This tool is a **Gemini Local Exclusive**. There is no equivalent in the vendor
core.

## Functional Value

-   **Wave-based Partitioning**: Automatically divides a large set of tasks
    (e.g., "@src/components/") into waves based on concurrency limits.
-   **Stateless Parallels**: Launches independent agents to process sub-tasks in
    parallel without cross-session pollution.
-   **Synthesis Engine**: Includes an LLM-assisted reconciliation phase
    (`ParallelSynthesizer`) that automatically merges file changes from isolated
    agents back to the main directory, resolving conflicts using an
    "Expert-in-the-Middle" pattern.
-   **Scalability**: Designed for massive tasks like refactoring 50+ files or
    analyzing 100+ PRs concurrently.

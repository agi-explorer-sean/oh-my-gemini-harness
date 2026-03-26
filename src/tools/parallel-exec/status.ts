import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { BackgroundManager } from "../../features/background-agent"
import type { CompositeBackgroundTask } from "../../features/background-agent/types"

export function createParallelStatusTool(options: {
  manager: BackgroundManager
}): ToolDefinition {
  const { manager } = options
  return tool({
    description: "Retrieve real-time progress of a specific parallel execution.",
    args: {
      id: tool.schema.string().describe("The Task ID of the parallel execution"),
    },
    async execute(args) {
      const task = manager.getTask(args.id) as CompositeBackgroundTask
      if (!task || task.type !== "parallel_exec") {
        return `Error: Parallel execution task with ID "${args.id}" not found.`
      }

      // We need to get progress from the coordinator if it's still in memory
      // Otherwise, we show what we have in the task object
      const coordinator = (manager as any).parallelCoordinators?.get(args.id)
      
      if (coordinator) {
        const progress = coordinator.getProgress()
        return `# Parallel Execution Progress: ${task.description}
Status: ${task.status.toUpperCase()}
Progress: ${progress.percent}%

| Completed | Failed | Running | Queued | Total |
|-----------|--------|---------|--------|-------|
| ${progress.completed} | ${progress.failed} | ${progress.running} | ${progress.queued} | ${progress.total} |

Use background_output(task_id="${args.id}") for the final report when completed.`
      }

      return `# Parallel Execution Status: ${task.description}
Status: ${task.status.toUpperCase()}
Completed At: ${task.completedAt?.toISOString() ?? "-"}
${task.error ? `Error: ${task.error}` : ""}

Use background_output(task_id="${args.id}") to retrieve the full report.`
    }
  })
}

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { ParallelCoordinator, ParallelSynthesizer, saveParallelExec, getAvailableAgentNames } from "../../features/parallel-exec"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"
import type { ToolContextWithMetadata, OpencodeClient } from "../delegate-task/types"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

export interface ParallelExecArgs {
  tasks: string
  instruction?: string
  max_parallel?: number
  stop_on_failure?: boolean
  isolation?: boolean
  synthesis?: boolean
  run_in_background?: boolean
  load_skills?: string[]
  mode?: string
}

function expandTasks(tasksStr: string, directory: string, instruction?: string, defaultSkills?: string[]): Array<{
  description: string
  prompt: string
  category?: string
  agent?: string
  skills?: string[]
}> | string {
  if (tasksStr.trim().startsWith("@")) {
    let target = tasksStr.trim().slice(1)
    // Remove leading/trailing slashes and normalize
    target = target.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "")
    
    const absPath = join(directory, target)
    
    if (!existsSync(absPath)) {
      return `Error: Reference path '${target}' not found.`
    }

    const tasks: Array<{
      description: string
      prompt: string
      category?: string
      agent?: string
      skills?: string[]
    }> = []

    const stats = statSync(absPath)
    if (stats.isDirectory()) {
      // Use readdirSync with recursive: true to get all files
      // Bun and Node.js 18.17.0+/20.1.0+ support this
      const allEntries = readdirSync(absPath, { recursive: true })
      
      const files = allEntries
        .filter(f => typeof f === 'string')
        .map(f => {
          const entryPath = join(absPath, f as string)
          // We want the path relative to the main directory for the prompt
          return relative(directory, entryPath)
        })
        .filter(f => {
          // Ignore .git and node_modules
          if (f.includes(".git") || f.includes("node_modules")) return false

          try {
            const fullPath = join(directory, f)
            if (!statSync(fullPath).isFile()) return false

            // Skip binary files by checking first 8KB for null bytes
            try {
              const buf = readFileSync(fullPath).subarray(0, 8192)
              if (buf.includes(0)) {
                log(`[parallel_exec] Skipping binary file: ${f}`)
                return false
              }
            } catch {
              return false
            }

            return true
          } catch {
            return false
          }
        })

      for (const file of files) {
        const taskPrompt = instruction 
          ? instruction.replace(/\{\{file\}\}/g, file).replace(/@file/g, `@${file}`)
          : `Please process the file: @${file}. Perform analysis or tasks as required by the overall context.`

        tasks.push({
          description: `Process file: ${file}`,
          prompt: taskPrompt,
          skills: defaultSkills,
        })
      }
    } else {
      // It's a single file
      const relFile = relative(directory, absPath)
      const taskPrompt = instruction 
        ? instruction.replace(/\{\{file\}\}/g, relFile).replace(/@file/g, `@${relFile}`)
        : `Please process the file: @${relFile}. Perform analysis or tasks as required by the overall context.`

      tasks.push({
        description: `Process file: ${relFile}`,
        prompt: taskPrompt,
        skills: defaultSkills,
      })
    }

    return tasks
  }

  try {
    const parsed = JSON.parse(tasksStr)
    if (!Array.isArray(parsed)) {
      return "Error: 'tasks' must be a JSON array string if not using @ reference."
    }
    // Inject default skills if not provided in JSON task objects
    if (defaultSkills && defaultSkills.length > 0) {
      return parsed.map(t => ({
        ...t,
        skills: t.skills || defaultSkills
      }))
    }
    return parsed
  } catch (e) {
    return `Error parsing 'tasks' JSON: ${(e as Error).message}`
  }
}

export function createParallelExecTool(options: {
  manager: BackgroundManager
  client: OpencodeClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  sisyphusJuniorModel?: string
  browserProvider?: BrowserAutomationProvider
}): ToolDefinition {
  const { manager, directory, client, userCategories, gitMasterConfig, sisyphusJuniorModel, browserProvider } = options
  return tool({
    description: `Execute multiple sub-tasks in parallel using parallel agents.
    
This tool is designed for massive tasks that can be partitioned into independent units.
Each task will be launched as a background agent. The parallel execution manager will handle waves, 
concurrency, and result collection.

**Task Input**:
- **JSON Array**: List of task objects with 'description' and 'prompt'.
- **Reference**: '@path/to/dir/' or '@path/to/file'. Expands to one task per file.

**Advanced Synthesis**:
Enable 'synthesis' to automatically merge file changes from parallel agents. 
This uses isolated environments for each agent and an LLM-assisted reconciliation 
engine to resolve conflicts.

Results are returned as a combined report once all tasks complete.

**Best practices**:
- Use this when you have 5+ independent sub-tasks (e.g., analyzing 50 PRs, refactoring 10 files).
- Ensure tasks are truly independent.
- Provide clear descriptions for each sub-task.`,
    args: {
      tasks: tool.schema.string().describe("JSON array string OR '@path/' reference. Example: '@src/components/'"),
      instruction: tool.schema.string().optional().describe("Optional template instruction for expanded tasks. Use '{{file}}' or '@file' as placeholders."),
      max_parallel: tool.schema.number().optional().describe("Maximum concurrent agents (default: 10)"),
      stop_on_failure: tool.schema.boolean().optional().describe("Abort entire parallel execution if any sub-task fails (default: false)"),
      isolation: tool.schema.boolean().optional().describe("Run each agent in an isolated directory (default: false, automatically true if synthesis=true)"),
      synthesis: tool.schema.boolean().optional().describe("Automatically merge file changes from isolated agents back to the main directory (default: false)"),
      run_in_background: tool.schema.boolean().optional().default(true).describe("Whether to run in background. Default: true"),
      load_skills: tool.schema.array(tool.schema.string()).optional().describe("Skill names to inject into each sub-task."),
      mode: tool.schema.string().optional().describe("Execution mode: 'read_only' (direct API, zero cold start, text-only) or 'read_write' (subprocess, full tool access). Default: read_only for blocking, read_write for background."),
    },
    async execute(args: ParallelExecArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      log("[parallel_exec] Tool context session ID:", ctx.sessionID)
      const runInBackground = args.run_in_background !== false
      
      const expanded = expandTasks(args.tasks, directory, args.instruction, args.load_skills)
      if (typeof expanded === "string") {
        return expanded
      }

      const parsedTasks = expanded

      if (parsedTasks.length === 0) {
        return "No tasks provided for parallel execution."
      }

      // Pre-validate agent names before spawning any subprocesses
      const availableAgents = getAvailableAgentNames(directory)
      const uniqueAgents = [...new Set(parsedTasks.map(t => t.agent ?? "sisyphus-junior"))]
      const invalidAgents = uniqueAgents.filter(a => !availableAgents.includes(a))
      if (invalidAgents.length > 0) {
        return `Invalid agent name(s): ${invalidAgents.map(a => `"${a}"`).join(', ')}.\nAvailable agents: ${availableAgents.join(', ')}`
      }

      log(`[parallel_exec] Initializing parallel execution with ${parsedTasks.length} tasks (synthesis: ${args.synthesis}, background: ${runInBackground})`)

      // Default mode: read_only for blocking (fast direct API), read_write for background (full tool access)
      const mode: 'read_only' | 'read_write' = (args.mode === 'read_write' || args.mode === 'read_only')
        ? args.mode
        : (runInBackground ? 'read_write' : 'read_only')

      const config = {
        maxParallel: args.max_parallel ?? 10,
        stopOnFirstFailure: args.stop_on_failure ?? false,
        isolation: args.isolation ?? args.synthesis ?? false,
        synthesis: args.synthesis ?? false,
        mode,
      }

      const coordinator = new ParallelCoordinator({
        manager,
        parentSessionID: ctx.sessionID,
        parentMessageID: ctx.messageID,
        directory,
        config,
        client,
        userCategories,
        gitMasterConfig,
        sisyphusJuniorModel,
        browserProvider,
      })

      const { ids: addedIds, errors: validationErrors } = coordinator.addTasks(parsedTasks.map(t => ({
        description: t.description,
        prompt: t.prompt,
        category: t.category,
        agent: t.agent ?? "sisyphus-junior",
        skills: t.skills ?? [],
      })))

      if (addedIds.length === 0) {
        const errorList = validationErrors.length > 0
          ? `\n${validationErrors.map(e => `- ${e}`).join('\n')}`
          : ''
        return `All tasks failed validation. No parallel execution started.${errorList}`
      }

      if (validationErrors.length > 0) {
        log(`[parallel_exec] ${validationErrors.length} tasks failed validation: ${validationErrors.join('; ')}`)
      }

      // Set metadata to show progress in UI if supported
      ctx.metadata?.({
        title: `Parallel Execution: ${addedIds.length} tasks`,
        metadata: {
          task_count: addedIds.length,
          max_parallel: args.max_parallel ?? 10,
          synthesis: args.synthesis ?? false,
          run_in_background: runInBackground
        }
      })

      const validationWarning = validationErrors.length > 0
        ? `\n⚠️ ${validationErrors.length} task(s) failed validation:\n${validationErrors.map(e => `  - ${e}`).join('\n')}\n`
        : ''

      if (runInBackground) {
        await manager.registerParallelExec(coordinator, {
          description: `Parallel Execution: ${addedIds.length} tasks`,
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          parallelConfig: config
        } as any)

        saveParallelExec(coordinator)

        // Adaptive polling: estimate completion based on task count and concurrency.
        // Each wave of sub-agents typically takes 20-60s for simple file analysis.
        const waves = Math.ceil(addedIds.length / config.maxParallel)
        const estimatedMinSec = waves * 20
        const estimatedMaxSec = waves * 90

        return `Parallel execution started in background.
Task ID: ${coordinator.id}
Tasks: ${addedIds.length}
Max Parallel: ${config.maxParallel}
Synthesis: ${config.synthesis}
Estimated completion: ${estimatedMinSec}s — ${estimatedMaxSec}s (${waves} wave${waves > 1 ? 's' : ''})
${validationWarning}
**IMPORTANT**: Wait at least ${Math.max(30, estimatedMinSec)}s before your first poll.
Use background_output(task_id="${coordinator.id}") to check progress.`
      }

      // Blocking mode — skip individual task notifications since we return
      // the combined report directly from this tool call.
      coordinator.blockingMode = true
      const execStartTime = Date.now()
      try {
        await coordinator.start()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`[parallel_exec] coordinator.start() failed: ${msg}`)
        return `Parallel execution failed to start: ${msg}`
      }

      let finished = false
      while (!finished) {
        try {
          finished = await coordinator.poll()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(`[parallel_exec] coordinator.poll() failed: ${msg}`)
          return `Parallel execution failed during polling: ${msg}`
        }
        if (!finished) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
      const execElapsedMs = Date.now() - execStartTime
      const execElapsedSec = (execElapsedMs / 1000).toFixed(1)
      log(`[parallel_exec] All tasks finished in ${execElapsedSec}s (${addedIds.length} tasks, mode=${mode})`)

      const results = coordinator.getResults()
      const completed = results.filter(r => r.status === "completed")
      const failed = results.filter(r => r.status === "failed")

      let report = `# Parallel Execution Report
Total Tasks: ${results.length}
Completed: ${completed.length}
Failed: ${failed.length}
Execution Time: ${execElapsedSec}s
${validationWarning}
`

      if (args.synthesis) {
        log("[parallel_exec] Parallel execution completed, starting synthesis phase")
        const synthesizer = new ParallelSynthesizer({
          manager,
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
        })
        
        const synthesisResults = await synthesizer.synthesize(directory, results)
        
        report += `## Synthesis Results
${synthesisResults.length} files processed.

| File | Status | Detail |
|------|--------|--------|
${synthesisResults.map(r => `| ${r.filePath} | ${r.status.toUpperCase()} | ${r.resolution || r.error || "-"} |`).join("\n")}

`
      }

      report += "\n---\n\n"

      for (const res of results) {
        const logHint = res.status === "failed" && res.logDir
          ? `Logs: ${res.logDir}\n`
          : ""
        const taskDuration = res.startTime && res.endTime
          ? `Duration: ${((res.endTime - res.startTime) / 1000).toFixed(1)}s\n`
          : ""
        report += `## Task: ${res.description}
Status: ${res.status.toUpperCase()}
${taskDuration}${logHint}${res.error ? `Error: ${res.error}\n` : ""}
${res.output ? `### Output:\n${res.output}\n` : ""}
---
`
      }

      // Cleanup
      await coordinator.cleanup()

      return report
    }
  })
}


import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { CLI_LANGUAGES } from "./constants"
import { runSg } from "./cli"
import { formatSearchResult, formatReplaceResult } from "./utils"
import type { CliLanguage } from "./types"

function showOutputToUser(context: unknown, output: string): void {
  const ctx = context as { metadata?: (input: { metadata: { output: string } }) => void }
  ctx.metadata?.({ metadata: { output } })
}

function getEmptyResultHint(pattern: string, lang: CliLanguage): string | null {
  const src = pattern.trim()

  if (lang === "python") {
    if (src.startsWith("class ") && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `Hint: Remove trailing colon. Try: "${withoutColon}"`
    }
    if ((src.startsWith("def ") || src.startsWith("async def ")) && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1)
      return `Hint: Remove trailing colon. Try: "${withoutColon}"`
    }
  }

  if (["javascript", "typescript", "tsx"].includes(lang)) {
    if (/^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/i.test(src)) {
      return `Hint: Function patterns need params and body. Try "function $NAME($$$) { $$$ }"`
    }
  }

  return null
}

export const ast_grep_search: ToolDefinition = tool({
  description:
    "Search code patterns across filesystem using AST-aware matching. Supports 25 languages. " +
    "Meta-variables: $VAR matches exactly one node, $$$ matches zero-or-more nodes (variadic). " +
    "IMPORTANT: Use $$$ (triple $) for multiple arguments: 'console.log($$$)' matches any number of args. " +
    "$VAR (single $) only matches calls with exactly one argument. Do NOT use $$ (double $) — it is NOT variadic. " +
    "Patterns must be complete AST nodes. For functions: 'function $NAME($$$) { $$$ }' not 'function $NAME'. " +
    "Examples: 'console.log($$$)', 'console.log($MSG)' (single-arg only), 'async function $NAME($$$)'",
  args: {
    pattern: tool.schema.string().describe("AST pattern. Use $VAR for single node, $$$ or $$$NAME for variadic. Must be complete AST node."),
    lang: tool.schema.enum(CLI_LANGUAGES).describe("Target language"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("Paths to search (default: ['.'])"),
    globs: tool.schema.array(tool.schema.string()).optional().describe("Include/exclude globs (prefix ! to exclude)"),
    context: tool.schema.number().optional().describe("Context lines around match"),
  },
  execute: async (args, context) => {
    try {
      const result = await runSg({
        pattern: args.pattern,
        lang: args.lang as CliLanguage,
        paths: args.paths,
        globs: args.globs,
        context: args.context,
      })

      let output = formatSearchResult(result)

      if (result.matches.length === 0 && !result.error) {
        const hint = getEmptyResultHint(args.pattern, args.lang as CliLanguage)
        if (hint) {
          output += `\n\n${hint}`
        }
      }

      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})

export const ast_grep_replace: ToolDefinition = tool({
  description:
    "Replace code patterns across filesystem with AST-aware rewriting. " +
    "Pass dryRun=false to apply changes to files. Use meta-variables in rewrite to preserve matched content. " +
    "For variadic args, use NAMED meta-vars: pattern='console.log($$$ARGS)' rewrite='logger.info($$$ARGS)'. " +
    "IMPORTANT: unnamed $$$ does NOT expand in replacements — always use $$$NAME for replace. " +
    "Single-arg example: pattern='console.log($MSG)' rewrite='logger.info($MSG)' dryRun=false",
  args: {
    pattern: tool.schema.string().describe("AST pattern to match"),
    rewrite: tool.schema.string().describe("Replacement pattern (can use $VAR from pattern)"),
    lang: tool.schema.enum(CLI_LANGUAGES).describe("Target language"),
    paths: tool.schema.array(tool.schema.string()).optional().describe("Paths to search"),
    globs: tool.schema.array(tool.schema.string()).optional().describe("Include/exclude globs"),
    dryRun: tool.schema.boolean().optional().describe("Set to false to apply changes. When true (default), only preview."),
  },
  execute: async (args, context) => {
    try {
      const result = await runSg({
        pattern: args.pattern,
        rewrite: args.rewrite,
        lang: args.lang as CliLanguage,
        paths: args.paths,
        globs: args.globs,
        updateAll: args.dryRun === false,
      })
      const output = formatReplaceResult(result, args.dryRun !== false)
      showOutputToUser(context, output)
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      showOutputToUser(context, output)
      return output
    }
  },
})



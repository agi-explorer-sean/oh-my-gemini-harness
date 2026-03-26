import type {PluginInput} from '@opencode-ai/plugin';
import {log} from '@shared/logger';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';

const HOOK_NAME = 'proactive-edit-fixer';

export function createProactiveEditFixerHook(ctx: PluginInput) {
  return {
    'tool.execute.before': async (
      input: {tool: string; sessionID: string; callID: string},
      output: {args: Record<string, unknown>; message?: string},
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== 'edit') return;

      const filePath = (output.args.filePath ??
        output.args.path ??
        output.args.file) as string | undefined;
      const oldString = output.args.oldString as string | undefined;

      if (!filePath || !oldString) return;

      const absPath = resolve(ctx.directory, filePath);

      try {
        const content = await fs.readFile(absPath, 'utf-8');

        // 1. Exact match check
        if (content.includes(oldString)) {
          return;
        }

        // 2. Line-by-line fuzzy match
        // We split by newline and trim each line.
        // We also filter out empty lines to avoid matching too much.
        const oldLines = oldString
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (oldLines.length === 0) return;

        // Create a regex that matches these lines with any indentation and any line ending.
        // We allow multiple whitespaces (including newlines) between non-empty lines
        // to be more robust against minor differences.
        const pattern = oldLines
          .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .map((l) => `[ \\t]*${l}[ \\t]*`)
          .join('(?:\\s*\\r?\\n\\s*)+');

        const regex = new RegExp(pattern, 'g');
        const matches = content.match(regex);

        if (matches && matches.length === 1) {
          const actualString = matches[0];
          log(`[${HOOK_NAME}] Corrected oldString for ${filePath}`, {
            original: oldString,
            corrected: actualString,
          });
          output.args.oldString = actualString;
          return;
        }

        if (matches && matches.length > 1) {
          log(
            `[${HOOK_NAME}] Ambiguous match for ${filePath} (found ${matches.length} matches). Skipping correction.`,
          );
          return;
        }
      } catch (err: any) {
        if (err.code === 'ENOENT') return; // File not found, tool will handle it
        log(`[${HOOK_NAME}] Error processing ${filePath}:`, err);
      }
    },
  };
}

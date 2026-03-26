export interface RalphLoopArgs {
  prompt: string;
  maxIterations?: number;
  minIterations?: number;
  completionPromise?: string;
  ultrawork?: boolean;
}

const DEFAULT_PROMPT = 'Complete the task as instructed';

/**
 * Parse raw argument string from a ralph-loop or ulw-loop command.
 * Handles quoted prompts, --max-iterations, and --completion-promise flags.
 */
export function parseRalphLoopArgs(
  rawInput: string,
  options?: {ultrawork?: boolean},
): RalphLoopArgs {
  const quotedMatch = rawInput.match(/^["'](.+?)["']/);
  const prompt =
    quotedMatch?.[1] || rawInput.split(/\s+--/)[0]?.trim() || DEFAULT_PROMPT;

  const maxIterMatch = rawInput.match(/--max-iterations=(\d+)/i);
  const minIterMatch = rawInput.match(/--min-iterations=(\d+)/i);
  const promiseMatch = rawInput.match(
    /--completion-promise=["']?([^"'\s]+)["']?/i,
  );

  return {
    prompt,
    maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
    minIterations: minIterMatch ? parseInt(minIterMatch[1], 10) : undefined,
    completionPromise: promiseMatch?.[1],
    ultrawork: options?.ultrawork,
  };
}

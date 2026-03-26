// Parses Ollama NDJSON streaming responses (issue #1124)
import {log} from './logger';

export interface OllamaMessage {
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
  content?: string;
}

export interface OllamaNDJSONLine {
  message?: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaMergedResponse {
  message: OllamaMessage;
  done: boolean;
  stats?: {
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
  };
}

// Merges all NDJSON lines into a single response (tool_calls + content concatenated)
export function parseOllamaStreamResponse(
  response: string,
): OllamaMergedResponse {
  const lines = response.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('No valid NDJSON lines found in response');
  }

  const mergedMessage: OllamaMessage = {
    tool_calls: [],
    content: '',
  };

  let done = false;
  let stats: OllamaMergedResponse['stats'] = {};

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as OllamaNDJSONLine;

      if (json.message?.tool_calls) {
        mergedMessage.tool_calls = [
          ...(mergedMessage.tool_calls || []),
          ...json.message.tool_calls,
        ];
      }

      if (json.message?.content) {
        mergedMessage.content =
          (mergedMessage.content || '') + json.message.content;
      }

      if (json.done) {
        done = true;
        stats = {
          total_duration: json.total_duration,
          load_duration: json.load_duration,
          prompt_eval_count: json.prompt_eval_count,
          prompt_eval_duration: json.prompt_eval_duration,
          eval_count: json.eval_count,
          eval_duration: json.eval_duration,
        };
      }
    } catch (error) {
      log(`[ollama-ndjson-parser] Skipping malformed NDJSON line: ${line}`, {
        error,
      });
      continue;
    }
  }

  return {
    message: mergedMessage,
    done,
    ...(Object.keys(stats).length > 0 ? {stats} : {}),
  };
}

export function isNDJSONResponse(response: string): boolean {
  const lines = response.split('\n').filter((line) => line.trim());

  if (lines.length <= 1) {
    return false;
  }

  let hasValidJSON = false;
  let hasDoneField = false;

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as Record<string, unknown>;
      hasValidJSON = true;

      if ('done' in json) {
        hasDoneField = true;
      }
    } catch {
      return false;
    }
  }

  return hasValidJSON && hasDoneField;
}

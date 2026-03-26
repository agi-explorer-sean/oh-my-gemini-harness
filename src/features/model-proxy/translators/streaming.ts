import type {
  GeminiGenerateContentResponse,
  GeminiPart,
  AnthropicStreamEvent,
} from '../types';
import {log} from '../../../shared/logger';

// ---------------------------------------------------------------------------
// Streaming translator: Anthropic SSE → Gemini SSE
//
// Anthropic sends block-level events (message_start, content_block_start,
// content_block_delta, content_block_stop, message_delta, message_stop).
//
// Gemini sends incremental chunks where each chunk is a partial
// GeminiGenerateContentResponse with candidates[0].content.parts.
// ---------------------------------------------------------------------------

interface StreamState {
  inputTokens: number;
  outputTokens: number;
  currentBlocks: Map<number, {type: string; text?: string; toolName?: string; toolId?: string; partialJson?: string}>;
}

export function createStreamState(): StreamState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    currentBlocks: new Map(),
  };
}

/**
 * Parse a single Anthropic SSE event line and return a Gemini-format chunk
 * (or null if the event doesn't produce a chunk).
 */
export function translateStreamEvent(
  event: AnthropicStreamEvent,
  state: StreamState,
): GeminiGenerateContentResponse | null {
  switch (event.type) {
    case 'message_start': {
      // Buffer usage info
      if (event.message?.usage) {
        state.inputTokens = event.message.usage.input_tokens ?? 0;
      }
      return null;
    }

    case 'content_block_start': {
      const block = event.content_block;
      if (block.type === 'text') {
        state.currentBlocks.set(event.index, {type: 'text', text: ''});
      } else if (block.type === 'tool_use') {
        const toolUse = block as {type: 'tool_use'; id: string; name: string};
        state.currentBlocks.set(event.index, {
          type: 'tool_use',
          toolName: toolUse.name,
          toolId: toolUse.id,
          partialJson: '',
        });
      }
      return null;
    }

    case 'content_block_delta': {
      const delta = event.delta;
      const blockState = state.currentBlocks.get(event.index);

      if (delta.type === 'text_delta') {
        if (blockState) blockState.text = (blockState.text ?? '') + delta.text;

        // Emit a Gemini chunk for each text delta
        const parts: GeminiPart[] = [{text: delta.text}];
        return {
          candidates: [
            {
              content: {role: 'model', parts},
              index: 0,
            },
          ],
        };
      }

      if (delta.type === 'input_json_delta') {
        if (blockState) {
          blockState.partialJson =
            (blockState.partialJson ?? '') + delta.partial_json;
        }
        // Don't emit chunks for partial JSON — wait for content_block_stop
        return null;
      }

      return null;
    }

    case 'content_block_stop': {
      const blockState = state.currentBlocks.get(event.index);
      if (!blockState) return null;

      // For tool_use blocks, emit the complete function call
      if (blockState.type === 'tool_use' && blockState.toolName) {
        let args: Record<string, unknown> = {};
        if (blockState.partialJson) {
          try {
            args = JSON.parse(blockState.partialJson);
          } catch (err) {
            log('[model-proxy] Failed to parse tool call JSON:', blockState.partialJson);
            args = {};
          }
        }

        const parts: GeminiPart[] = [
          {
            functionCall: {
              name: blockState.toolName,
              args,
            },
          },
        ];
        state.currentBlocks.delete(event.index);
        return {
          candidates: [
            {
              content: {role: 'model', parts},
              index: 0,
            },
          ],
        };
      }

      state.currentBlocks.delete(event.index);
      return null;
    }

    case 'message_delta': {
      state.outputTokens = event.usage?.output_tokens ?? state.outputTokens;

      // Emit final chunk with finish reason and usage
      return {
        candidates: [
          {
            content: {role: 'model', parts: []},
            finishReason: translateStreamStopReason(event.delta?.stop_reason),
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: state.inputTokens,
          candidatesTokenCount: state.outputTokens,
          totalTokenCount: state.inputTokens + state.outputTokens,
        },
      };
    }

    case 'message_stop':
      return null;

    default:
      return null;
  }
}

function translateStreamStopReason(reason: string | null): string {
  switch (reason) {
    case 'end_turn':
      return 'STOP';
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'stop_sequence':
      return 'STOP';
    case 'tool_use':
      return 'STOP';
    default:
      return 'STOP';
  }
}

/**
 * Parse Anthropic SSE stream and yield Gemini-format SSE lines.
 */
export async function* translateAnthropicStreamToGemini(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const state = createStreamState();
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = stream.getReader();

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, {stream: true});

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete last line

      let currentEventType = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
          continue;
        }

        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;
            // If we have an event type from a preceding event: line, use it
            if (currentEventType && !event.type) {
              (event as {type: string}).type = currentEventType;
            }
            currentEventType = '';

            const geminiChunk = translateStreamEvent(event, state);
            if (geminiChunk) {
              yield `data: ${JSON.stringify(geminiChunk)}\n\n`;
            }
          } catch (err) {
            log(`[model-proxy] Failed to parse SSE data: ${data}`, err);
          }
        }

        if (line.trim() === '') {
          currentEventType = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

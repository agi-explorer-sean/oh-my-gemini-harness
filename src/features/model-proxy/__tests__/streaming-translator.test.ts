import {describe, expect, test} from 'bun:test';
import {
  createStreamState,
  translateStreamEvent,
} from '../translators/streaming';
import type {AnthropicStreamEvent} from '../types';

describe('translateStreamEvent', () => {
  test('message_start buffers usage and returns null', () => {
    const state = createStreamState();
    const event: AnthropicStreamEvent = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-opus-4-6',
        stop_reason: null,
        stop_sequence: null,
        usage: {input_tokens: 42, output_tokens: 0},
      },
    };

    const result = translateStreamEvent(event, state);
    expect(result).toBeNull();
    expect(state.inputTokens).toBe(42);
  });

  test('content_block_start for text returns null', () => {
    const state = createStreamState();
    const event: AnthropicStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: {type: 'text', text: ''},
    };

    const result = translateStreamEvent(event, state);
    expect(result).toBeNull();
    expect(state.currentBlocks.has(0)).toBe(true);
  });

  test('text_delta emits Gemini text chunk', () => {
    const state = createStreamState();
    state.currentBlocks.set(0, {type: 'text', text: ''});

    const event: AnthropicStreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: {type: 'text_delta', text: 'Hello'},
    };

    const result = translateStreamEvent(event, state);
    expect(result).not.toBeNull();
    expect(result!.candidates![0].content.parts).toEqual([{text: 'Hello'}]);
  });

  test('input_json_delta buffers and returns null', () => {
    const state = createStreamState();
    state.currentBlocks.set(0, {
      type: 'tool_use',
      toolName: 'read_file',
      toolId: 'toolu_1',
      partialJson: '',
    });

    const event: AnthropicStreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: {type: 'input_json_delta', partial_json: '{"path":'},
    };

    const result = translateStreamEvent(event, state);
    expect(result).toBeNull();
    expect(state.currentBlocks.get(0)!.partialJson).toBe('{"path":');
  });

  test('content_block_stop for tool_use emits functionCall', () => {
    const state = createStreamState();
    state.currentBlocks.set(0, {
      type: 'tool_use',
      toolName: 'read_file',
      toolId: 'toolu_1',
      partialJson: '{"path":"foo.ts"}',
    });

    const event: AnthropicStreamEvent = {
      type: 'content_block_stop',
      index: 0,
    };

    const result = translateStreamEvent(event, state);
    expect(result).not.toBeNull();
    expect(result!.candidates![0].content.parts).toEqual([
      {functionCall: {name: 'read_file', args: {path: 'foo.ts'}}},
    ]);
    expect(state.currentBlocks.has(0)).toBe(false);
  });

  test('content_block_stop for text returns null', () => {
    const state = createStreamState();
    state.currentBlocks.set(0, {type: 'text', text: 'Hello world'});

    const event: AnthropicStreamEvent = {
      type: 'content_block_stop',
      index: 0,
    };

    const result = translateStreamEvent(event, state);
    expect(result).toBeNull();
  });

  test('message_delta emits finish reason and usage', () => {
    const state = createStreamState();
    state.inputTokens = 100;

    const event: AnthropicStreamEvent = {
      type: 'message_delta',
      delta: {stop_reason: 'end_turn', stop_sequence: null},
      usage: {output_tokens: 50},
    };

    const result = translateStreamEvent(event, state);
    expect(result).not.toBeNull();
    expect(result!.candidates![0].finishReason).toBe('STOP');
    expect(result!.usageMetadata).toEqual({
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
  });

  test('message_delta translates max_tokens to MAX_TOKENS', () => {
    const state = createStreamState();
    const event: AnthropicStreamEvent = {
      type: 'message_delta',
      delta: {stop_reason: 'max_tokens', stop_sequence: null},
      usage: {output_tokens: 8192},
    };

    const result = translateStreamEvent(event, state);
    expect(result!.candidates![0].finishReason).toBe('MAX_TOKENS');
  });

  test('message_stop returns null', () => {
    const state = createStreamState();
    const event: AnthropicStreamEvent = {
      type: 'message_stop',
    };

    const result = translateStreamEvent(event, state);
    expect(result).toBeNull();
  });

  test('full text streaming sequence', () => {
    const state = createStreamState();

    // message_start
    translateStreamEvent(
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4-6',
          stop_reason: null,
          stop_sequence: null,
          usage: {input_tokens: 10, output_tokens: 0},
        },
      },
      state,
    );

    // content_block_start
    translateStreamEvent(
      {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
      state,
    );

    // text deltas
    const chunk1 = translateStreamEvent(
      {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Hello'}},
      state,
    );
    expect(chunk1!.candidates![0].content.parts[0].text).toBe('Hello');

    const chunk2 = translateStreamEvent(
      {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: ' world'}},
      state,
    );
    expect(chunk2!.candidates![0].content.parts[0].text).toBe(' world');

    // content_block_stop
    translateStreamEvent({type: 'content_block_stop', index: 0}, state);

    // message_delta
    const final = translateStreamEvent(
      {
        type: 'message_delta',
        delta: {stop_reason: 'end_turn', stop_sequence: null},
        usage: {output_tokens: 5},
      },
      state,
    );
    expect(final!.candidates![0].finishReason).toBe('STOP');
    expect(final!.usageMetadata!.promptTokenCount).toBe(10);
    expect(final!.usageMetadata!.candidatesTokenCount).toBe(5);
  });

  test('tool_use streaming with invalid JSON gracefully handles error', () => {
    const state = createStreamState();
    state.currentBlocks.set(0, {
      type: 'tool_use',
      toolName: 'my_tool',
      toolId: 'toolu_2',
      partialJson: '{invalid json',
    });

    const result = translateStreamEvent(
      {type: 'content_block_stop', index: 0},
      state,
    );
    // Should still emit functionCall with empty args
    expect(result!.candidates![0].content.parts[0].functionCall!.args).toEqual({});
  });
});

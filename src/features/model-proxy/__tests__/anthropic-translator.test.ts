import {describe, expect, test, beforeEach} from 'bun:test';
import {
  geminiRequestToAnthropic,
  anthropicResponseToGemini,
  resetToolCallCounter,
} from '../translators/anthropic';
import type {
  GeminiGenerateContentRequest,
  AnthropicMessagesResponse,
} from '../types';

beforeEach(() => {
  resetToolCallCounter();
});

describe('geminiRequestToAnthropic', () => {
  test('translates basic text message', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {
          role: 'user',
          parts: [{text: 'Hello, Claude!'}],
        },
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.model).toBe('claude-opus-4-6');
    expect(result.max_tokens).toBe(8192);
    expect(result.stream).toBe(false);
    expect(result.anthropic_version).toBe('vertex-2023-10-16');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toEqual([
      {type: 'text', text: 'Hello, Claude!'},
    ]);
  });

  test('translates system instruction', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      systemInstruction: {
        parts: [{text: 'You are a helpful assistant'}],
      },
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.system).toBe('You are a helpful assistant');
  });

  test('translates multi-part system instruction', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      systemInstruction: {
        parts: [{text: 'Part 1'}, {text: 'Part 2'}],
      },
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.system).toBe('Part 1\nPart 2');
  });

  test('translates generation config', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      generationConfig: {
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 4096,
        stopSequences: ['END'],
      },
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    // When both temperature and topP are set, temperature takes priority
    // (Claude doesn't allow both simultaneously)
    expect(result.temperature).toBe(0.5);
    expect(result.top_p).toBeUndefined();
    expect(result.top_k).toBe(40);
    expect(result.max_tokens).toBe(4096);
    expect(result.stop_sequences).toEqual(['END']);
  });

  test('uses top_p when temperature is not set', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      generationConfig: {
        topP: 0.9,
      },
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.temperature).toBeUndefined();
    expect(result.top_p).toBe(0.9);
  });

  test('translates tools / function declarations', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Read foo.ts'}]}],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file from disk',
              parameters: {
                type: 'object',
                properties: {
                  path: {type: 'string', description: 'File path'},
                },
                required: ['path'],
              },
            },
          ],
        },
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('read_file');
    expect(result.tools![0].description).toBe('Read a file from disk');
    expect(result.tools![0].input_schema).toEqual({
      type: 'object',
      properties: {
        path: {type: 'string', description: 'File path'},
      },
      required: ['path'],
    });
  });

  test('strips Gemini-only tools (googleSearch, codeExecution)', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Search for something'}]}],
      tools: [
        {googleSearch: {}},
        {codeExecution: {}},
        {
          functionDeclarations: [
            {name: 'my_tool', parameters: {type: 'object', properties: {}}},
          ],
        },
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].name).toBe('my_tool');
  });

  test('translates image content', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {
          role: 'user',
          parts: [
            {text: 'Describe this image'},
            {inlineData: {mimeType: 'image/png', data: 'base64data'}},
          ],
        },
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.messages[0].content).toEqual([
      {type: 'text', text: 'Describe this image'},
      {
        type: 'image',
        source: {type: 'base64', media_type: 'image/png', data: 'base64data'},
      },
    ]);
  });

  test('translates multi-turn conversation with function call and response', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {role: 'user', parts: [{text: 'Read foo.ts'}]},
        {
          role: 'model',
          parts: [
            {functionCall: {name: 'read_file', args: {path: 'foo.ts'}}},
          ],
        },
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: {content: 'console.log("hello")'},
              },
            },
          ],
        },
        {role: 'model', parts: [{text: 'The file contains a console.log statement.'}]},
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    // Should have: user, assistant (tool_use), user (tool_result), assistant (text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[2].role).toBe('user');
    expect(result.messages[3].role).toBe('assistant');

    // Check tool_use
    const assistantContent = result.messages[1].content as any[];
    expect(assistantContent[0].type).toBe('tool_use');
    expect(assistantContent[0].name).toBe('read_file');
    expect(assistantContent[0].input).toEqual({path: 'foo.ts'});

    // Check tool_result
    const toolResultContent = result.messages[2].content as any[];
    expect(toolResultContent[0].type).toBe('tool_result');
    expect(toolResultContent[0].tool_use_id).toBe(assistantContent[0].id);
  });

  test('merges consecutive same-role messages', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {role: 'user', parts: [{text: 'Part 1'}]},
        {role: 'user', parts: [{text: 'Part 2'}]},
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const content = result.messages[0].content as any[];
    expect(content).toHaveLength(2);
    expect(content[0].text).toBe('Part 1');
    expect(content[1].text).toBe('Part 2');
  });

  test('injects synthetic tool_result for orphaned tool_use', () => {
    // Simulates a failed tool call: model emits functionCall but no
    // functionResponse follows (e.g. MCP server error)
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {role: 'user', parts: [{text: 'Help me'}]},
        {
          role: 'model',
          parts: [
            {functionCall: {name: 'cli_help', args: {query: 'model'}}},
          ],
        },
        // No function response — tool failed
        {role: 'user', parts: [{text: 'Try again please'}]},
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    // Should have: user, assistant(tool_use), user(tool_result + text), NOT crash
    expect(result.messages.length).toBeGreaterThanOrEqual(3);

    // The user message after the assistant tool_use should contain a tool_result
    const userAfterToolUse = result.messages[2];
    expect(userAfterToolUse.role).toBe('user');
    const blocks = userAfterToolUse.content as any[];
    const toolResult = blocks.find((b: any) => b.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.content).toContain('cli_help');
  });

  test('injects synthetic tool_result when no user message follows', () => {
    // Model's last message has a tool_use but conversation ends there
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [
        {role: 'user', parts: [{text: 'Help me'}]},
        {
          role: 'model',
          parts: [
            {functionCall: {name: 'broken_tool', args: {}}},
          ],
        },
      ],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);

    // Should inject a user message with tool_result
    expect(result.messages).toHaveLength(3);
    const injected = result.messages[2];
    expect(injected.role).toBe('user');
    const blocks = injected.content as any[];
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].is_error).toBe(true);
  });

  test('sets stream flag', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', true);
    expect(result.stream).toBe(true);
  });

  test('translates tool_choice AUTO', () => {
    const geminiReq: GeminiGenerateContentRequest = {
      contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      toolConfig: {functionCallingConfig: {mode: 'AUTO'}},
    };

    const result = geminiRequestToAnthropic(geminiReq, 'claude-opus-4-6', false);
    expect(result.tool_choice).toEqual({type: 'auto'});
  });
});

describe('anthropicResponseToGemini', () => {
  test('translates text response', () => {
    const anthropicResp: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{type: 'text', text: 'Hello!'}],
      model: 'claude-opus-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {input_tokens: 10, output_tokens: 5},
    };

    const result = anthropicResponseToGemini(anthropicResp);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates![0].content.role).toBe('model');
    expect(result.candidates![0].content.parts).toEqual([
      {text: 'Hello!'},
    ]);
    expect(result.candidates![0].finishReason).toBe('STOP');
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  test('translates tool_use response', () => {
    const anthropicResp: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        {type: 'text', text: 'Let me read that file.'},
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'read_file',
          input: {path: 'foo.ts'},
        },
      ],
      model: 'claude-opus-4-6',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {input_tokens: 20, output_tokens: 30},
    };

    const result = anthropicResponseToGemini(anthropicResp);

    expect(result.candidates![0].content.parts).toEqual([
      {text: 'Let me read that file.'},
      {functionCall: {name: 'read_file', args: {path: 'foo.ts'}}},
    ]);
  });

  test('translates max_tokens stop reason', () => {
    const anthropicResp: AnthropicMessagesResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [{type: 'text', text: 'Truncated...'}],
      model: 'claude-opus-4-6',
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: {input_tokens: 10, output_tokens: 100},
    };

    const result = anthropicResponseToGemini(anthropicResp);

    expect(result.candidates![0].finishReason).toBe('MAX_TOKENS');
  });
});

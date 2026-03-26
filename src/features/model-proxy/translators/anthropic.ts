import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiContent,
  GeminiPart,
  GeminiCandidate,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolDefinition,
  AnthropicTextContent,
  AnthropicToolUseContent,
} from '../types';
import {log} from '../../../shared/logger';

// ---------------------------------------------------------------------------
// Tool use ID generation
// ---------------------------------------------------------------------------

let toolCallCounter = 0;

function generateToolUseId(name: string): string {
  toolCallCounter++;
  return `toolu_proxy_${name}_${toolCallCounter}_${Date.now().toString(36)}`;
}

export function resetToolCallCounter(): void {
  toolCallCounter = 0;
}

// ---------------------------------------------------------------------------
// Request translation: Gemini → Anthropic
// ---------------------------------------------------------------------------

function translatePart(part: GeminiPart): AnthropicContentBlock | null {
  if (part.text !== undefined) {
    return {type: 'text', text: part.text};
  }
  if (part.inlineData) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: part.inlineData.mimeType,
        data: part.inlineData.data,
      },
    };
  }
  // functionCall and functionResponse are handled at the message level
  return null;
}

function translateGeminiContentToAnthropicMessages(
  contents: GeminiContent[],
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  for (const content of contents) {
    const role = content.role === 'model' ? 'assistant' : 'user';

    // Check for function calls (model role) and function responses (function role)
    if (content.role === 'model') {
      const blocks: AnthropicContentBlock[] = [];
      for (const part of content.parts) {
        if (part.text !== undefined) {
          blocks.push({type: 'text', text: part.text});
        } else if (part.functionCall) {
          blocks.push({
            type: 'tool_use',
            id: generateToolUseId(part.functionCall.name),
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }
      }
      if (blocks.length > 0) {
        messages.push({role: 'assistant', content: blocks});
      }
    } else if (content.role === 'function') {
      // Gemini function responses → Anthropic tool_result
      const blocks: AnthropicContentBlock[] = [];
      for (const part of content.parts) {
        if (part.functionResponse) {
          // Find the matching tool_use_id from the previous assistant message
          const toolUseId = findToolUseIdByName(
            messages,
            part.functionResponse.name,
          );
          blocks.push({
            type: 'tool_result',
            tool_use_id: toolUseId ?? `unknown_${part.functionResponse.name}`,
            content: JSON.stringify(part.functionResponse.response),
          });
        }
      }
      if (blocks.length > 0) {
        messages.push({role: 'user', content: blocks});
      }
    } else {
      // User content
      const blocks: AnthropicContentBlock[] = [];
      for (const part of content.parts) {
        const block = translatePart(part);
        if (block) blocks.push(block);
      }
      if (blocks.length > 0) {
        messages.push({role, content: blocks});
      }
    }
  }

  // Inject synthetic tool_result for any orphaned tool_use blocks.
  // This happens when Gemini tool calls fail (e.g. MCP server errors) and
  // no functionResponse is sent back. Claude requires every tool_use to have
  // a matching tool_result immediately after.
  const patched = injectMissingToolResults(messages);

  // Merge consecutive messages with the same role (Anthropic requires alternating roles)
  return mergeConsecutiveSameRole(patched);
}

function injectMissingToolResults(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);

    // Check if this assistant message contains tool_use blocks
    if (msg.role !== 'assistant') continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolUseIds: Array<{id: string; name: string}> = [];
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        toolUseIds.push({id: block.id, name: block.name});
      }
    }
    if (toolUseIds.length === 0) continue;

    // Check if the next message is a user message with matching tool_results
    const next = messages[i + 1];
    const nextBlocks =
      next?.role === 'user' && Array.isArray(next.content)
        ? next.content
        : [];
    const resolvedIds = new Set<string>();
    for (const block of nextBlocks) {
      if (block.type === 'tool_result') {
        resolvedIds.add(block.tool_use_id);
      }
    }

    // Find orphaned tool_use ids (no matching tool_result)
    const orphaned = toolUseIds.filter((t) => !resolvedIds.has(t.id));
    if (orphaned.length === 0) continue;

    log(
      `[model-proxy] Injecting ${orphaned.length} synthetic tool_result(s) for orphaned tool_use`,
    );

    const syntheticResults: AnthropicContentBlock[] = orphaned.map((t) => ({
      type: 'tool_result' as const,
      tool_use_id: t.id,
      content: `Tool call "${t.name}" failed: no response received`,
      is_error: true,
    }));

    // If the next message is already a user message, prepend the synthetic results
    if (next?.role === 'user') {
      const existingBlocks = Array.isArray(next.content)
        ? next.content
        : [{type: 'text' as const, text: next.content}];
      next.content = [...syntheticResults, ...existingBlocks];
    } else {
      // No user message follows — inject a new user message with just the tool_results
      result.push({role: 'user', content: syntheticResults});
    }
  }

  return result;
}

function mergeConsecutiveSameRole(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  if (messages.length === 0) return [];

  const merged: AnthropicMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = messages[i];

    if (prev.role === curr.role) {
      // Merge content blocks
      const prevBlocks = Array.isArray(prev.content)
        ? prev.content
        : [{type: 'text' as const, text: prev.content}];
      const currBlocks = Array.isArray(curr.content)
        ? curr.content
        : [{type: 'text' as const, text: curr.content}];
      prev.content = [...prevBlocks, ...currBlocks];
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

function findToolUseIdByName(
  messages: AnthropicMessage[],
  functionName: string,
): string | null {
  // Search backwards through messages for the most recent tool_use with this name
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === 'tool_use' && block.name === functionName) {
        return block.id;
      }
    }
  }
  return null;
}

function translateToolConfig(
  geminiReq: GeminiGenerateContentRequest,
): {tool_choice?: {type: string; name?: string}} {
  const config = geminiReq.toolConfig?.functionCallingConfig;
  if (!config?.mode) return {};

  switch (config.mode) {
    case 'AUTO':
      return {tool_choice: {type: 'auto'}};
    case 'ANY':
      if (config.allowedFunctionNames?.length === 1) {
        return {
          tool_choice: {type: 'tool', name: config.allowedFunctionNames[0]},
        };
      }
      return {tool_choice: {type: 'any'}};
    case 'NONE':
      // Anthropic doesn't have a "none" tool_choice, just omit tools
      return {};
    default:
      return {};
  }
}

export function geminiRequestToAnthropic(
  geminiReq: GeminiGenerateContentRequest,
  model: string,
  stream: boolean,
): AnthropicMessagesRequest {
  // Reset tool call counter for each new request
  resetToolCallCounter();

  // Extract system instruction
  let system: string | undefined;
  if (geminiReq.systemInstruction?.parts) {
    const textParts = geminiReq.systemInstruction.parts
      .filter((p) => p.text !== undefined)
      .map((p) => p.text!);
    if (textParts.length > 0) {
      system = textParts.join('\n');
    }
  }

  // Translate messages
  const messages = translateGeminiContentToAnthropicMessages(
    geminiReq.contents,
  );

  // Translate tools
  let tools: AnthropicToolDefinition[] | undefined;
  if (geminiReq.tools) {
    tools = [];
    for (const tool of geminiReq.tools) {
      // Skip Gemini-only tools
      if (tool.googleSearch || tool.codeExecution) {
        log('[model-proxy] Stripping Gemini-only tool (googleSearch/codeExecution)');
        continue;
      }
      if (tool.functionDeclarations) {
        for (const fn of tool.functionDeclarations) {
          tools.push({
            name: fn.name,
            description: fn.description,
            input_schema: fn.parameters ?? {type: 'object', properties: {}},
          });
        }
      }
    }
    if (tools.length === 0) tools = undefined;
  }

  // Translate generation config
  const config = geminiReq.generationConfig;
  const maxTokens = config?.maxOutputTokens ?? 8192;

  const request: AnthropicMessagesRequest = {
    model,
    max_tokens: maxTokens,
    messages,
    stream,
    anthropic_version: 'vertex-2023-10-16',
  };

  if (system) request.system = system;
  if (tools) request.tools = tools;
  // Claude doesn't allow both temperature and top_p simultaneously.
  // Prefer temperature when both are provided.
  if (config?.temperature !== undefined) {
    request.temperature = config.temperature;
  } else if (config?.topP !== undefined) {
    request.top_p = config.topP;
  }
  if (config?.topK !== undefined) request.top_k = config.topK;
  if (config?.stopSequences) request.stop_sequences = config.stopSequences;

  // Translate tool config
  const toolChoice = translateToolConfig(geminiReq);
  if (toolChoice.tool_choice) request.tool_choice = toolChoice.tool_choice;

  return request;
}

// ---------------------------------------------------------------------------
// Response translation: Anthropic → Gemini
// ---------------------------------------------------------------------------

function translateAnthropicBlockToGeminiPart(
  block: AnthropicContentBlock,
): GeminiPart | null {
  switch (block.type) {
    case 'text':
      return {text: (block as AnthropicTextContent).text};
    case 'tool_use': {
      const toolUse = block as AnthropicToolUseContent;
      return {
        functionCall: {
          name: toolUse.name,
          args: toolUse.input,
        },
      };
    }
    default:
      return null;
  }
}

function translateStopReason(stopReason: string | null): string {
  switch (stopReason) {
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

export function anthropicResponseToGemini(
  anthropicResp: AnthropicMessagesResponse,
): GeminiGenerateContentResponse {
  const parts: GeminiPart[] = [];

  for (const block of anthropicResp.content) {
    const part = translateAnthropicBlockToGeminiPart(block);
    if (part) parts.push(part);
  }

  const candidate: GeminiCandidate = {
    content: {
      role: 'model',
      parts,
    },
    finishReason: translateStopReason(anthropicResp.stop_reason),
    index: 0,
  };

  return {
    candidates: [candidate],
    usageMetadata: {
      promptTokenCount: anthropicResp.usage.input_tokens,
      candidatesTokenCount: anthropicResp.usage.output_tokens,
      totalTokenCount:
        anthropicResp.usage.input_tokens + anthropicResp.usage.output_tokens,
    },
  };
}

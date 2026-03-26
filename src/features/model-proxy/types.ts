// Gemini generateContent API wire format types
// Reference: https://ai.google.dev/api/generate-content

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
  googleSearch?: Record<string, unknown>;
  codeExecution?: Record<string, unknown>;
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  thinkingConfig?: {
    thinkingBudget?: number;
    includeThoughts?: boolean;
  };
}

export interface GeminiGenerateContentRequest {
  model?: string;
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: string;
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: GeminiGenerationConfig;
  cachedContent?: string;
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  index?: number;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

// Anthropic Messages API wire format types
// Reference: https://docs.anthropic.com/en/api/messages

export interface AnthropicTextContent {
  type: 'text';
  text: string;
}

export interface AnthropicImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface AnthropicToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextContent
  | AnthropicImageContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: string; name?: string };
  stream?: boolean;
  anthropic_version?: string;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Anthropic SSE streaming event types

export interface AnthropicStreamMessageStart {
  type: 'message_start';
  message: Omit<AnthropicMessagesResponse, 'content'> & {
    content: [];
  };
}

export interface AnthropicStreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicStreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string };
}

export interface AnthropicStreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicStreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface AnthropicStreamMessageStop {
  type: 'message_stop';
}

export type AnthropicStreamEvent =
  | AnthropicStreamMessageStart
  | AnthropicStreamContentBlockStart
  | AnthropicStreamContentBlockDelta
  | AnthropicStreamContentBlockStop
  | AnthropicStreamMessageDelta
  | AnthropicStreamMessageStop;

// Proxy internal types

export interface ProxyConfig {
  /** Port for the translation proxy (0 = OS-assigned) */
  port: number;
  /** Upstream Gemini proxy address (for pass-through) */
  upstreamUrl: string;
  /** GCP project for Vertex AI */
  gcpProject: string;
  /** GCP location for Vertex AI Claude endpoints */
  gcpLocation: string;
  /** Known Claude model name prefixes */
  claudeModelPrefixes: string[];
}

export const DEFAULT_CLAUDE_MODEL_PREFIXES = [
  'claude-',
];

export const CLAUDE_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
]);

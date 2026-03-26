import type {
  GeminiGenerateContentRequest,
  ProxyConfig,
} from './types';
import {DEFAULT_CLAUDE_MODEL_PREFIXES} from './types';
import {
  geminiRequestToAnthropic,
  anthropicResponseToGemini,
} from './translators/anthropic';
import {translateAnthropicStreamToGemini} from './translators/streaming';
import {callVertexAIClaude} from './auth/vertex';
import {log} from '../../shared/logger';

// ---------------------------------------------------------------------------
// Model Proxy Server
//
// A Bun HTTP server that intercepts Gemini API requests, routes Claude model
// requests through format translation to Vertex AI's rawPredict endpoint,
// and passes Gemini model requests through to the upstream gemini_api_proxy.
// ---------------------------------------------------------------------------

export class ModelProxyServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  get port(): number {
    return this.server?.port ?? 0;
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  start(): void {
    this.server = Bun.serve({
      port: this.config.port,
      fetch: (req) => this.handleRequest(req),
    });
    log(
      `[model-proxy] Started on port ${this.server.port}, upstream: ${this.config.upstreamUrl}`,
    );
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      log('[model-proxy] Stopped');
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check endpoint (required by Gemini CLI wrapper)
    if (path === '/healthz') {
      return new Response('ok', {status: 200});
    }

    // Silently accept telemetry/logging requests from Gemini CLI
    if (path === '/logevent') {
      return new Response('', {status: 200});
    }

    log(`[model-proxy] Request: ${req.method} ${path}`);

    // Intercept generateContent and streamGenerateContent in two URL formats:
    // 1. Standard API: /v1beta/models/{model}:generateContent
    // 2. Vertex AI:    /v1beta1/projects/.../models/{model}:generateContent
    // Match multiple API version prefixes:
    // - /v1beta/  (public API)
    // - /v1beta1/ (Vertex SDK)
    // - /v1main/  
    // - /v1/      (stable API)
    const standardMatch = path.match(
      /\/v1(?:beta\d?|main)?\/models\/([^:]+):(?:(stream)G|g)enerateContent/,
    );
    const vertexMatch = !standardMatch
      ? path.match(
          /\/v1(?:beta\d?|main)?\/projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\/([^:]+):(?:(stream)G|g)enerateContent/,
        )
      : null;

    const generateMatch = standardMatch ?? vertexMatch;

    if (!generateMatch) {
      // Pass through non-generate requests (list models, etc.)
      return this.passThrough(req);
    }

    const modelName = generateMatch[1];
    const isStream = !!generateMatch[2];

    if (this.isClaudeModel(modelName)) {
      try {
        return await this.handleClaudeRequest(req, modelName, isStream);
      } catch (err) {
        log('[model-proxy] Claude request error:', err);
        return this.createErrorResponse(err);
      }
    }

    // Gemini model — pass through to upstream
    return this.passThrough(req);
  }

  private isClaudeModel(model: string): boolean {
    const prefixes =
      this.config.claudeModelPrefixes ?? DEFAULT_CLAUDE_MODEL_PREFIXES;
    return prefixes.some((prefix) => model.startsWith(prefix));
  }

  private async handleClaudeRequest(
    req: Request,
    model: string,
    isStream: boolean,
  ): Promise<Response> {
    // Parse Gemini request body
    const geminiReq = (await req.json()) as GeminiGenerateContentRequest;

    log(`[model-proxy] Translating Gemini→Anthropic for model: ${model}`, {
      isStream,
      contentCount: geminiReq.contents?.length,
      hasSystemInstruction: !!geminiReq.systemInstruction,
      hasTools: !!geminiReq.tools,
    });

    // Translate to Anthropic format
    const anthropicReq = geminiRequestToAnthropic(geminiReq, model, isStream);

    // Call Vertex AI rawPredict
    const vertexResp = await callVertexAIClaude(
      this.config.gcpProject,
      this.config.gcpLocation,
      model,
      anthropicReq as unknown as Record<string, unknown>,
      isStream,
    );

    if (isStream) {
      return this.handleStreamingResponse(vertexResp);
    }

    return this.handleNonStreamingResponse(vertexResp);
  }

  private async handleNonStreamingResponse(
    vertexResp: Response,
  ): Promise<Response> {
    const anthropicResp = await vertexResp.json();

    log('[model-proxy] Translating Anthropic→Gemini response:', {
      contentLength: (anthropicResp as {content?: unknown[]}).content?.length,
      stopReason: (anthropicResp as {stop_reason?: string}).stop_reason,
    });

    const geminiResp = anthropicResponseToGemini(anthropicResp as any);

    return new Response(JSON.stringify(geminiResp), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  }

  private async handleStreamingResponse(
    vertexResp: Response,
  ): Promise<Response> {
    if (!vertexResp.body) {
      throw new Error('Streaming response has no body');
    }

    log('[model-proxy] Starting SSE stream translation');

    // Create a TransformStream to translate SSE events
    const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process the stream in the background
    (async () => {
      try {
        for await (const chunk of translateAnthropicStreamToGemini(
          vertexResp.body!,
        )) {
          await writer.write(encoder.encode(chunk));
        }
      } catch (err) {
        log('[model-proxy] Streaming error:', err);
      } finally {
        try {
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private async passThrough(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Rewrite to upstream URL
    const upstreamUrl = new URL(url.pathname + url.search, this.config.upstreamUrl);

    log('[model-proxy] Pass-through to upstream:', upstreamUrl.toString());

    try {
      const headers = new Headers(req.headers);
      // Remove host header to avoid conflicts
      headers.delete('host');

      const upstreamResp = await fetch(upstreamUrl.toString(), {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      });

      // Forward the response as-is
      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: upstreamResp.headers,
      });
    } catch (err) {
      log('[model-proxy] Pass-through error:', err);
      return this.createErrorResponse(err);
    }
  }

  private createErrorResponse(err: unknown): Response {
    const message = err instanceof Error ? err.message : String(err);

    // Return error in Gemini API format
    const errorResp = {
      error: {
        code: 500,
        message: `Model proxy error: ${message}`,
        status: 'INTERNAL',
      },
    };

    return new Response(JSON.stringify(errorResp), {
      status: 500,
      headers: {'Content-Type': 'application/json'},
    });
  }
}

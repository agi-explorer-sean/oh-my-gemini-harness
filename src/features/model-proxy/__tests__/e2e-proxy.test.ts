/**
 * End-to-end test for the model proxy.
 *
 * Starts the proxy server, sends a Gemini-format request for a Claude model,
 * and verifies it translates correctly. Uses a mock upstream for Gemini models
 * and makes a real Vertex AI call for Claude models (if credentials are available).
 */
import {describe, expect, test, afterAll} from 'bun:test';
import {ModelProxyServer} from '../server';
import type {ProxyConfig, GeminiGenerateContentResponse} from '../types';

// Mock upstream server for Gemini pass-through testing
let mockUpstream: ReturnType<typeof Bun.serve> | null = null;

function startMockUpstream(): string {
  mockUpstream = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.includes('generateContent')) {
        const body = await req.json();
        const resp: GeminiGenerateContentResponse = {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{text: `Mock upstream received: ${JSON.stringify(body).slice(0, 100)}`}],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
        };
        return new Response(JSON.stringify(resp), {
          headers: {'Content-Type': 'application/json'},
        });
      }
      return new Response('Not Found', {status: 404});
    },
  });
  return `http://localhost:${mockUpstream.port}`;
}

afterAll(() => {
  mockUpstream?.stop();
});

describe('Model Proxy E2E', () => {
  test('passes Gemini model requests through to upstream', async () => {
    const upstreamUrl = startMockUpstream();

    const config: ProxyConfig = {
      port: 0,
      upstreamUrl,
      gcpProject: 'test-project',
      gcpLocation: 'us-east5',
      claudeModelPrefixes: ['claude-'],
    };

    const proxy = new ModelProxyServer(config);
    proxy.start();

    try {
      const resp = await fetch(
        `${proxy.url}/v1beta/models/gemini-2.0-flash:generateContent`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            contents: [{role: 'user', parts: [{text: 'Hello Gemini'}]}],
          }),
        },
      );

      expect(resp.status).toBe(200);
      const data = (await resp.json()) as GeminiGenerateContentResponse;
      expect(data.candidates).toHaveLength(1);
      expect(data.candidates![0].content.parts[0].text).toContain('Mock upstream received');
    } finally {
      proxy.stop();
    }
  });

  test('routes Claude model requests through translation', async () => {
    // This test requires real Vertex AI credentials
    const gcpProject = process.env.GOOGLE_CLOUD_PROJECT;
    const gcpLocation = process.env.GOOGLE_CLOUD_LOCATION;

    if (!gcpProject || !gcpLocation) {
      console.log('Skipping Claude E2E test: no GCP credentials');
      return;
    }

    // For Claude, we need a region that supports Claude models
    // global location doesn't work for Claude on Vertex
    const claudeLocation =
      gcpLocation === 'global' ? 'us-east5' : gcpLocation;

    const upstreamUrl = startMockUpstream();

    const config: ProxyConfig = {
      port: 0,
      upstreamUrl,
      gcpProject,
      gcpLocation: claudeLocation,
      claudeModelPrefixes: ['claude-'],
    };

    const proxy = new ModelProxyServer(config);
    proxy.start();

    try {
      const resp = await fetch(
        `${proxy.url}/v1beta/models/claude-sonnet-4-6:generateContent`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            contents: [
              {role: 'user', parts: [{text: 'Say exactly "hello from claude" and nothing else.'}]},
            ],
            generationConfig: {
              maxOutputTokens: 100,
              temperature: 0,
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      const data = (await resp.json()) as GeminiGenerateContentResponse;
      expect(data.candidates).toBeDefined();
      expect(data.candidates!.length).toBeGreaterThan(0);

      const text = data.candidates![0].content.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join('');
      console.log('Claude response:', text);
      expect(text.length).toBeGreaterThan(0);
      expect(data.usageMetadata).toBeDefined();
      expect(data.usageMetadata!.promptTokenCount).toBeGreaterThan(0);
    } finally {
      proxy.stop();
    }
  });

  test('streams Claude model responses', async () => {
    const gcpProject = process.env.GOOGLE_CLOUD_PROJECT;
    const gcpLocation = process.env.GOOGLE_CLOUD_LOCATION;

    if (!gcpProject || !gcpLocation) {
      console.log('Skipping streaming E2E test: no GCP credentials');
      return;
    }

    const claudeLocation =
      gcpLocation === 'global' ? 'us-east5' : gcpLocation;

    const upstreamUrl = startMockUpstream();

    const config: ProxyConfig = {
      port: 0,
      upstreamUrl,
      gcpProject,
      gcpLocation: claudeLocation,
      claudeModelPrefixes: ['claude-'],
    };

    const proxy = new ModelProxyServer(config);
    proxy.start();
    try {
      const resp = await fetch(
        `${proxy.url}/v1beta/models/claude-sonnet-4-6:streamGenerateContent`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            contents: [
              {role: 'user', parts: [{text: 'Say exactly "streaming works" and nothing else.'}]},
            ],
            generationConfig: {
              maxOutputTokens: 100,
              temperature: 0,
            },
          }),
        },
      );

      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toBe('text/event-stream');

      const body = await resp.text();
      const chunks = body
        .split('\n\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.replace('data: ', '')));

      expect(chunks.length).toBeGreaterThan(0);

      // Collect all text from chunks
      const allText = chunks
        .flatMap((c: GeminiGenerateContentResponse) =>
          (c.candidates ?? []).flatMap((cand) =>
            cand.content.parts.map((p) => p.text).filter(Boolean),
          ),
        )
        .join('');

      console.log('Streamed text:', allText);
      expect(allText.length).toBeGreaterThan(0);

      // Last meaningful chunk should have finishReason
      const lastChunk = chunks[chunks.length - 1] as GeminiGenerateContentResponse;
      expect(lastChunk.candidates?.[0]?.finishReason).toBe('STOP');
      expect(lastChunk.usageMetadata).toBeDefined();
    } finally {
      proxy.stop();
    }
  });
});

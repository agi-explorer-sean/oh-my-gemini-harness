import {ModelProxyServer} from './server';
import type {ProxyConfig} from './types';
import {DEFAULT_CLAUDE_MODEL_PREFIXES} from './types';
import {log} from '../../shared/logger';

// ---------------------------------------------------------------------------
// Model Proxy Lifecycle
//
// Manages the proxy server lifecycle. The proxy intercepts
// GOOGLE_GEMINI_BASE_URL, translates Claude model requests to Anthropic
// Messages API format via Vertex AI rawPredict, and passes Gemini model
// requests through to the original upstream proxy.
// ---------------------------------------------------------------------------

let proxyInstance: ModelProxyServer | null = null;

export interface ModelProxyOptions {
  /** GCP project for Vertex AI (defaults to GOOGLE_CLOUD_PROJECT) */
  gcpProject?: string;
  /** GCP location for Claude endpoints (defaults to GOOGLE_CLOUD_LOCATION) */
  gcpLocation?: string;
  /** Fixed port (0 = OS-assigned) */
  port?: number;
}

/**
 * Start the model translation proxy.
 *
 * Saves the current GOOGLE_GEMINI_BASE_URL as the upstream proxy,
 * starts the translation proxy on a new port, and updates
 * GOOGLE_GEMINI_BASE_URL to point to it.
 *
 * Returns the proxy instance, or null if prerequisites are missing.
 */
export function startModelProxy(
  options?: ModelProxyOptions,
): ModelProxyServer | null {
  if (proxyInstance) {
    log(`[model-proxy] Proxy already running on port ${proxyInstance.port}`);
    return proxyInstance;
  }

  const gcpProject =
    options?.gcpProject ?? process.env.GOOGLE_CLOUD_PROJECT;
  let gcpLocation =
    options?.gcpLocation ?? process.env.GOOGLE_CLOUD_LOCATION;

  if (!gcpProject || !gcpLocation) {
    log(
      '[model-proxy] Cannot start: missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION',
    );
    return null;
  }

  // Claude on Vertex AI is not available in the "global" location.
  // Default to us-east5 which has broad Claude model availability.
  if (gcpLocation === 'global') {
    gcpLocation = 'us-east5';
    log('[model-proxy] Overriding location "global" → "us-east5" for Claude model support');
  }

  // Save original upstream URL
  const upstreamUrl =
    process.env.GOOGLE_GEMINI_BASE_URL ?? 'http://localhost:4097';

  const config: ProxyConfig = {
    port: options?.port ?? 0,
    upstreamUrl,
    gcpProject,
    gcpLocation,
    claudeModelPrefixes: DEFAULT_CLAUDE_MODEL_PREFIXES,
  };

  proxyInstance = new ModelProxyServer(config);
  proxyInstance.start();

  // Update GOOGLE_GEMINI_BASE_URL to route through our proxy
  const newBaseUrl = proxyInstance.url;
  process.env.GOOGLE_GEMINI_BASE_URL = newBaseUrl;
  process.env.OMG_ORIGINAL_GEMINI_BASE_URL = upstreamUrl;

  log(`[model-proxy] Proxy started. Base URL updated: ${upstreamUrl} → ${newBaseUrl}`);

  return proxyInstance;
}

/**
 * Stop the model translation proxy and restore the original base URL.
 */
export function stopModelProxy(): void {
  if (!proxyInstance) return;

  proxyInstance.stop();
  proxyInstance = null;

  // Restore original base URL
  const originalUrl = process.env.OMG_ORIGINAL_GEMINI_BASE_URL;
  if (originalUrl) {
    process.env.GOOGLE_GEMINI_BASE_URL = originalUrl;
    delete process.env.OMG_ORIGINAL_GEMINI_BASE_URL;
    log(`[model-proxy] Restored base URL: ${originalUrl}`);
  }
}

/**
 * Check if the model proxy is currently running.
 */
export function isModelProxyRunning(): boolean {
  return proxyInstance !== null;
}

/**
 * Get the current model proxy instance (if running).
 */
export function getModelProxy(): ModelProxyServer | null {
  return proxyInstance;
}

/**
 * Check if Vertex AI is configured for Claude model access.
 */
export function isVertexAIConfigured(): boolean {
  return (
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' &&
    !!process.env.GOOGLE_CLOUD_PROJECT &&
    !!process.env.GOOGLE_CLOUD_LOCATION
  );
}

// Re-export types
export {ModelProxyServer} from './server';
export type {ProxyConfig} from './types';

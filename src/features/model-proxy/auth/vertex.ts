import {existsSync, readFileSync} from 'node:fs';
import {log} from '../../../shared/logger';

// ---------------------------------------------------------------------------
// Vertex AI ADC Auth
//
// Reads Application Default Credentials from the well-known location,
// exchanges the refresh token for an access token, and caches it.
// Falls back to metadata server.
// ---------------------------------------------------------------------------

interface ADCCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  type: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

// Buffer before expiry to refresh early (5 minutes)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

let cachedToken: CachedToken | null = null;

function getADCPath(): string {
  // Check GOOGLE_APPLICATION_CREDENTIALS first
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${homeDir}/.config/gcloud/application_default_credentials.json`;
}

function readADC(): ADCCredentials | null {
  const adcPath = getADCPath();
  if (!existsSync(adcPath)) {
    log('[model-proxy/auth] ADC file not found:', adcPath);
    return null;
  }

  try {
    const content = readFileSync(adcPath, 'utf-8');
    const creds = JSON.parse(content) as ADCCredentials;
    if (creds.type !== 'authorized_user') {
      log('[model-proxy/auth] ADC type is not authorized_user:', creds.type);
      // Could be service_account — handle differently if needed
      return null;
    }
    return creds;
  } catch (err) {
    log('[model-proxy/auth] Failed to read ADC:', err);
    return null;
  }
}

async function refreshAccessToken(
  creds: ADCCredentials,
): Promise<CachedToken> {
  const body = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString(),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(
      `Token refresh failed (${resp.status}): ${errorText}`,
    );
  }

  const data = (await resp.json()) as TokenResponse;
  const expiresAt = Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS;

  log(`[model-proxy/auth] Token refreshed, expires in ${data.expires_in}s`);

  return {
    accessToken: data.access_token,
    expiresAt,
  };
}

async function getMetadataToken(): Promise<CachedToken> {
  const resp = await fetch(METADATA_TOKEN_URL, {
    headers: {'Metadata-Flavor': 'Google'},
  });

  if (!resp.ok) {
    throw new Error(`Metadata server token failed (${resp.status})`);
  }

  const data = (await resp.json()) as TokenResponse;
  const expiresAt = Date.now() + data.expires_in * 1000 - EXPIRY_BUFFER_MS;

  return {
    accessToken: data.access_token,
    expiresAt,
  };
}

/**
 * Try to get an access token via gcloud CLI as a fallback.
 */
async function getGcloudToken(): Promise<CachedToken | null> {
  try {
    const proc = Bun.spawn(
      ['gcloud', 'auth', 'application-default', 'print-access-token'],
      {stdout: 'pipe', stderr: 'pipe'},
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode === 0 && output.trim()) {
      return {
        accessToken: output.trim(),
        // gcloud tokens typically last 1 hour; refresh after 50 min
        expiresAt: Date.now() + 50 * 60 * 1000,
      };
    }
  } catch {
    // gcloud not available
  }
  return null;
}

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  // Try ADC file first
  const creds = readADC();
  if (creds) {
    try {
      cachedToken = await refreshAccessToken(creds);
      return cachedToken.accessToken;
    } catch (err) {
      log('[model-proxy/auth] ADC refresh failed:', err);
    }
  }

  // Try gcloud CLI fallback
  const gcloudToken = await getGcloudToken();
  if (gcloudToken) {
    cachedToken = gcloudToken;
    return cachedToken.accessToken;
  }

  // Try GCE metadata server
  try {
    cachedToken = await getMetadataToken();
    return cachedToken.accessToken;
  } catch {
    // Not on GCE
  }

  throw new Error(
    'No valid credentials found for Vertex AI. Run: gcloud auth application-default login',
  );
}

export function clearTokenCache(): void {
  cachedToken = null;
}

// ---------------------------------------------------------------------------
// Vertex AI rawPredict endpoint builder
// ---------------------------------------------------------------------------

export function buildVertexAIEndpoint(
  project: string,
  location: string,
  model: string,
  stream: boolean,
): string {
  const specifier = stream ? 'streamRawPredict' : 'rawPredict';
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${model}:${specifier}`;
}

/**
 * Call the Vertex AI rawPredict endpoint with an Anthropic Messages API body.
 */
export async function callVertexAIClaude(
  project: string,
  location: string,
  model: string,
  body: Record<string, unknown>,
  stream: boolean,
): Promise<Response> {
  const accessToken = await getAccessToken();
  const endpoint = buildVertexAIEndpoint(project, location, model, stream);

  log('[model-proxy/auth] Calling Vertex AI:', endpoint);

  // Remove model from body (it's in the URL path)
  const {model: _model, ...bodyWithoutModel} = body;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(bodyWithoutModel),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    log(`[model-proxy/auth] Vertex AI error: ${resp.status}`, errorText);

    // If token expired, clear cache and retry once
    if (resp.status === 401) {
      clearTokenCache();
      const newToken = await getAccessToken();
      const retryResp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
        },
        body: JSON.stringify(bodyWithoutModel),
      });
      if (!retryResp.ok) {
        const retryError = await retryResp.text();
        throw new Error(
          `Vertex AI request failed after retry (${retryResp.status}): ${retryError}`,
        );
      }
      return retryResp;
    }

    throw new Error(
      `Vertex AI request failed (${resp.status}): ${errorText}`,
    );
  }

  return resp;
}

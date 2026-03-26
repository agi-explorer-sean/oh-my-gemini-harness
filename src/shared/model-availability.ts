import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {
  hasProviderModelsCache,
  readProviderModelsCache,
} from './connected-providers-cache';
import {getGeminiCacheDir} from './data-path';
import {log} from './logger';

function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/claude-(opus|sonnet|haiku)-4-5/g, 'claude-$1-4.5')
    .replace(/claude-(opus|sonnet|haiku)-4\.5/g, 'claude-$1-4.5');
}

export function fuzzyMatchModel(
  target: string,
  available: Set<string>,
  providers?: string[],
): string | null {
  log('[fuzzyMatchModel] called', {
    target,
    availableCount: available.size,
    providers,
  });

  if (available.size === 0) return null;

  const targetNormalized = normalizeModelName(target);

  let candidates = Array.from(available);
  if (providers && providers.length > 0) {
    const providerSet = new Set(providers);
    candidates = candidates.filter((model) => {
      const [provider] = model.split('/');
      return providerSet.has(provider);
    });
  }

  if (candidates.length === 0) return null;

  const matches = candidates.filter((model) =>
    normalizeModelName(model).includes(targetNormalized),
  );

  if (matches.length === 0) return null;

  const exactMatch = matches.find(
    (model) => normalizeModelName(model) === targetNormalized,
  );
  if (exactMatch) return exactMatch;

  return matches.reduce((shortest, current) =>
    current.length < shortest.length ? current : shortest,
  );
}

export function isModelAvailable(
  targetModel: string,
  availableModels: Set<string>,
): boolean {
  return fuzzyMatchModel(targetModel, availableModels) !== null;
}

export async function getConnectedProviders(client: any): Promise<string[]> {
  if (!client?.provider?.list) {
    return [];
  }

  try {
    const result = await client.provider.list();
    return result.data?.connected ?? [];
  } catch (err) {
    log('[getConnectedProviders] SDK error', {error: String(err)});
    return [];
  }
}

export async function fetchAvailableModels(
  client?: any,
  options?: {connectedProviders?: string[] | null},
): Promise<Set<string>> {
  let connectedProviders = options?.connectedProviders ?? null;
  let connectedProvidersUnknown = connectedProviders === null;

  if (connectedProvidersUnknown && client) {
    const liveConnected = await getConnectedProviders(client);
    if (liveConnected.length > 0) {
      connectedProviders = liveConnected;
      connectedProvidersUnknown = false;
    }
  }

  if (connectedProvidersUnknown) {
    if (client?.model?.list) {
      const modelSet = new Set<string>();
      try {
        const modelsResult = await client.model.list();
        const models = modelsResult.data ?? [];
        for (const model of models) {
          if (model?.provider && model?.id) {
            modelSet.add(`${model.provider}/${model.id}`);
          }
        }
        return modelSet;
      } catch (err) {
        log('[fetchAvailableModels] client.model.list error', {
          error: String(err),
        });
      }
    }
    return new Set<string>();
  }

  const connectedProvidersList = connectedProviders ?? [];
  const connectedSet = new Set(connectedProvidersList);
  const modelSet = new Set<string>();

  // Try provider-models cache first
  const providerModelsCache = readProviderModelsCache();
  if (
    providerModelsCache &&
    Object.keys(providerModelsCache.models).length > 0
  ) {
    for (const [providerId, modelIds] of Object.entries(
      providerModelsCache.models,
    )) {
      if (!connectedSet.has(providerId)) continue;
      for (const modelId of modelIds) {
        modelSet.add(`${providerId}/${modelId}`);
      }
    }
    if (modelSet.size > 0) return modelSet;
  }

  // Fall back to models.json cache
  const cacheFile = join(getGeminiCacheDir(), 'models.json');
  if (existsSync(cacheFile)) {
    try {
      const content = readFileSync(cacheFile, 'utf-8');
      const data = JSON.parse(content) as Record<
        string,
        {id?: string; models?: Record<string, {id?: string}>}
      >;

      for (const providerId of Object.keys(data)) {
        if (!connectedSet.has(providerId)) continue;
        const models = data[providerId]?.models;
        if (!models || typeof models !== 'object') continue;
        for (const modelKey of Object.keys(models)) {
          modelSet.add(`${providerId}/${modelKey}`);
        }
      }

      if (modelSet.size > 0) return modelSet;
    } catch (err) {
      log('[fetchAvailableModels] error', {error: String(err)});
    }
  }

  // Fall back to live client
  if (client?.model?.list) {
    try {
      const modelsResult = await client.model.list();
      const models = modelsResult.data ?? [];
      for (const model of models) {
        if (!model?.provider || !model?.id) continue;
        if (connectedSet.has(model.provider)) {
          modelSet.add(`${model.provider}/${model.id}`);
        }
      }
    } catch (err) {
      log('[fetchAvailableModels] client.model.list error', {
        error: String(err),
      });
    }
  }

  return modelSet;
}

export function isAnyFallbackModelAvailable(
  fallbackChain: Array<{providers: string[]; model: string}>,
  availableModels: Set<string>,
): boolean {
  if (availableModels.size === 0) return false;

  for (const entry of fallbackChain) {
    if (
      entry.providers.some(
        (provider) =>
          fuzzyMatchModel(entry.model, availableModels, [provider]) !== null,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function __resetModelCache(): void {}

export function isModelCacheAvailable(): boolean {
  if (hasProviderModelsCache()) return true;
  const cacheFile = join(getGeminiCacheDir(), 'models.json');
  return existsSync(cacheFile);
}

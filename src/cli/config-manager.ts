import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  getGeminiConfigPaths,
  parseJsonc,
  type GeminiBinaryType,
  type GeminiConfigPaths,
} from '../shared';
import {generateModelConfig} from './model-fallback';
import type {ConfigMergeResult, DetectedConfig, InstallConfig} from './types';

const GEMINI_BINARIES = ['gemini', 'gemini-desktop'] as const;

/** Well-known absolute paths where the Gemini binary may be installed. */
const GEMINI_KNOWN_PATHS = [] as const;

interface ConfigContext {
  binary: GeminiBinaryType;
  version: string | null;
  paths: GeminiConfigPaths;
}

let configContext: ConfigContext | null = null;

export function initConfigContext(
  binary: GeminiBinaryType,
  version: string | null,
): void {
  const paths = getGeminiConfigPaths({binary, version});
  configContext = {binary, version, paths};
}

export function getConfigContext(): ConfigContext {
  if (!configContext) {
    const paths = getGeminiConfigPaths({binary: 'gemini', version: null});
    configContext = {binary: 'gemini', version: null, paths};
  }
  return configContext;
}

export function resetConfigContext(): void {
  configContext = null;
}

function getConfigDir(): string {
  return getConfigContext().paths.configDir;
}

function getConfigJson(): string {
  return getConfigContext().paths.configJson;
}

function getConfigJsonc(): string {
  return getConfigContext().paths.configJsonc;
}

function getPackageJson(): string {
  return getConfigContext().paths.packageJson;
}

function getOmgConfig(): string {
  return getConfigContext().paths.omgConfig;
}

const BUN_INSTALL_TIMEOUT_SECONDS = 60;
const BUN_INSTALL_TIMEOUT_MS = BUN_INSTALL_TIMEOUT_SECONDS * 1000;

interface NodeError extends Error {
  code?: string;
}

function isPermissionError(err: unknown): boolean {
  const nodeErr = err as NodeError;
  return nodeErr?.code === 'EACCES' || nodeErr?.code === 'EPERM';
}

function isFileNotFoundError(err: unknown): boolean {
  const nodeErr = err as NodeError;
  return nodeErr?.code === 'ENOENT';
}

function formatErrorWithSuggestion(err: unknown, context: string): string {
  const message = err instanceof Error ? err.message : String(err);
  let suggestion = '';

  if (isPermissionError(err)) {
    suggestion =
      ' (Check file permissions. Try running with sudo or fixing ownership)';
  } else if (isFileNotFoundError(err)) {
    suggestion = ' (File not found. Ensure the path is correct)';
  }

  return `Failed to ${context}: ${message}${suggestion}`;
}

export async function getPluginNameWithVersion(
  _currentVersion: string,
): Promise<string> {
  return process.cwd();
}

type ConfigFormat = 'json' | 'jsonc' | 'none';

interface GeminiConfig {
  plugin?: string[];
  [key: string]: unknown;
}

export function detectConfigFormat(): {format: ConfigFormat; path: string} {
  const configJsonc = getConfigJsonc();
  const configJson = getConfigJson();

  if (existsSync(configJsonc)) {
    return {format: 'jsonc', path: configJsonc};
  }
  if (existsSync(configJson)) {
    return {format: 'json', path: configJson};
  }
  return {format: 'none', path: configJson};
}

interface ParseConfigResult {
  config: GeminiConfig | null;
  error?: string;
}

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0;
}

function parseConfig(path: string, _isJsonc: boolean): GeminiConfig | null {
  const result = parseConfigWithError(path);
  return result.config;
}

function parseConfigWithError(path: string): ParseConfigResult {
  try {
    const stat = statSync(path);
    if (stat.size === 0) {
      return {
        config: null,
        error: `Config file is empty: ${path}. Delete it or add valid JSON content.`,
      };
    }

    const content = readFileSync(path, 'utf-8');

    if (isEmptyOrWhitespace(content)) {
      return {
        config: null,
        error: `Config file contains only whitespace: ${path}. Delete it or add valid JSON content.`,
      };
    }

    const config = parseJsonc<GeminiConfig>(content);

    if (config === null || config === undefined) {
      return {
        config: null,
        error: `Config file parsed to null/undefined: ${path}. Ensure it contains valid JSON.`,
      };
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
      return {
        config: null,
        error: `Config file must contain a JSON object, not ${Array.isArray(config) ? 'an array' : typeof config}: ${path}`,
      };
    }

    return {config};
  } catch (err) {
    return {
      config: null,
      error: formatErrorWithSuggestion(err, `parse config file ${path}`),
    };
  }
}

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, {recursive: true});
  }
}

export async function addPluginToGeminiConfig(
  currentVersion: string,
): Promise<ConfigMergeResult> {
  try {
    ensureConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, 'create config directory'),
    };
  }

  const {format, path} = detectConfigFormat();
  const pluginEntry = await getPluginNameWithVersion(currentVersion);

  try {
    if (format === 'none') {
      const config: GeminiConfig = {plugin: [pluginEntry]};
      writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
      return {success: true, configPath: path};
    }

    const parseResult = parseConfigWithError(path);
    if (!parseResult.config) {
      return {
        success: false,
        configPath: path,
        error: parseResult.error ?? 'Failed to parse config file',
      };
    }

    const config = parseResult.config;
    const plugins = config.plugin ?? [];
    const existingIndex = plugins.findIndex(
      (p) =>
        p === 'oh-my-gemini-harness' ||
        p.startsWith('oh-my-gemini-harness@') ||
        p.includes('oh-my-gemini-harness'),
    );

    if (existingIndex !== -1) {
      if (plugins[existingIndex] === pluginEntry) {
        return {success: true, configPath: path};
      }
      plugins[existingIndex] = pluginEntry;
    } else {
      plugins.push(pluginEntry);
    }

    config.plugin = plugins;

    if (format === 'jsonc') {
      const content = readFileSync(path, 'utf-8');
      const pluginArrayRegex = /"plugin"\s*:\s*\[([\s\S]*?)\]/;
      const match = content.match(pluginArrayRegex);

      if (match) {
        const formattedPlugins = plugins.map((p) => `"${p}"`).join(',\n    ');
        const newContent = content.replace(
          pluginArrayRegex,
          `"plugin": [\n    ${formattedPlugins}\n  ]`,
        );
        writeFileSync(path, newContent);
      } else {
        const newContent = content.replace(
          /^(\s*\{)/,
          `$1\n  "plugin": ["${pluginEntry}"],`,
        );
        writeFileSync(path, newContent);
      }
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    }

    return {success: true, configPath: path};
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, 'update gemini config'),
    };
  }
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = {...target};

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

export function generateOmgConfig(
  installConfig: InstallConfig,
): Record<string, unknown> {
  return generateModelConfig(installConfig);
}

export function writeOmgConfig(
  installConfig: InstallConfig,
): ConfigMergeResult {
  try {
    ensureConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, 'create config directory'),
    };
  }

  const omgConfigPath = getOmgConfig();

  try {
    const newConfig = generateOmgConfig(installConfig);

    if (existsSync(omgConfigPath)) {
      try {
        const stat = statSync(omgConfigPath);
        const content = readFileSync(omgConfigPath, 'utf-8');

        if (stat.size === 0 || isEmptyOrWhitespace(content)) {
          writeFileSync(
            omgConfigPath,
            JSON.stringify(newConfig, null, 2) + '\n',
          );
          return {success: true, configPath: omgConfigPath};
        }

        const existing = parseJsonc<Record<string, unknown>>(content);
        if (
          !existing ||
          typeof existing !== 'object' ||
          Array.isArray(existing)
        ) {
          writeFileSync(
            omgConfigPath,
            JSON.stringify(newConfig, null, 2) + '\n',
          );
          return {success: true, configPath: omgConfigPath};
        }

        const merged = deepMerge(existing, newConfig);
        writeFileSync(omgConfigPath, JSON.stringify(merged, null, 2) + '\n');
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          writeFileSync(
            omgConfigPath,
            JSON.stringify(newConfig, null, 2) + '\n',
          );
          return {success: true, configPath: omgConfigPath};
        }
        throw parseErr;
      }
    } else {
      writeFileSync(omgConfigPath, JSON.stringify(newConfig, null, 2) + '\n');
    }

    return {success: true, configPath: omgConfigPath};
  } catch (err) {
    return {
      success: false,
      configPath: omgConfigPath,
      error: formatErrorWithSuggestion(err, 'write oh-my-gemini-harness config'),
    };
  }
}

interface GeminiBinaryResult {
  binary: GeminiBinaryType;
  version: string;
}

async function findGeminiBinaryWithVersion(): Promise<GeminiBinaryResult | null> {
  // 1. Try 'gemini --version' directly
  try {
    const proc = Bun.spawn(['gemini', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode === 0) {
      const version = output.trim().split('\n').pop()?.trim() ?? '';
      initConfigContext('gemini', version);
      return {binary: 'gemini', version};
    }
  } catch {}

  // 2. Try via interactive shell (to handle aliases)
  try {
    const proc = Bun.spawn(['bash', '-i', '-c', 'gemini --version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode === 0) {
      const version = output.trim().split('\n').pop()?.trim() ?? '';
      initConfigContext('gemini', version);
      return {binary: 'gemini', version};
    }
  } catch {}

  // 3. Fallback to other binaries
  for (const binary of GEMINI_BINARIES) {
    if (binary === 'gemini') continue; // Already tried
    try {
      const proc = Bun.spawn([binary, '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode === 0) {
        const version = output.trim().split('\n').pop()?.trim() ?? '';
        initConfigContext(binary, version);
        return {binary, version};
      }
    } catch {
      continue;
    }
  }

  // 4. Try well-known absolute paths (e.g. Google-internal installations)
  for (const absolutePath of GEMINI_KNOWN_PATHS) {
    try {
      if (!existsSync(absolutePath)) continue;
      const proc = Bun.spawn([absolutePath, '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode === 0) {
        const version = output.trim().split('\n').pop()?.trim() ?? '';
        initConfigContext('gemini', version);
        return {binary: 'gemini', version};
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function isGeminiInstalled(): Promise<boolean> {
  const result = await findGeminiBinaryWithVersion();
  return result !== null;
}

export async function getGeminiVersion(): Promise<string | null> {
  const result = await findGeminiBinaryWithVersion();
  return result?.version ?? null;
}

/**
 * Returns the resolved path to the Gemini binary.
 * Checks PATH, interactive shell aliases, and well-known absolute paths.
 */
export async function getGeminiBinaryPath(): Promise<string | null> {
  const result = await findGeminiBinaryWithVersion();
  if (!result) return null;

  // Check if the binary is directly available in PATH
  for (const binary of GEMINI_BINARIES) {
    try {
      const proc = Bun.spawn(['which', binary], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode === 0) {
        return output.trim();
      }
    } catch {}
  }

  // Check well-known absolute paths
  for (const absolutePath of GEMINI_KNOWN_PATHS) {
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  // Fallback to the binary name (may be found via alias)
  return result.binary;
}

export async function addAuthPlugins(
  config: InstallConfig,
): Promise<ConfigMergeResult> {
  try {
    ensureConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, 'create config directory'),
    };
  }

  const {format, path} = detectConfigFormat();

  try {
    let existingConfig: GeminiConfig | null = null;
    if (format !== 'none') {
      const parseResult = parseConfigWithError(path);
      if (parseResult.error && !parseResult.config) {
        existingConfig = {};
      } else {
        existingConfig = parseResult.config;
      }
    }

    const plugins: string[] = existingConfig?.plugin ?? [];

    const newConfig = {...(existingConfig ?? {}), plugin: plugins};
    writeFileSync(path, JSON.stringify(newConfig, null, 2) + '\n');
    return {success: true, configPath: path};
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, 'add auth plugins to config'),
    };
  }
}

export interface BunInstallResult {
  success: boolean;
  timedOut?: boolean;
  error?: string;
}

export async function runBunInstall(): Promise<boolean> {
  const result = await runBunInstallWithDetails();
  return result.success;
}

export async function runBunInstallWithDetails(): Promise<BunInstallResult> {
  try {
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: getConfigDir(),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), BUN_INSTALL_TIMEOUT_MS),
    );

    const exitPromise = proc.exited.then(() => 'completed' as const);

    const result = await Promise.race([exitPromise, timeoutPromise]);

    if (result === 'timeout') {
      try {
        proc.kill();
      } catch {
        /* intentionally empty - process may have already exited */
      }
      return {
        success: false,
        timedOut: true,
        error: `bun install timed out after ${BUN_INSTALL_TIMEOUT_SECONDS} seconds. Try running manually: cd ~/.config/gemini && bun i`,
      };
    }

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        error:
          stderr.trim() || `bun install failed with exit code ${proc.exitCode}`,
      };
    }

    return {success: true};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `bun install failed: ${message}. Is bun installed? Try: curl -fsSL https://bun.sh/install | bash`,
    };
  }
}

export const GOOGLE_PROVIDER_CONFIG = {
  google: {
    name: 'Google',
    models: {
      'gemini-3.1-pro-preview': {
        name: 'Gemini 3.1 Pro',
        limit: {context: 1048576, output: 65535},
        modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
        variants: {
          low: {thinkingLevel: 'low'},
          high: {thinkingLevel: 'high'},
        },
      },
      'gemini-3.1-flash-preview': {
        name: 'Gemini 3.1 Flash',
        limit: {context: 1048576, output: 65536},
        modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
        variants: {
          minimal: {thinkingLevel: 'minimal'},
          low: {thinkingLevel: 'low'},
          medium: {thinkingLevel: 'medium'},
          high: {thinkingLevel: 'high'},
        },
      },
      'gemini-2.5-pro': {
        name: 'Gemini 2.5 Pro',
        limit: {context: 1048576, output: 65535},
        modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
      },
      'gemini-2.5-flash': {
        name: 'Gemini 2.5 Flash',
        limit: {context: 1048576, output: 65536},
        modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
      },
      'gemini-2.5-flash-lite': {
        name: 'Gemini 2.5 Flash Lite',
        limit: {context: 1048576, output: 65536},
        modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
      },
    },
  },
};

/** Claude models available via Vertex AI MaaS. */
export const VERTEX_AI_CLAUDE_MODELS = {
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6 (Vertex AI)',
    limit: {context: 200000, output: 16384},
    modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
  },
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5 (Vertex AI)',
    limit: {context: 200000, output: 16384},
    modalities: {input: ['text', 'image', 'pdf'], output: ['text']},
  },
};

export interface VertexAIStatus {
  enabled: boolean;
  project: string | null;
  location: string | null;
  hasADC: boolean;
}

/**
 * Detect Vertex AI configuration from environment variables and ADC credentials.
 * Vertex AI is used by the Gemini CLI when GOOGLE_GENAI_USE_VERTEXAI=true,
 * enabling access to partner models (e.g. Claude) via Google's MaaS platform.
 */
export function detectVertexAI(): VertexAIStatus {
  const enabled = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? null;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? null;

  // Check for Application Default Credentials
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const adcPath = `${homeDir}/.config/gcloud/application_default_credentials.json`;
  const hasADC = existsSync(adcPath);

  return {enabled, project, location, hasADC};
}

export function addProviderConfig(config: InstallConfig): ConfigMergeResult {
  try {
    ensureConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, 'create config directory'),
    };
  }

  const {format, path} = detectConfigFormat();

  try {
    let existingConfig: GeminiConfig | null = null;
    if (format !== 'none') {
      const parseResult = parseConfigWithError(path);
      if (parseResult.error && !parseResult.config) {
        existingConfig = {};
      } else {
        existingConfig = parseResult.config;
      }
    }

    const newConfig = {...(existingConfig ?? {})};

    const providers = (newConfig.provider ?? {}) as Record<string, any>;

    if (config.hasGemini) {
      const googleConfig = {...GOOGLE_PROVIDER_CONFIG.google};
      const models = {...googleConfig.models};

      // Add Vertex AI Claude models when Vertex AI is detected
      if (config.hasVertexAI) {
        Object.assign(models, VERTEX_AI_CLAUDE_MODELS);
      }

      providers.google = {...googleConfig, models};
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers;
    }

    writeFileSync(path, JSON.stringify(newConfig, null, 2) + '\n');
    return {success: true, configPath: path};
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, 'add provider config'),
    };
  }
}

/**
 * Rewrite hooks/hooks.json and gemini-extension.json with absolute paths to
 * dist/cli/index.js so that hooks and the MCP server work regardless of which
 * directory the user runs `gemini` from.
 */
export function writeAbsolutePathConfigs(extDir: string): ConfigMergeResult {
  const cliScript = `${extDir}/dist/cli/index.js`;

  const hooksConfig = {
    hooks: {
      BeforeAgent: [
        {
          matcher: '*',
          hooks: [
            {type: 'command', command: `bun ${cliScript} dispatch BeforeAgent`},
          ],
        },
      ],
      AfterAgent: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `bun ${cliScript} dispatch AfterAgent`,
              timeout: 600000,
            },
          ],
        },
      ],
      BeforeTool: [
        {
          matcher:
            '^(?!(read_file|ls|glob|grep|ast_grep_search|session_.*|lsp_.*)$).*$',
          hooks: [
            {type: 'command', command: `bun ${cliScript} dispatch BeforeTool`},
          ],
        },
      ],
      SessionStart: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `bun ${cliScript} dispatch SessionStart`,
            },
          ],
        },
      ],
      SessionEnd: [
        {
          matcher: '*',
          hooks: [
            {type: 'command', command: `bun ${cliScript} dispatch SessionEnd`},
          ],
        },
      ],
    },
  };

  const hooksPath = `${extDir}/hooks/hooks.json`;
  try {
    writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2) + '\n');
  } catch (err) {
    return {
      success: false,
      configPath: hooksPath,
      error: formatErrorWithSuggestion(err, 'write hooks config'),
    };
  }

  const extensionConfig = {
    name: 'oh-my-gemini-harness',
    version: '0.1.0',
    description:
      'The Best AI Agent Harness - Batteries-Included Gemini CLI Plugin',
    mcpServers: {
      'oh-my-gemini-harness': {
        command: 'bun',
        args: [cliScript, 'mcp-server'],
        timeout: 900000,
      },
    },
  };

  const extensionPath = `${extDir}/gemini-extension.json`;
  try {
    writeFileSync(
      extensionPath,
      JSON.stringify(extensionConfig, null, 2) + '\n',
    );
  } catch (err) {
    return {
      success: false,
      configPath: extensionPath,
      error: formatErrorWithSuggestion(err, 'write extension config'),
    };
  }

  return {success: true, configPath: hooksPath};
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    hasGemini: false,
    hasVertexAI: false,
  };

  const {format, path} = detectConfigFormat();
  if (format === 'none') {
    return result;
  }

  const parseResult = parseConfigWithError(path);
  if (!parseResult.config) {
    return result;
  }

  const geminiConfig = parseResult.config;
  const plugins = geminiConfig.plugin ?? [];
  result.isInstalled = plugins.some((p) => p.startsWith('oh-my-gemini-harness'));

  if (!result.isInstalled) {
    return result;
  }

  // Gemini CLI uses native authentication, so if oh-my-gemini-harness is installed,
  // we can assume Gemini is available.
  result.hasGemini = true;

  // Detect Vertex AI for Claude model access
  const vertexAI = detectVertexAI();
  result.hasVertexAI = vertexAI.enabled && vertexAI.hasADC;

  return result;
}

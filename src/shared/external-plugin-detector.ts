import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {parseJsoncSafe} from './jsonc-parser';
import {log} from './logger';

interface GeminiConfig {
  plugin?: string[];
}

// Plugins that conflict with session-notification (concurrent session.idle listeners)
const KNOWN_NOTIFICATION_PLUGINS = [
  'gemini-notifier',
  '@mohak34/gemini-notifier',
  'mohak34/gemini-notifier',
];

function getWindowsAppdataDir(): string | null {
  return process.env.APPDATA || null;
}

function getConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), '.config');
  const paths = [
    path.join(directory, '.gemini', 'gemini.json'),
    path.join(directory, '.gemini', 'gemini.jsonc'),
    path.join(crossPlatformDir, 'gemini', 'gemini.json'),
    path.join(crossPlatformDir, 'gemini', 'gemini.jsonc'),
  ];

  if (process.platform === 'win32') {
    const appdataDir = getWindowsAppdataDir();
    if (appdataDir) {
      paths.push(path.join(appdataDir, 'gemini', 'gemini.json'));
      paths.push(path.join(appdataDir, 'gemini', 'gemini.jsonc'));
    }
  }

  return paths;
}

function loadGeminiPlugins(directory: string): string[] {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const content = fs.readFileSync(configPath, 'utf-8');
      const result = parseJsoncSafe<GeminiConfig>(content);
      if (result.data) {
        return result.data.plugin ?? [];
      }
    } catch {
      continue;
    }
  }
  return [];
}

// Handles: "name", "name@version", "npm:name", "file://path/name"
function matchesNotificationPlugin(entry: string): string | null {
  const normalized = entry.toLowerCase();
  for (const known of KNOWN_NOTIFICATION_PLUGINS) {
    // Exact match
    if (normalized === known) return known;
    // Version suffix: "gemini-notifier@1.2.3"
    if (normalized.startsWith(`${known}@`)) return known;
    // Scoped package: "@mohak34/gemini-notifier" or "@mohak34/gemini-notifier@1.2.3"
    if (
      normalized === `@mohak34/${known}` ||
      normalized.startsWith(`@mohak34/${known}@`)
    )
      return known;
    // npm: prefix
    if (normalized === `npm:${known}` || normalized.startsWith(`npm:${known}@`))
      return known;
    // file:// path ending exactly with package name
    if (
      normalized.startsWith('file://') &&
      (normalized.endsWith(`/${known}`) || normalized.endsWith(`\\${known}`))
    )
      return known;
  }
  return null;
}

export interface ExternalNotifierResult {
  detected: boolean;
  pluginName: string | null;
  allPlugins: string[];
}

export function detectExternalNotificationPlugin(
  directory: string,
): ExternalNotifierResult {
  const plugins = loadGeminiPlugins(directory);

  for (const plugin of plugins) {
    const match = matchesNotificationPlugin(plugin);
    if (match) {
      log(`Detected external notification plugin: ${plugin}`);
      return {
        detected: true,
        pluginName: match,
        allPlugins: plugins,
      };
    }
  }

  return {
    detected: false,
    pluginName: null,
    allPlugins: plugins,
  };
}

export function getNotificationConflictWarning(pluginName: string): string {
  return `[oh-my-gemini] External notification plugin detected: ${pluginName}

Both oh-my-gemini and ${pluginName} listen to session.idle events.
   Running both simultaneously can cause crashes on Windows.

   oh-my-gemini's session-notification has been auto-disabled.

   To use oh-my-gemini's notifications instead, either:
   1. Remove ${pluginName} from your gemini.json plugins
   2. Or set "notification": { "force_enable": true } in oh-my-gemini.json`;
}

import * as fs from 'node:fs';
import {existsSync} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Returns the user-level data directory.
 * Matches Gemini's behavior via xdg-basedir:
 * - All platforms: XDG_DATA_HOME or ~/.local/share
 *
 * Note: Gemini uses xdg-basedir which returns ~/.local/share on ALL platforms
 * including Windows, so we match that behavior exactly.
 */
export function getDataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

/**
 * Returns the Gemini storage directory path.
 * All platforms: ~/.local/share/gemini/storage
 * Fallback to 'opencode' if it exists and gemini doesn't (or has no data).
 */
export function getGeminiStorageDir(): string {
  const dataDir = getDataDir();
  const geminiPath = path.join(dataDir, 'gemini', 'storage');
  const opencodePath = path.join(dataDir, 'opencode', 'storage');

  // If gemini storage exists and has a message directory with entries, use it
  if (existsSync(path.join(geminiPath, 'message'))) {
    const messages = fs.readdirSync(path.join(geminiPath, 'message'));
    if (messages.length > 0) {
      return geminiPath;
    }
  }

  // Otherwise, if opencode storage exists, prefer it
  if (existsSync(opencodePath)) {
    return opencodePath;
  }

  return geminiPath;
}

/**
 * Returns the user-level cache directory.
 * Matches Gemini's behavior via xdg-basedir:
 * - All platforms: XDG_CACHE_HOME or ~/.cache
 */
export function getCacheDir(): string {
  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
}

/**
 * Returns the oh-my-gemini cache directory.
 * All platforms: ~/.cache/oh-my-gemini
 */
export function getOmgGeminiCacheDir(): string {
  return path.join(getCacheDir(), 'oh-my-gemini');
}

/**
 * Returns the Gemini cache directory (for reading Gemini's cache).
 * All platforms: ~/.cache/gemini
 */
export function getGeminiCacheDir(): string {
  return path.join(getCacheDir(), 'gemini');
}

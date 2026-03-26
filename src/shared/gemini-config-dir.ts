import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

export type GeminiBinaryType = 'gemini' | 'gemini-desktop';

export interface GeminiConfigDirOptions {
  binary: GeminiBinaryType;
  version?: string | null;
  checkExisting?: boolean;
}

export interface GeminiConfigPaths {
  configDir: string;
  configJson: string;
  configJsonc: string;
  packageJson: string;
  omgConfig: string;
}

export const TAURI_APP_IDENTIFIER = 'ai.gemini.desktop';
export const TAURI_APP_IDENTIFIER_DEV = 'ai.gemini.desktop.dev';

export function isDevBuild(version: string | null | undefined): boolean {
  if (!version) return false;
  return version.includes('-dev') || version.includes('.dev');
}

function getTauriConfigDir(identifier: string): string {
  const platform = process.platform;

  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', identifier);

    case 'win32': {
      const appData =
        process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
      return join(appData, identifier);
    }

    case 'linux':
    default: {
      const xdgConfig =
        process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
      return join(xdgConfig, identifier);
    }
  }
}

export function getCliConfigDir(): string {
  const envConfigDir = process.env.GEMINI_CONFIG_DIR?.trim();
  if (envConfigDir) {
    return resolve(envConfigDir);
  }

  if (process.platform === 'win32') {
    const crossPlatformDir = join(homedir(), '.config', 'gemini');
    const crossPlatformConfig = join(crossPlatformDir, 'gemini.json');

    if (existsSync(crossPlatformConfig)) {
      return crossPlatformDir;
    }

    const appData =
      process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    const appdataDir = join(appData, 'gemini');
    const appdataConfig = join(appdataDir, 'gemini.json');

    if (existsSync(appdataConfig)) {
      return appdataDir;
    }

    return crossPlatformDir;
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, 'gemini');
}

export function getGeminiConfigDir(options: GeminiConfigDirOptions): string {
  const {binary, version, checkExisting = true} = options;

  if (binary === 'gemini') {
    return getCliConfigDir();
  }

  const identifier = isDevBuild(version)
    ? TAURI_APP_IDENTIFIER_DEV
    : TAURI_APP_IDENTIFIER;
  const tauriDir = getTauriConfigDir(identifier);

  if (checkExisting) {
    const legacyDir = getCliConfigDir();
    const legacyConfig = join(legacyDir, 'gemini.json');
    const legacyConfigC = join(legacyDir, 'gemini.jsonc');

    if (existsSync(legacyConfig) || existsSync(legacyConfigC)) {
      return legacyDir;
    }
  }

  return tauriDir;
}

export function getGeminiConfigPaths(
  options: GeminiConfigDirOptions,
): GeminiConfigPaths {
  const configDir = getGeminiConfigDir(options);

  return {
    configDir,
    configJson: join(configDir, 'gemini.json'),
    configJsonc: join(configDir, 'gemini.jsonc'),
    packageJson: join(configDir, 'package.json'),
    omgConfig: join(configDir, 'omg-harness.json'),
  };
}

export function detectExistingConfigDir(
  binary: GeminiBinaryType,
  version?: string | null,
): string | null {
  const locations: string[] = [];

  const envConfigDir = process.env.GEMINI_CONFIG_DIR?.trim();
  if (envConfigDir) {
    locations.push(resolve(envConfigDir));
  }

  if (binary === 'gemini-desktop') {
    const identifier = isDevBuild(version)
      ? TAURI_APP_IDENTIFIER_DEV
      : TAURI_APP_IDENTIFIER;
    locations.push(getTauriConfigDir(identifier));

    if (isDevBuild(version)) {
      locations.push(getTauriConfigDir(TAURI_APP_IDENTIFIER));
    }
  }

  locations.push(getCliConfigDir());

  for (const dir of locations) {
    const configJson = join(dir, 'gemini.json');
    const configJsonc = join(dir, 'gemini.jsonc');

    if (existsSync(configJson) || existsSync(configJsonc)) {
      return dir;
    }
  }

  return null;
}

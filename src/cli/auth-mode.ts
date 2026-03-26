import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import color from 'picocolors';
import {detectVertexAI, addProviderConfig} from './config-manager';
import type {InstallConfig} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthMode = 'google-oauth' | 'vertex-ai' | 'api-key';

export interface AuthModeInfo {
  id: AuthMode;
  label: string;
  /** Value written to settings.json `security.auth.selectedType`. */
  settingsValue: string;
  available: boolean;
  active: boolean;
  claudeSupport: boolean;
  requirements: string[];
  missingRequirements: string[];
}

export interface AuthModeOptions {
  tui: boolean;
  auto?: boolean;
  mode?: AuthMode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYMBOLS = {
  check: color.green('[OK]'),
  cross: color.red('[X]'),
  arrow: color.cyan('->'),
  bullet: color.dim('*'),
  info: color.blue('[i]'),
  warn: color.yellow('[!]'),
  star: color.yellow('*'),
  active: color.green('*'),
};

/** Map our AuthMode ids to the Gemini CLI's `security.auth.selectedType` values. */
const SETTINGS_VALUES: Record<AuthMode, string> = {
  'google-oauth': 'oauth-personal',
  'vertex-ai': 'vertex-ai',
  'api-key': 'gemini-api-key',
};

const MODE_LABELS: Record<AuthMode, string> = {
  'google-oauth': 'Google OAuth (Login with Google)',
  'vertex-ai': 'Vertex AI (ADC + GCP Project)',
  'api-key': 'API Key (GEMINI_API_KEY)',
};

const ALL_MODES: AuthMode[] = ['google-oauth', 'vertex-ai', 'api-key'];

// ---------------------------------------------------------------------------
// Settings file helpers
// ---------------------------------------------------------------------------

function getGeminiSettingsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.gemini');
}

function getGeminiSettingsPath(): string {
  return join(getGeminiSettingsDir(), 'settings.json');
}

interface GeminiSettings {
  security?: {
    auth?: {
      selectedType?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function readSettings(): GeminiSettings {
  const settingsPath = getGeminiSettingsPath();
  if (!existsSync(settingsPath)) return {};
  try {
    const content = readFileSync(settingsPath, 'utf-8');
    if (!content.trim()) return {};
    return JSON.parse(content) as GeminiSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: GeminiSettings): void {
  const dir = getGeminiSettingsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, {recursive: true});
  }
  writeFileSync(getGeminiSettingsPath(), JSON.stringify(settings, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function getActiveAuthMode(): AuthMode | null {
  const settings = readSettings();
  const selectedType = settings.security?.auth?.selectedType;
  if (!selectedType) return null;

  for (const mode of ALL_MODES) {
    if (SETTINGS_VALUES[mode] === selectedType) return mode;
  }
  return null;
}

export function detectAuthModes(): AuthModeInfo[] {
  const activeMode = getActiveAuthMode();
  const vertexStatus = detectVertexAI();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const adcPath = join(homeDir, '.config/gcloud/application_default_credentials.json');
  const hasADC = existsSync(adcPath);

  const modes: AuthModeInfo[] = [
    {
      id: 'google-oauth',
      label: MODE_LABELS['google-oauth'],
      settingsValue: SETTINGS_VALUES['google-oauth'],
      available: true,
      active: activeMode === 'google-oauth',
      claudeSupport: false,
      requirements: ['Browser (for login)'],
      missingRequirements: [],
    },
    (() => {
      const requirements = ['gcloud CLI', 'ADC credentials', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'];
      const missing: string[] = [];
      // We check env-based availability synchronously
      if (!hasADC) missing.push('ADC credentials');
      if (!vertexStatus.project) missing.push('GOOGLE_CLOUD_PROJECT');
      if (!vertexStatus.location) missing.push('GOOGLE_CLOUD_LOCATION');
      const available = hasADC && !!vertexStatus.project && !!vertexStatus.location;
      return {
        id: 'vertex-ai' as AuthMode,
        label: MODE_LABELS['vertex-ai'],
        settingsValue: SETTINGS_VALUES['vertex-ai'],
        available,
        active: activeMode === 'vertex-ai',
        claudeSupport: true,
        requirements,
        missingRequirements: missing,
      };
    })(),
    {
      id: 'api-key',
      label: MODE_LABELS['api-key'],
      settingsValue: SETTINGS_VALUES['api-key'],
      available: !!process.env.GEMINI_API_KEY,
      active: activeMode === 'api-key',
      claudeSupport: false,
      requirements: ['GEMINI_API_KEY env var'],
      missingRequirements: process.env.GEMINI_API_KEY ? [] : ['GEMINI_API_KEY env var'],
    },
  ];

  return modes;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyAuthMode(mode: AuthMode): {success: boolean; error?: string} {
  try {
    // 1. Write selectedType to settings.json
    const settings = readSettings();
    if (!settings.security) settings.security = {};
    if (!settings.security.auth) settings.security.auth = {};
    settings.security.auth.selectedType = SETTINGS_VALUES[mode];
    writeSettings(settings);

    // 2. Set process env vars for the current session
    switch (mode) {
      case 'google-oauth':
        process.env.GOOGLE_GENAI_USE_GCA = 'true';
        delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
        break;
      case 'vertex-ai':
        process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
        delete process.env.GOOGLE_GENAI_USE_GCA;
        break;
      case 'api-key':
        delete process.env.GOOGLE_GENAI_USE_GCA;
        delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
        break;
    }

    // 3. Update provider config (add/remove Claude models)
    const installConfig: InstallConfig = {
      hasGemini: true,
      hasVertexAI: mode === 'vertex-ai',
    };
    addProviderConfig(installConfig);

    return {success: true};
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Auto-select
// ---------------------------------------------------------------------------

export function autoSelectAuthMode(): AuthMode {
  const modes = detectAuthModes();
  const vertexAI = modes.find((m) => m.id === 'vertex-ai');
  if (vertexAI?.available) return 'vertex-ai';

  const apiKey = modes.find((m) => m.id === 'api-key');
  if (apiKey?.available) return 'api-key';

  return 'google-oauth';
}

// ---------------------------------------------------------------------------
// Non-TUI flow
// ---------------------------------------------------------------------------

function printModeStatus(info: AuthModeInfo): void {
  const activeMarker = info.active ? color.green(' (active)') : '';
  const availableMarker = info.available ? SYMBOLS.check : color.dim('[-]');
  const claudeMarker = info.claudeSupport ? color.cyan(' [Claude]') : '';

  console.log(`  ${availableMarker} ${info.label}${claudeMarker}${activeMarker}`);

  if (info.missingRequirements.length > 0) {
    console.log(`      ${color.dim('Missing:')} ${color.yellow(info.missingRequirements.join(', '))}`);
  }
}

async function runNonTuiAuthMode(options: AuthModeOptions): Promise<number> {
  console.log();
  console.log(color.bgMagenta(color.white(' Auth Mode ')));
  console.log();

  if (options.auto) {
    const selected = autoSelectAuthMode();
    const result = applyAuthMode(selected);
    if (!result.success) {
      console.log(`${SYMBOLS.cross} Failed to apply auth mode: ${result.error}`);
      return 1;
    }
    const label = MODE_LABELS[selected];
    const reason =
      selected === 'vertex-ai'
        ? 'Vertex AI fully configured (ADC + project + location)'
        : selected === 'api-key'
          ? 'GEMINI_API_KEY is set'
          : 'Default (Google OAuth)';
    console.log(`${SYMBOLS.check} Auto-selected: ${color.cyan(label)}`);
    console.log(`${SYMBOLS.info} Reason: ${reason}`);
    console.log(`${SYMBOLS.info} Settings updated: ${color.dim(getGeminiSettingsPath())}`);
    console.log();
    return 0;
  }

  if (options.mode) {
    if (!ALL_MODES.includes(options.mode)) {
      console.log(`${SYMBOLS.cross} Unknown mode: ${options.mode}`);
      console.log(`${SYMBOLS.info} Valid modes: ${ALL_MODES.join(', ')}`);
      return 1;
    }
    const result = applyAuthMode(options.mode);
    if (!result.success) {
      console.log(`${SYMBOLS.cross} Failed to apply auth mode: ${result.error}`);
      return 1;
    }
    console.log(`${SYMBOLS.check} Auth mode set to: ${color.cyan(MODE_LABELS[options.mode])}`);
    console.log(`${SYMBOLS.info} Settings updated: ${color.dim(getGeminiSettingsPath())}`);
    console.log();
    return 0;
  }

  // Default: show status
  const modes = detectAuthModes();
  const active = modes.find((m) => m.active);

  console.log(color.bold('Current Auth Mode'));
  console.log(color.dim('─'.repeat(40)));
  if (active) {
    console.log(`  ${SYMBOLS.active} ${color.green(active.label)}`);
  } else {
    console.log(`  ${color.dim('No auth mode selected')}`);
  }
  console.log();

  console.log(color.bold('Available Modes'));
  console.log(color.dim('─'.repeat(40)));
  for (const m of modes) {
    printModeStatus(m);
  }
  console.log();

  console.log(color.dim('To switch modes:'));
  console.log(`  ${color.cyan('bunx oh-my-gemini auth-mode --auto')}          ${color.dim('Auto-detect best mode')}`);
  console.log(`  ${color.cyan('bunx oh-my-gemini auth-mode --mode vertex-ai')} ${color.dim('Set specific mode')}`);
  console.log(`  ${color.cyan('bunx oh-my-gemini auth-mode')}                  ${color.dim('Interactive selector (TUI)')}`);
  console.log();
  return 0;
}

// ---------------------------------------------------------------------------
// TUI flow
// ---------------------------------------------------------------------------

async function runTuiAuthMode(_options: AuthModeOptions): Promise<number> {
  const pkg = '@clack/prompts';
  const p = await import(pkg);

  p.intro(color.bgMagenta(color.white(' Auth Mode Selector ')));

  const modes = detectAuthModes();
  const active = modes.find((m) => m.active);

  // Show current status
  if (active) {
    p.log.info(`Current mode: ${color.green(active.label)}`);
  } else {
    p.log.warn('No auth mode currently selected');
  }

  // Build selection options
  const selectOptions = modes.map((m) => {
    const status = m.available ? color.green('available') : color.yellow('unavailable');
    const claudeTag = m.claudeSupport ? color.cyan(' [Claude]') : '';
    const activeTag = m.active ? color.green(' (active)') : '';
    const missing =
      m.missingRequirements.length > 0
        ? color.dim(` — missing: ${m.missingRequirements.join(', ')}`)
        : '';

    return {
      value: m.id,
      label: `${m.label}${claudeTag}${activeTag}`,
      hint: `${status}${missing}`,
    };
  });

  const selected = await p.select({
    message: 'Select auth mode:',
    options: selectOptions,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    return 1;
  }

  const selectedMode = selected as AuthMode;
  const selectedInfo = modes.find((m) => m.id === selectedMode)!;

  // If Vertex AI selected and not fully configured, offer to run setup
  if (selectedMode === 'vertex-ai' && !selectedInfo.available) {
    p.log.warn('Vertex AI is not fully configured yet.');

    if (selectedInfo.missingRequirements.length > 0) {
      p.log.info(`Missing: ${color.yellow(selectedInfo.missingRequirements.join(', '))}`);
    }

    const runSetup = await p.confirm({
      message: 'Run Vertex AI setup wizard?',
      initialValue: true,
    });

    if (p.isCancel(runSetup)) {
      p.cancel('Cancelled');
      return 1;
    }

    if (runSetup) {
      p.log.info(`Run: ${color.cyan('bunx oh-my-gemini setup-vertex-ai')}`);
      p.outro(color.yellow('Complete Vertex AI setup first, then re-run auth-mode.'));
      return 0;
    }

    // User chose to set it anyway (e.g. they'll configure env vars later)
    p.log.warn('Setting Vertex AI mode without full configuration. Claude models may not work.');
  }

  // If the selected mode is not available, warn but allow
  if (!selectedInfo.available && selectedMode !== 'vertex-ai') {
    p.log.warn(`${selectedInfo.label} is not fully configured.`);
    if (selectedInfo.missingRequirements.length > 0) {
      p.log.info(`Missing: ${color.yellow(selectedInfo.missingRequirements.join(', '))}`);
    }

    const proceed = await p.confirm({
      message: 'Set this mode anyway?',
      initialValue: false,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Cancelled');
      return 1;
    }
  }

  // Apply
  const s = p.spinner();
  s.start('Applying auth mode');

  const result = applyAuthMode(selectedMode);
  if (!result.success) {
    s.stop(`Failed: ${result.error}`);
    p.outro(color.red('Auth mode switch failed'));
    return 1;
  }

  s.stop(`Auth mode set to ${color.cyan(MODE_LABELS[selectedMode])}`);

  p.note(
    [
      `${color.bold('Mode:')}     ${MODE_LABELS[selectedMode]}`,
      `${color.bold('Settings:')} ${color.dim(getGeminiSettingsPath())}`,
      `${color.bold('Claude:')}   ${selectedInfo.claudeSupport ? color.green('supported') : color.dim('not available')}`,
      '',
      color.dim('The Gemini CLI will use this mode on next start.'),
    ].join('\n'),
    'Auth Mode Updated',
  );

  p.outro(color.green('Done!'));
  return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function authMode(options: AuthModeOptions): Promise<number> {
  if (options.tui && !options.auto && !options.mode) {
    return runTuiAuthMode(options);
  }
  return runNonTuiAuthMode(options);
}

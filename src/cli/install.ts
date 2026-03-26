import {existsSync, mkdirSync} from 'node:fs';
import color from 'picocolors';
import packageJson from '../../package.json' with {type: 'json'};
import {
  addAuthPlugins,
  addPluginToGeminiConfig,
  addProviderConfig,
  detectCurrentConfig,
  writeAbsolutePathConfigs,
  detectVertexAI,
  getGeminiBinaryPath,
  getGeminiVersion,
  isGeminiInstalled,
  writeOmgConfig,
} from './config-manager';
import {autoSelectAuthMode, applyAuthMode, getActiveAuthMode} from './auth-mode';
import type {DetectedConfig, InstallArgs, InstallConfig} from './types';

const VERSION = packageJson.version;

const SYMBOLS = {
  check: color.green('[OK]'),
  cross: color.red('[X]'),
  arrow: color.cyan('->'),
  bullet: color.dim('*'),
  info: color.blue('[i]'),
  warn: color.yellow('[!]'),
  star: color.yellow('*'),
};

function formatProvider(
  name: string,
  enabled: boolean,
  detail?: string,
): string {
  const status = enabled ? SYMBOLS.check : color.dim('○');
  const label = enabled ? color.white(name) : color.dim(name);
  const suffix = detail ? color.dim(` (${detail})`) : '';
  return `  ${status} ${label}${suffix}`;
}

function formatConfigSummary(config: InstallConfig): string {
  const lines: string[] = [];

  lines.push(color.bold(color.white('Configuration Summary')));
  lines.push('');

  lines.push(formatProvider('Gemini', config.hasGemini));
  if (config.hasVertexAI) {
    lines.push(
      formatProvider(
        'Vertex AI (Claude)',
        true,
        'claude-opus-4-6, claude-sonnet-4-5',
      ),
    );
  }

  lines.push('');
  lines.push(color.dim('─'.repeat(40)));
  lines.push('');

  const activeMode = getActiveAuthMode();
  const authModeLabels: Record<string, string> = {
    'vertex-ai': 'Vertex AI',
    'api-key': 'API Key',
    'google-oauth': 'Google OAuth',
  };
  lines.push(color.bold(color.white('Auth Mode')));
  lines.push('');
  lines.push(`  ${SYMBOLS.info} Active: ${color.cyan(activeMode ? (authModeLabels[activeMode] ?? activeMode) : 'not set')}`);
  lines.push(`  ${SYMBOLS.info} Switch: ${color.dim('bunx oh-my-gemini auth-mode')}`);

  lines.push('');
  lines.push(color.dim('─'.repeat(40)));
  lines.push('');

  lines.push(color.bold(color.white('Model Assignment')));
  lines.push('');
  lines.push(`  ${SYMBOLS.info} Models auto-configured for Gemini CLI`);
  if (config.hasVertexAI) {
    lines.push(
      `  ${SYMBOLS.info} Claude models available via Vertex AI MaaS`,
    );
  }

  return lines.join('\n');
}

function printHeader(isUpdate: boolean): void {
  const mode = isUpdate ? 'Update' : 'Install';
  console.log();
  console.log(color.bgMagenta(color.white(` oMgMgMgMgMg... ${mode} `)));
  console.log();
}

function printStep(step: number, total: number, message: string): void {
  const progress = color.dim(`[${step}/${total}]`);
  console.log(`${progress} ${message}`);
}

function printSuccess(message: string): void {
  console.log(`${SYMBOLS.check} ${message}`);
}

function printError(message: string): void {
  console.log(`${SYMBOLS.cross} ${color.red(message)}`);
}

function printInfo(message: string): void {
  console.log(`${SYMBOLS.info} ${message}`);
}

function printWarning(message: string): void {
  console.log(`${SYMBOLS.warn} ${color.yellow(message)}`);
}

function printBox(content: string, title?: string): void {
  const lines = content.split('\n');
  const maxWidth =
    Math.max(
      ...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length),
      title?.length ?? 0,
    ) + 4;
  const border = color.dim('─'.repeat(maxWidth));

  console.log();
  if (title) {
    console.log(
      color.dim('┌─') +
        color.bold(` ${title} `) +
        color.dim('─'.repeat(maxWidth - title.length - 4)) +
        color.dim('┐'),
    );
  } else {
    console.log(color.dim('┌') + border + color.dim('┐'));
  }

  for (const line of lines) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = maxWidth - stripped.length;
    console.log(
      color.dim('│') + ` ${line}${' '.repeat(padding - 1)}` + color.dim('│'),
    );
  }

  console.log(color.dim('└') + border + color.dim('┘'));
  console.log();
}

function argsToConfig(_args: InstallArgs): InstallConfig {
  return {
    hasGemini: true,
  };
}

/** Ensure BUN_CONFIG_REGISTRY is set for npm access in restricted environments. */
function ensureBunRegistry(): void {
  if (!process.env.BUN_CONFIG_REGISTRY) {
    process.env.BUN_CONFIG_REGISTRY = 'https://registry.npmjs.org';
  }
}

/** Check if a system binary is available. */
async function isBinaryAvailable(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', name], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

interface SystemDep {
  name: string;
  required: boolean;
  installHint: string;
  purpose: string;
}

const SYSTEM_DEPS: SystemDep[] = [
  {
    name: 'gh',
    required: false,
    installHint: 'https://cli.github.com or: sudo apt install gh',
    purpose: 'Librarian agent (GitHub repo cloning, issues, PRs, code search)',
  },
];

/** Clone oh-my-opencode third party dependency. */
async function cloneThirdPartyOpencode(): Promise<{
  success: boolean;
  error?: string;
}> {
  const extDir = import.meta.dir.replace(/\/src\/cli$/, '');
  const thirdPartyDir = `${extDir}/third_party`;
  const targetDir = `${thirdPartyDir}/oh-my-opencode`;
  
  if (existsSync(targetDir)) {
    return {success: true};
  }

  if (!existsSync(thirdPartyDir)) {
    mkdirSync(thirdPartyDir, { recursive: true });
  }

  try {
    const proc = Bun.spawn(
      ['git', 'clone', 'https://github.com/code-yeongyu/oh-my-opencode.git', 'third_party/oh-my-opencode'],
      {
        cwd: extDir,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        error: stderr.trim() || `exit code ${proc.exitCode}`,
      };
    }
    return {success: true};
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run `bun install` in the extension directory. */
async function runBunInstallInExtDir(): Promise<{
  success: boolean;
  error?: string;
}> {
  ensureBunRegistry();
  try {
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: import.meta.dir.replace(/\/src\/cli$/, ''),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {...process.env},
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        error: stderr.trim() || `exit code ${proc.exitCode}`,
      };
    }
    return {success: true};
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run `bun run build` in the extension directory. */
async function runBuild(): Promise<{success: boolean; error?: string}> {
  ensureBunRegistry();
  const extDir = import.meta.dir.replace(/\/src\/cli$/, '');
  try {
    const proc = Bun.spawn(['bun', 'run', 'build'], {
      cwd: extDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {...process.env},
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        error: stderr.trim() || `exit code ${proc.exitCode}`,
      };
    }
    return {success: true};
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run `gemini extensions link .` to register the extension. */
async function linkExtension(): Promise<{success: boolean; error?: string}> {
  const geminiBinary = await getGeminiBinaryPath();
  if (!geminiBinary) {
    return {
      success: false,
      error: 'Gemini binary not found. Cannot link extension.',
    };
  }

  const extDir = import.meta.dir.replace(/\/src\/cli$/, '');
  try {
    const proc = Bun.spawn([geminiBinary, 'extensions', 'link', '.', '--consent'], {
      cwd: extDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      // If already linked, treat as success
      if (stderr.includes('already') || stderr.includes('exists')) {
        return {success: true};
      }
      return {
        success: false,
        error: stderr.trim() || `exit code ${proc.exitCode}`,
      };
    }
    return {success: true};
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check if `dist/` exists and has the required files. */
function isBuilt(): boolean {
  const extDir = import.meta.dir.replace(/\/src\/cli$/, '');
  return (
    existsSync(`${extDir}/dist/index.js`) &&
    existsSync(`${extDir}/dist/cli/index.js`)
  );
}

async function runNonTuiInstall(args: InstallArgs): Promise<number> {
  const detected = detectCurrentConfig();
  const isUpdate = detected.isInstalled;

  printHeader(isUpdate);

  const totalSteps = 13;
  let step = 1;

  // Step 1: Check Gemini
  printStep(step++, totalSteps, 'Checking Gemini installation...');
  const installed = await isGeminiInstalled();
  const version = await getGeminiVersion();
  if (!installed) {
    printWarning(
      "Gemini binary not found. Plugin will be configured, but you'll need to install Gemini to use it.",
    );
    printInfo('Visit https://gemini.ai/docs for installation instructions');
  } else {
    printSuccess(`Gemini ${version ?? ''} detected`);
  }

  const config = argsToConfig(args);

  // Step 2: Detect Vertex AI for Claude models
  printStep(step++, totalSteps, 'Detecting Vertex AI configuration...');
  const vertexAI = detectVertexAI();
  if (vertexAI.enabled && vertexAI.hasADC) {
    config.hasVertexAI = true;
    printSuccess(
      `Vertex AI enabled (project: ${vertexAI.project ?? 'default'}, location: ${vertexAI.location ?? 'default'})`,
    );
    printInfo('Claude models will be available via Vertex AI MaaS');
  } else if (vertexAI.enabled && !vertexAI.hasADC) {
    printWarning('GOOGLE_GENAI_USE_VERTEXAI=true but no ADC credentials found');
    printInfo(
      'Run: bunx oh-my-gemini setup-vertex-ai',
    );
  } else {
    printInfo('Vertex AI not configured (Claude models will not be available)');
    printInfo(
      'To enable: bunx oh-my-gemini setup-vertex-ai',
    );
  }

  // Auto-select auth mode
  printStep(step++, totalSteps, 'Auto-selecting auth mode...');
  const selectedAuthMode = autoSelectAuthMode();
  const autoAuthApplyResult = applyAuthMode(selectedAuthMode);
  if (autoAuthApplyResult.success) {
    const modeLabels: Record<string, string> = {
      'vertex-ai': 'Vertex AI (Claude + Gemini)',
      'api-key': 'API Key',
      'google-oauth': 'Google OAuth (free tier)',
    };
    printSuccess(`Auth mode set to ${modeLabels[selectedAuthMode] ?? selectedAuthMode}`);
  } else {
    printWarning(`Could not auto-select auth mode: ${autoAuthApplyResult.error}`);
  }

  // Step 3: Check system dependencies
  printStep(step++, totalSteps, 'Checking system dependencies...');
  const missingDeps: SystemDep[] = [];
  for (const dep of SYSTEM_DEPS) {
    const available = await isBinaryAvailable(dep.name);
    if (available) {
      printSuccess(`${dep.name} found`);
    } else {
      missingDeps.push(dep);
      if (dep.required) {
        printError(`${dep.name} not found (required for: ${dep.purpose})`);
        printInfo(`Install: ${dep.installHint}`);
      } else {
        printWarning(
          `${dep.name} not found (optional, needed for: ${dep.purpose})`,
        );
        printInfo(`Install: ${dep.installHint}`);
      }
    }
  }
  if (missingDeps.some((d) => d.required)) {
    printError('Required dependencies missing. Install them and try again.');
    return 1;
  }

  // Step 4: Clone third-party dependencies
  printStep(step++, totalSteps, 'Cloning third-party dependencies...');
  const cloneResult = await cloneThirdPartyOpencode();
  if (!cloneResult.success) {
    printWarning(`Clone failed: ${cloneResult.error}`);
    printInfo(
      'Try running manually: git clone https://github.com/code-yeongyu/oh-my-opencode.git third_party/oh-my-opencode'
    );
  } else {
    printSuccess('Third-party dependencies cloned');
  }

  // Step 5: Install dependencies
  printStep(step++, totalSteps, 'Installing dependencies...');
  const installResult = await runBunInstallInExtDir();
  if (!installResult.success) {
    printWarning(`bun install failed: ${installResult.error}`);
    printInfo(
      'Try running manually: BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun install',
    );
  } else {
    printSuccess('Dependencies installed');
  }

  // Step 4: Build the extension
  printStep(step++, totalSteps, 'Building extension...');
  if (isBuilt() && isUpdate) {
    // Rebuild on update to pick up changes
    const buildResult = await runBuild();
    if (!buildResult.success) {
      printWarning(`Build failed: ${buildResult.error}`);
      printInfo('Try running manually: bun run build');
    } else {
      printSuccess('Extension rebuilt');
    }
  } else if (!isBuilt()) {
    const buildResult = await runBuild();
    if (!buildResult.success) {
      printError(`Build failed: ${buildResult.error}`);
      printInfo('Try running manually: bun run build');
      return 1;
    }
    printSuccess('Extension built');
  } else {
    printSuccess('Extension already built');
  }

  // Write absolute paths into hooks/hooks.json and gemini-extension.json so
  // that hooks and the MCP server work from any working directory.
  printStep(step++, totalSteps, 'Writing absolute-path configs...');
  const extDir = import.meta.dir.replace(/\/src\/cli$/, '');
  const absPathResult = writeAbsolutePathConfigs(extDir);
  if (!absPathResult.success) {
    printWarning(`Absolute-path config failed: ${absPathResult.error}`);
  } else {
    printSuccess('hooks/hooks.json and gemini-extension.json updated with absolute paths');
  }

  // Step 5: Add plugin to gemini config
  printStep(step++, totalSteps, 'Adding oh-my-gemini plugin...');
  const pluginResult = await addPluginToGeminiConfig(VERSION);
  if (!pluginResult.success) {
    printError(`Failed: ${pluginResult.error}`);
    return 1;
  }
  printSuccess(
    `Plugin ${isUpdate ? 'verified' : 'added'} ${SYMBOLS.arrow} ${color.dim(pluginResult.configPath)}`,
  );

  // Step 6: Add auth plugins
  printStep(step++, totalSteps, 'Adding auth plugins...');
  const authResult = await addAuthPlugins(config);
  if (!authResult.success) {
    printError(`Failed: ${authResult.error}`);
    return 1;
  }
  printSuccess(
    `Auth plugins configured ${SYMBOLS.arrow} ${color.dim(authResult.configPath)}`,
  );

  // Step 7: Add provider configurations
  printStep(step++, totalSteps, 'Adding provider configurations...');
  const providerResult = addProviderConfig(config);
  if (!providerResult.success) {
    printError(`Failed: ${providerResult.error}`);
    return 1;
  }
  printSuccess(
    `Providers configured ${SYMBOLS.arrow} ${color.dim(providerResult.configPath)}`,
  );

  // Step 8: Write oh-my-gemini configuration
  printStep(step++, totalSteps, 'Writing oh-my-gemini configuration...');
  const omoResult = writeOmgConfig(config);
  if (!omoResult.success) {
    printError(`Failed: ${omoResult.error}`);
    return 1;
  }
  printSuccess(
    `Config written ${SYMBOLS.arrow} ${color.dim(omoResult.configPath)}`,
  );

  // Step 9: Link extension with Gemini CLI
  printStep(step++, totalSteps, 'Linking extension with Gemini CLI...');
  if (installed) {
    const linkResult = await linkExtension();
    if (!linkResult.success) {
      printWarning(`Extension link failed: ${linkResult.error}`);
      printInfo('Try running manually: gemini extensions link .');
    } else {
      printSuccess('Extension linked with Gemini CLI');
    }
  } else {
    printInfo(
      'Skipped (Gemini not found). Run `gemini extensions link .` after installing Gemini.',
    );
  }

  printBox(
    formatConfigSummary(config),
    isUpdate ? 'Updated Configuration' : 'Installation Complete',
  );

  console.log(
    `${SYMBOLS.star} ${color.bold(color.green(isUpdate ? 'Configuration updated!' : 'Installation complete!'))}`,
  );
  console.log(`  Run ${color.cyan('gemini')} to start!`);
  console.log();

  printBox(
    `${color.bold('Pro Tip:')} Include ${color.cyan('ultrawork')} (or ${color.cyan('ulw')}) in your prompt.\n` +
      `All features work like magic—parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    'The Magic Word',
  );

  console.log(
    `${SYMBOLS.star} ${color.yellow('If you found this helpful, consider starring the repo!')}`,
  );
  console.log(
    `  ${color.dim('gh api --silent --method PUT /user/starred/agi-explorer-sean/omg-harness >/dev/null 2>&1 || true')}`,
  );
  console.log();
  console.log(color.dim('oMgMgMgMgMg... Enjoy!'));
  console.log();

  if (!args.skipAuth && selectedAuthMode === 'google-oauth') {
    printBox(
      `Run ${color.cyan('gemini auth login')} and select your provider:\n` +
        `  ${SYMBOLS.bullet} Google\n`,
      'Authenticate Your Providers',
    );
  }

  return 0;
}

async function getPrompts() {
  const pkg = '@clack/prompts';
  return await import(pkg);
}

export async function install(args: InstallArgs): Promise<number> {
  const p = await getPrompts();
  if (!args.tui) {
    return runNonTuiInstall(args);
  }

  const detected = detectCurrentConfig();
  const isUpdate = detected.isInstalled;

  p.intro(
    color.bgMagenta(
      color.white(isUpdate ? ' oMgMgMgMgMg... Update ' : ' oMgMgMgMgMg... '),
    ),
  );

  const s = p.spinner();

  // Step 1: Check Gemini installation
  s.start('Checking Gemini installation');
  const installed = await isGeminiInstalled();
  const version = await getGeminiVersion();
  if (!installed) {
    s.stop(`Gemini binary not found ${color.yellow('[!]')}`);
    p.log.warn(
      "Gemini binary not found. Plugin will be configured, but you'll need to install Gemini to use it.",
    );
    p.note(
      'Visit https://gemini.ai/docs for installation instructions',
      'Installation Guide',
    );
  } else {
    s.stop(`Gemini ${version ?? 'installed'} ${color.green('[OK]')}`);
  }

  const config: InstallConfig = {
    hasGemini: true,
  };

  // Step 2: Detect Vertex AI
  s.start('Detecting Vertex AI configuration');
  const vertexAI = detectVertexAI();
  if (vertexAI.enabled && vertexAI.hasADC) {
    config.hasVertexAI = true;
    s.stop(
      `Vertex AI enabled (project: ${vertexAI.project ?? 'default'}) ${color.green('[OK]')}`,
    );
    p.log.info('Claude models will be available via Vertex AI MaaS');
  } else if (vertexAI.enabled && !vertexAI.hasADC) {
    s.stop(`Vertex AI: missing ADC credentials ${color.yellow('[!]')}`);
    p.log.warn(`Run: ${color.cyan('bunx oh-my-gemini setup-vertex-ai')}`);
  } else {
    s.stop(`Vertex AI not configured ${color.dim('[skip]')}`);
    p.log.info(
      `To enable Claude models: ${color.cyan('bunx oh-my-gemini setup-vertex-ai')}`,
    );
  }

  // Auto-select auth mode
  s.start('Auto-selecting auth mode');
  const selectedAuthMode = autoSelectAuthMode();
  const autoAuthResult = applyAuthMode(selectedAuthMode);
  if (autoAuthResult.success) {
    const modeLabels: Record<string, string> = {
      'vertex-ai': 'Vertex AI (Claude + Gemini)',
      'api-key': 'API Key',
      'google-oauth': 'Google OAuth (free tier)',
    };
    s.stop(`Auth mode: ${modeLabels[selectedAuthMode] ?? selectedAuthMode} ${color.green('[OK]')}`);
  } else {
    s.stop(`Auth mode auto-select failed ${color.yellow('[!]')}`);
    p.log.warn(`Could not auto-select: ${autoAuthResult.error}`);
  }

  // Step 3: Check system dependencies
  s.start('Checking system dependencies');
  const missingDepsTui: SystemDep[] = [];
  for (const dep of SYSTEM_DEPS) {
    const available = await isBinaryAvailable(dep.name);
    if (!available) {
      missingDepsTui.push(dep);
    }
  }
  if (missingDepsTui.length > 0) {
    const missingNames = missingDepsTui.map((d) => d.name).join(', ');
    s.stop(`Missing optional: ${missingNames} ${color.yellow('[!]')}`);
    for (const dep of missingDepsTui) {
      p.log.warn(`${dep.name}: ${dep.purpose}`);
      p.log.info(`  Install: ${dep.installHint}`);
    }
    if (missingDepsTui.some((d) => d.required)) {
      p.outro(color.red('Required dependencies missing.'));
      return 1;
    }
  } else {
    s.stop(`All system dependencies found ${color.green('[OK]')}`);
  }

  // Step 4: Clone third-party dependencies
  s.start('Cloning third-party dependencies');
  const cloneResultTui = await cloneThirdPartyOpencode();
  if (!cloneResultTui.success) {
    s.stop(`Clone failed: ${cloneResultTui.error} ${color.yellow('[!]')}`);
    p.log.warn('Try running manually: git clone https://github.com/code-yeongyu/oh-my-opencode.git third_party/oh-my-opencode');
  } else {
    s.stop(`Third-party dependencies cloned ${color.green('[OK]')}`);
  }

  // Step 5: Install dependencies
  s.start('Installing dependencies');
  const installResult = await runBunInstallInExtDir();
  if (!installResult.success) {
    s.stop(`bun install failed: ${installResult.error} ${color.yellow('[!]')}`);
    p.log.warn(
      'Try running manually: BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun install',
    );
  } else {
    s.stop(`Dependencies installed ${color.green('[OK]')}`);
  }

  // Step 5: Build extension
  s.start('Building extension');
  if (isBuilt() && isUpdate) {
    const buildResult = await runBuild();
    if (!buildResult.success) {
      s.stop(`Build failed ${color.yellow('[!]')}`);
      p.log.warn(`Build error: ${buildResult.error}`);
      p.log.warn('Try running manually: bun run build');
    } else {
      s.stop(`Extension rebuilt ${color.green('[OK]')}`);
    }
  } else if (!isBuilt()) {
    const buildResult = await runBuild();
    if (!buildResult.success) {
      s.stop(`Build failed ${color.red('[X]')}`);
      p.log.error(`Build error: ${buildResult.error}`);
      p.log.warn('Try running manually: bun run build');
      p.outro(color.red('Installation failed.'));
      return 1;
    }
    s.stop(`Extension built ${color.green('[OK]')}`);
  } else {
    s.stop(`Extension already built ${color.green('[OK]')}`);
  }

  // Write absolute paths into hooks/hooks.json and gemini-extension.json.
  s.start('Writing absolute-path configs');
  const tuiExtDir = import.meta.dir.replace(/\/src\/cli$/, '');
  const tuiAbsPathResult = writeAbsolutePathConfigs(tuiExtDir);
  if (!tuiAbsPathResult.success) {
    s.stop(`Absolute-path config failed ${color.yellow('[!]')}`);
    p.log.warn(`Error: ${tuiAbsPathResult.error}`);
  } else {
    s.stop(`Absolute-path configs written ${color.green('[OK]')}`);
  }

  // Step 6: Add plugin to config
  s.start('Adding oh-my-gemini to Gemini config');
  const pluginResult = await addPluginToGeminiConfig(VERSION);
  if (!pluginResult.success) {
    s.stop(`Failed to add plugin: ${pluginResult.error}`);
    p.outro(color.red('Installation failed.'));
    return 1;
  }
  s.stop(`Plugin added to ${color.cyan(pluginResult.configPath)}`);

  // Step 7: Auth plugins
  s.start('Adding auth plugins (fetching latest versions)');
  const authResult = await addAuthPlugins(config);
  if (!authResult.success) {
    s.stop(`Failed to add auth plugins: ${authResult.error}`);
    p.outro(color.red('Installation failed.'));
    return 1;
  }
  s.stop(`Auth plugins added to ${color.cyan(authResult.configPath)}`);

  // Step 8: Provider configurations
  s.start('Adding provider configurations');
  const providerResult = addProviderConfig(config);
  if (!providerResult.success) {
    s.stop(`Failed to add provider config: ${providerResult.error}`);
    p.outro(color.red('Installation failed.'));
    return 1;
  }
  s.stop(`Provider config added to ${color.cyan(providerResult.configPath)}`);

  // Step 9: Write oh-my-gemini config
  s.start('Writing oh-my-gemini configuration');
  const omoResult = writeOmgConfig(config);
  if (!omoResult.success) {
    s.stop(`Failed to write config: ${omoResult.error}`);
    p.outro(color.red('Installation failed.'));
    return 1;
  }
  s.stop(`Config written to ${color.cyan(omoResult.configPath)}`);

  // Step 10: Link extension
  s.start('Linking extension with Gemini CLI');
  if (installed) {
    const linkResult = await linkExtension();
    if (!linkResult.success) {
      s.stop(`Extension link failed ${color.yellow('[!]')}`);
      p.log.warn(`Link error: ${linkResult.error}`);
      p.log.warn('Try running manually: gemini extensions link .');
    } else {
      s.stop(`Extension linked ${color.green('[OK]')}`);
    }
  } else {
    s.stop(`Skipped (Gemini not found) ${color.yellow('[!]')}`);
    p.log.info('Run `gemini extensions link .` after installing Gemini.');
  }

  p.note(
    formatConfigSummary(config),
    isUpdate ? 'Updated Configuration' : 'Installation Complete',
  );

  p.log.success(
    color.bold(isUpdate ? 'Configuration updated!' : 'Installation complete!'),
  );
  p.log.message(`Run ${color.cyan('gemini')} to start!`);

  p.note(
    `Include ${color.cyan('ultrawork')} (or ${color.cyan('ulw')}) in your prompt.\n` +
      `All features work like magic—parallel agents, background tasks,\n` +
      `deep exploration, and relentless execution until completion.`,
    'The Magic Word',
  );

  p.log.message(
    `${color.yellow('★')} If you found this helpful, consider starring the repo!`,
  );
  p.log.message(
    `  ${color.dim('gh api --silent --method PUT /user/starred/agi-explorer-sean/omg-harness >/dev/null 2>&1 || true')}`,
  );

  p.outro(color.green('oMgMgMgMgMg... Enjoy!'));

  if (!args.skipAuth && selectedAuthMode === 'google-oauth') {
    console.log();
    console.log(color.bold('Authenticate Your Providers'));
    console.log();
    console.log(`   Run ${color.cyan('gemini auth login')} and select:`);
    console.log(`   ${SYMBOLS.bullet} Google`);
    console.log();
  }

  return 0;
}

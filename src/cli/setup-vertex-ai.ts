import {existsSync, readFileSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import color from 'picocolors';
import {detectVertexAI, addProviderConfig, type VertexAIStatus} from './config-manager';
import type {InstallConfig} from './types';

const SYMBOLS = {
  check: color.green('[OK]'),
  cross: color.red('[X]'),
  arrow: color.cyan('->'),
  bullet: color.dim('*'),
  info: color.blue('[i]'),
  warn: color.yellow('[!]'),
};

export interface SetupVertexAIOptions {
  tui: boolean;
  project?: string;
  location?: string;
}

interface ShellInfo {
  shell: string;
  rcFile: string;
}

function detectShell(): ShellInfo {
  const shell = process.env.SHELL ?? '/bin/bash';
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

  if (shell.endsWith('/zsh')) {
    return {shell: 'zsh', rcFile: join(homeDir, '.zshrc')};
  }
  if (shell.endsWith('/fish')) {
    return {shell: 'fish', rcFile: join(homeDir, '.config/fish/config.fish')};
  }
  return {shell: 'bash', rcFile: join(homeDir, '.bashrc')};
}

function generateEnvBlock(project: string, location: string): string {
  return [
    '',
    '# Vertex AI configuration for Gemini CLI (oh-my-gemini)',
    '# Enables Claude models via Vertex AI MaaS',
    'export GOOGLE_GENAI_USE_VERTEXAI=true',
    `export GOOGLE_CLOUD_PROJECT=${project}`,
    `export GOOGLE_CLOUD_LOCATION=${location}`,
    '',
  ].join('\n');
}

function generateFishEnvBlock(project: string, location: string): string {
  return [
    '',
    '# Vertex AI configuration for Gemini CLI (oh-my-gemini)',
    '# Enables Claude models via Vertex AI MaaS',
    'set -gx GOOGLE_GENAI_USE_VERTEXAI true',
    `set -gx GOOGLE_CLOUD_PROJECT ${project}`,
    `set -gx GOOGLE_CLOUD_LOCATION ${location}`,
    '',
  ].join('\n');
}

function hasVertexAIBlock(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;
  const content = readFileSync(rcFile, 'utf-8');
  return content.includes('GOOGLE_GENAI_USE_VERTEXAI');
}

async function runGcloudADCLogin(): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      ['gcloud', 'auth', 'application-default', 'login'],
      {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function isGcloudInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', 'gcloud'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function getGcloudProject(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ['gcloud', 'config', 'get-value', 'project'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode === 0) {
      const project = output.trim();
      if (project && project !== '(unset)') return project;
    }
    return null;
  } catch {
    return null;
  }
}

function printStatus(status: VertexAIStatus): void {
  console.log();
  console.log(color.bold('Current Vertex AI Status'));
  console.log(color.dim('─'.repeat(40)));
  console.log(
    `  GOOGLE_GENAI_USE_VERTEXAI: ${status.enabled ? color.green('true') : color.dim('not set')}`,
  );
  console.log(
    `  GOOGLE_CLOUD_PROJECT:      ${status.project ? color.cyan(status.project) : color.dim('not set')}`,
  );
  console.log(
    `  GOOGLE_CLOUD_LOCATION:     ${status.location ? color.cyan(status.location) : color.dim('not set')}`,
  );
  console.log(
    `  ADC credentials:           ${status.hasADC ? color.green('found') : color.red('missing')}`,
  );
  console.log();
}

async function runTuiSetup(options: SetupVertexAIOptions): Promise<number> {
  const pkg = '@clack/prompts';
  const p = await import(pkg);

  p.intro(color.bgMagenta(color.white(' Vertex AI Setup ')));

  // Show current status
  const status = detectVertexAI();
  printStatus(status);

  // Check gcloud
  const hasGcloud = await isGcloudInstalled();
  if (!hasGcloud) {
    p.log.error(
      'gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install',
    );
    p.outro(color.red('Setup requires gcloud CLI'));
    return 1;
  }

  // Determine project
  let project = options.project ?? status.project;
  if (!project) {
    const gcloudProject = await getGcloudProject();
    if (gcloudProject) {
      p.log.info(`Detected gcloud project: ${color.cyan(gcloudProject)}`);
    }

    const projectInput = await p.text({
      message: 'Enter your GCP project ID (must have Claude models enabled):',
      placeholder: gcloudProject ?? 'my-project-id',
      defaultValue: gcloudProject ?? undefined,
      validate: (value: string) => {
        if (!value.trim()) return 'Project ID is required';
        if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.trim())) {
          return 'Invalid project ID format';
        }
      },
    });

    if (p.isCancel(projectInput)) {
      p.cancel('Setup cancelled');
      return 1;
    }
    project = (projectInput as string).trim();
  } else {
    p.log.info(`Using project: ${color.cyan(project)}`);
  }

  // Determine location
  let location = options.location ?? status.location;
  if (!location) {
    const locationInput = await p.select({
      message: 'Select Vertex AI region for Claude models:',
      options: [
        {value: 'us-east5', label: 'us-east5 (Ohio)', hint: 'recommended'},
        {value: 'europe-west1', label: 'europe-west1 (Belgium)'},
        {value: 'global', label: 'global'},
      ],
    });

    if (p.isCancel(locationInput)) {
      p.cancel('Setup cancelled');
      return 1;
    }
    location = locationInput as string;
  } else {
    p.log.info(`Using location: ${color.cyan(location)}`);
  }

  const s = p.spinner();

  // Step 1: Check/create ADC credentials
  if (!status.hasADC) {
    const doLogin = await p.confirm({
      message: 'ADC credentials not found. Run gcloud auth application-default login?',
      initialValue: true,
    });

    if (p.isCancel(doLogin)) {
      p.cancel('Setup cancelled');
      return 1;
    }

    if (doLogin) {
      p.log.info('Opening browser for Google authentication...');
      const loginOk = await runGcloudADCLogin();
      if (!loginOk) {
        p.log.error('gcloud auth failed. Run manually: gcloud auth application-default login');
        p.outro(color.red('ADC login failed'));
        return 1;
      }
      p.log.success('ADC credentials created');
    } else {
      p.log.warn('Skipping ADC login. Claude models will not work without credentials.');
    }
  } else {
    p.log.success('ADC credentials already present');
  }

  // Step 2: Write env vars to shell profile
  const shellInfo = detectShell();
  const alreadyInRc = hasVertexAIBlock(shellInfo.rcFile);

  if (alreadyInRc) {
    p.log.info(
      `Vertex AI env vars already in ${color.cyan(shellInfo.rcFile)}`,
    );
    p.log.warn(
      'If project/location changed, edit the file manually or remove the existing block first.',
    );
  } else {
    const writeRc = await p.confirm({
      message: `Add Vertex AI env vars to ${shellInfo.rcFile}?`,
      initialValue: true,
    });

    if (p.isCancel(writeRc)) {
      p.cancel('Setup cancelled');
      return 1;
    }

    if (writeRc) {
      const envBlock =
        shellInfo.shell === 'fish'
          ? generateFishEnvBlock(project, location)
          : generateEnvBlock(project, location);

      try {
        appendFileSync(shellInfo.rcFile, envBlock);
        p.log.success(`Env vars written to ${color.cyan(shellInfo.rcFile)}`);
      } catch (err) {
        p.log.error(
          `Failed to write to ${shellInfo.rcFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      p.log.info('Skipped. Add these to your shell profile manually:');
      const envBlock = generateEnvBlock(project, location);
      console.log(color.dim(envBlock));
    }
  }

  // Step 3: Set env vars for current process (so subsequent steps can use them)
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
  process.env.GOOGLE_CLOUD_PROJECT = project;
  process.env.GOOGLE_CLOUD_LOCATION = location;

  // Step 4: Update provider config to include Claude models
  s.start('Adding Claude models to provider config');
  const installConfig: InstallConfig = {
    hasGemini: true,
    hasVertexAI: true,
  };
  const providerResult = addProviderConfig(installConfig);
  if (providerResult.success) {
    s.stop(`Claude models added to ${color.cyan(providerResult.configPath)}`);
  } else {
    s.stop(`Failed to update provider config: ${providerResult.error}`);
  }

  // Final summary
  p.note(
    [
      `${color.bold('Project:')}  ${color.cyan(project)}`,
      `${color.bold('Location:')} ${color.cyan(location)}`,
      `${color.bold('Models:')}   claude-opus-4-6, claude-sonnet-4-5`,
      '',
      color.dim('Restart your shell or run:'),
      color.cyan(`  source ${shellInfo.rcFile}`),
    ].join('\n'),
    'Vertex AI Configuration',
  );

  p.outro(color.green('Vertex AI setup complete!'));
  return 0;
}

async function runNonTuiSetup(options: SetupVertexAIOptions): Promise<number> {
  console.log();
  console.log(color.bgMagenta(color.white(' Vertex AI Setup ')));
  console.log();

  // Show current status
  const status = detectVertexAI();
  printStatus(status);

  // Check gcloud
  const hasGcloud = await isGcloudInstalled();
  if (!hasGcloud) {
    console.log(
      `${SYMBOLS.cross} gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install`,
    );
    return 1;
  }
  console.log(`${SYMBOLS.check} gcloud CLI found`);

  // Determine project
  let project = options.project ?? status.project;
  if (!project) {
    const gcloudProject = await getGcloudProject();
    if (gcloudProject) {
      project = gcloudProject;
      console.log(`${SYMBOLS.info} Using gcloud project: ${color.cyan(project)}`);
    } else {
      console.log(
        `${SYMBOLS.cross} No project specified. Use --project <id> or set GOOGLE_CLOUD_PROJECT`,
      );
      return 1;
    }
  }

  // Determine location
  let location = options.location ?? status.location ?? 'us-east5';
  console.log(`${SYMBOLS.info} Project:  ${color.cyan(project)}`);
  console.log(`${SYMBOLS.info} Location: ${color.cyan(location)}`);

  // Check ADC
  if (!status.hasADC) {
    console.log(
      `${SYMBOLS.warn} ADC credentials missing. Run: gcloud auth application-default login`,
    );
  } else {
    console.log(`${SYMBOLS.check} ADC credentials found`);
  }

  // Set env vars for current process
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
  process.env.GOOGLE_CLOUD_PROJECT = project;
  process.env.GOOGLE_CLOUD_LOCATION = location;

  // Update provider config
  const installConfig: InstallConfig = {
    hasGemini: true,
    hasVertexAI: true,
  };
  const providerResult = addProviderConfig(installConfig);
  if (providerResult.success) {
    console.log(
      `${SYMBOLS.check} Claude models added ${SYMBOLS.arrow} ${color.dim(providerResult.configPath)}`,
    );
  } else {
    console.log(`${SYMBOLS.cross} Failed: ${providerResult.error}`);
  }

  // Write shell profile
  const shellInfo = detectShell();
  if (hasVertexAIBlock(shellInfo.rcFile)) {
    console.log(
      `${SYMBOLS.info} Vertex AI env vars already in ${color.dim(shellInfo.rcFile)}`,
    );
  } else {
    const envBlock =
      shellInfo.shell === 'fish'
        ? generateFishEnvBlock(project, location)
        : generateEnvBlock(project, location);
    try {
      appendFileSync(shellInfo.rcFile, envBlock);
      console.log(
        `${SYMBOLS.check} Env vars written ${SYMBOLS.arrow} ${color.dim(shellInfo.rcFile)}`,
      );
    } catch (err) {
      console.log(
        `${SYMBOLS.warn} Could not write to ${shellInfo.rcFile}. Add manually:`,
      );
      console.log(color.dim(envBlock));
    }
  }

  console.log();
  console.log(
    `${color.green('Done!')} Restart your shell or run: ${color.cyan(`source ${shellInfo.rcFile}`)}`,
  );
  console.log();

  return 0;
}

export async function setupVertexAI(
  options: SetupVertexAIOptions,
): Promise<number> {
  if (options.tui) {
    return runTuiSetup(options);
  }
  return runNonTuiSetup(options);
}

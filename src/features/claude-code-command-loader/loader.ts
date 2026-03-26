import {promises as fs, type Dirent} from 'fs';
import {basename, join} from 'path';
import {getClaudeConfigDir, getGeminiConfigDir} from '../../shared';
import {log} from '../../shared/logger';
import {sanitizeModelField} from '../../shared/model-sanitizer';
import {parseToml} from '../../shared/simple-toml';
import type {
  CommandDefinition,
  CommandFrontmatter,
  CommandScope,
  LoadedCommand,
} from './types';

async function loadCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
  visited: Set<string> = new Set(),
  prefix: string = '',
): Promise<LoadedCommand[]> {
  try {
    await fs.access(commandsDir);
  } catch {
    return [];
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(commandsDir);
  } catch (error) {
    log(`Failed to resolve command directory: ${commandsDir}`, error);
    return [];
  }

  if (visited.has(realPath)) {
    return [];
  }
  visited.add(realPath);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(commandsDir, {withFileTypes: true});
  } catch (error) {
    log(`Failed to read command directory: ${commandsDir}`, error);
    return [];
  }

  const commands: LoadedCommand[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      const subDirPath = join(commandsDir, entry.name);
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
      const subCommands = await loadCommandsFromDir(
        subDirPath,
        scope,
        visited,
        subPrefix,
      );
      commands.push(...subCommands);
      continue;
    }

    const isToml = entry.name.endsWith('.toml');
    if (!isToml) continue;

    const commandPath = join(commandsDir, entry.name);
    const baseCommandName = basename(entry.name, '.toml');
    const commandName = prefix
      ? `${prefix}:${baseCommandName}`
      : baseCommandName;

    try {
      const content = await fs.readFile(commandPath, 'utf-8');

      let data: CommandFrontmatter;
      let template: string;

      if (isToml) {
        // Support TOML-style
        const parsed = parseToml(content);
        data = {
          description: parsed.description,
          'argument-hint': parsed['argument-hint'],
          model: parsed.model,
          agent: parsed.agent,
          subtask: parsed.subtask,
          handoffs: parsed.handoffs,
        };
        template = parsed.prompt || parsed.template || '';
      } else {
        continue;
      }

      const wrappedTemplate = `<command-instruction>
${template.trim()}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`;

      const formattedDescription = `(${scope}) ${data.description || ''}`;

      const isGeminiSource = scope === 'gemini' || scope === 'gemini-project';
      const definition: CommandDefinition = {
        name: commandName,
        description: formattedDescription,
        template: wrappedTemplate,
        agent: data.agent,
        model: sanitizeModelField(
          data.model,
          isGeminiSource ? 'gemini' : 'claude-code',
        ),
        subtask: data.subtask,
        argumentHint: data['argument-hint'],
        handoffs: data.handoffs,
      };

      commands.push({
        name: commandName,
        path: commandPath,
        definition,
        scope,
      });
    } catch (error) {
      log(`Failed to parse command: ${commandPath}`, error);
      continue;
    }
  }

  return commands;
}

function commandsToRecord(
  commands: LoadedCommand[],
): Record<string, CommandDefinition> {
  const result: Record<string, CommandDefinition> = {};
  for (const cmd of commands) {
    const {
      name: _name,
      argumentHint: _argumentHint,
      ...geminiCompatible
    } = cmd.definition;
    result[cmd.name] = geminiCompatible as CommandDefinition;
  }
  return result;
}

export async function getUserCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const userCommandsDir = join(getClaudeConfigDir(), 'commands');
  const commands = await loadCommandsFromDir(userCommandsDir, 'user');
  return commandsToRecord(commands);
}

export async function getProjectCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const projectCommandsDir = join(process.cwd(), '.claude', 'commands');
  const commands = await loadCommandsFromDir(projectCommandsDir, 'project');
  return commandsToRecord(commands);
}

export async function getGeminiGlobalCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const configDir = getGeminiConfigDir({binary: 'gemini'});
  const geminiCommandsDir = join(configDir, 'command');
  const commands = await loadCommandsFromDir(geminiCommandsDir, 'gemini');
  return commandsToRecord(commands);
}

export async function getGeminiProjectCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const geminiProjectDir = join(process.cwd(), '.gemini', 'command');
  const commands = await loadCommandsFromDir(
    geminiProjectDir,
    'gemini-project',
  );
  return commandsToRecord(commands);
}

export async function getExtensionCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const extensionCommandsDir = join(process.cwd(), 'commands');
  const commands = await loadCommandsFromDir(extensionCommandsDir, 'project');
  return commandsToRecord(commands);
}

export async function getAllCommands(): Promise<
  Record<string, CommandDefinition>
> {
  const [extension, user, project, global, projectGemini] = await Promise.all([
    getExtensionCommands(),
    getUserCommands(),
    getProjectCommands(),
    getGeminiGlobalCommands(),
    getGeminiProjectCommands(),
  ]);
  return {...extension, ...projectGemini, ...global, ...project, ...user};
}

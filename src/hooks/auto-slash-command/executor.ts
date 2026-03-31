import {existsSync, readdirSync, readFileSync} from 'fs';
import {basename, dirname, join} from 'path';
import {getBuiltinCommands} from '../../features/builtin-commands';
import type {CommandFrontmatter} from '../../features/claude-code-command-loader/types';
import {
  discoverAllSkills,
  type LazyContentLoader,
  type LoadedSkill,
} from '../../features/gemini-skill-loader';
import {
  getClaudeConfigDir,
  getGeminiConfigDir,
  resolveCommandsInText,
  resolveFileReferencesInText,
  sanitizeModelField,
} from '../../shared';
import {parseToml} from '../../shared/simple-toml';
import type {ParsedSlashCommand} from './types';

interface CommandScope {
  type: 'user' | 'project' | 'gemini' | 'gemini-project' | 'skill' | 'builtin';
}

interface CommandMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  model?: string;
  agent?: string;
  subtask?: boolean;
}

interface CommandInfo {
  name: string;
  path?: string;
  metadata: CommandMetadata;
  content?: string;
  scope: CommandScope['type'];
  lazyContentLoader?: LazyContentLoader;
}

function discoverTomlCommandsFromDir(
  commandsDir: string,
  scope: CommandScope['type'],
): CommandInfo[] {
  if (!existsSync(commandsDir)) {
    return [];
  }

  const entries = readdirSync(commandsDir, {withFileTypes: true});
  const commands: CommandInfo[] = [];

  for (const entry of entries) {
    if (!entry.name.endsWith('.toml')) continue;

    const commandPath = join(commandsDir, entry.name);
    const commandName = basename(entry.name, '.toml');

    try {
      const content = readFileSync(commandPath, 'utf-8');

      if (content.trim().startsWith('---')) continue;

      const data = parseToml(content) as any;

      const metadata: CommandMetadata = {
        name: commandName,
        description: data.description || '',
        argumentHint: data['argument-hint'],
        model: data.model,
        agent: data.agent,
        subtask: Boolean(data.subtask),
      };

      commands.push({
        name: commandName,
        path: commandPath,
        metadata,
        content: data.prompt || data.template || '',
        scope,
      });
    } catch {
      continue;
    }
  }

  return commands;
}

function skillToCommandInfo(skill: LoadedSkill): CommandInfo {
  return {
    name: skill.name,
    path: skill.path,
    metadata: {
      name: skill.name,
      description: skill.definition.description || '',
      argumentHint: skill.definition.argumentHint,
      model: skill.definition.model,
      agent: skill.definition.agent,
      subtask: skill.definition.subtask,
    },
    content: skill.definition.template,
    scope: 'skill',
    lazyContentLoader: skill.lazyContent,
  };
}

export interface ExecutorOptions {
  skills?: LoadedSkill[];
}

async function discoverAllCommands(
  options?: ExecutorOptions,
): Promise<CommandInfo[]> {
  const configDir = getGeminiConfigDir({binary: 'gemini'});
  const userCommandsDir = join(getClaudeConfigDir(), 'commands');
  const projectCommandsDir = join(process.cwd(), '.claude', 'commands');
  const geminiGlobalDir = join(configDir, 'command');
  const geminiProjectDir = join(process.cwd(), '.gemini', 'command');
  const rootCommandsDir = join(process.cwd(), 'commands');

  const rootTomlCommands = discoverTomlCommandsFromDir(
    rootCommandsDir,
    'project',
  );

  const userTomlCommands = discoverTomlCommandsFromDir(userCommandsDir, 'user');

  const geminiGlobalTomlCommands = discoverTomlCommandsFromDir(
    geminiGlobalDir,
    'gemini',
  );

  const projectTomlCommands = discoverTomlCommandsFromDir(
    projectCommandsDir,
    'project',
  );

  const geminiProjectTomlCommands = discoverTomlCommandsFromDir(
    geminiProjectDir,
    'gemini-project',
  );

  const builtinCommandsMap = getBuiltinCommands();
  const builtinCommands: CommandInfo[] = Object.values(builtinCommandsMap).map(
    (cmd) => ({
      name: cmd.name,
      metadata: {
        name: cmd.name,
        description: cmd.description || '',
        model: cmd.model,
        agent: cmd.agent,
        subtask: cmd.subtask,
      },
      content: cmd.template,
      scope: 'builtin',
    }),
  );

  const skills = options?.skills ?? (await discoverAllSkills());
  const skillCommands = skills.map(skillToCommandInfo);

  return [
    ...builtinCommands,
    ...rootTomlCommands,
    ...geminiProjectTomlCommands,
    ...projectTomlCommands,
    ...geminiGlobalTomlCommands,
    ...userTomlCommands,
    ...skillCommands,
  ];
}

async function findCommand(
  commandName: string,
  options?: ExecutorOptions,
): Promise<CommandInfo | null> {
  const allCommands = await discoverAllCommands(options);
  return (
    allCommands.find(
      (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase(),
    ) ?? null
  );
}

async function formatCommandTemplate(
  cmd: CommandInfo,
  args: string,
): Promise<string> {
  const sections: string[] = [];

  sections.push(`# /${cmd.name} Command\n`);

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`);
  }

  if (args) {
    sections.push(`**User Arguments**: ${args}\n`);
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`);
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`);
  }

  sections.push(`**Scope**: ${cmd.scope}\n`);
  sections.push('---\n');
  sections.push('## Command Instructions\n');

  let content = cmd.content || '';
  if (!content && cmd.lazyContentLoader) {
    content = await cmd.lazyContentLoader.load();
  }

  const commandDir = cmd.path ? dirname(cmd.path) : process.cwd();
  const withFileRefs = await resolveFileReferencesInText(content, commandDir);
  const resolvedContent = await resolveCommandsInText(withFileRefs);

  let finalContent = resolvedContent.trim();
  const substitutionArgs = args || '';
  finalContent = finalContent
    .replace(/\$ARGUMENTS/g, substitutionArgs)
    .replace(/\$\{user_message\}/g, substitutionArgs);

  sections.push(finalContent);

  if (args) {
    sections.push('\n\n---\n');
    sections.push('## User Request\n');
    sections.push(args);
  }

  return sections.join('\n');
}

export interface ExecuteResult {
  success: boolean;
  replacementText?: string;
  error?: string;
}

export async function executeSlashCommand(
  parsed: ParsedSlashCommand,
  options?: ExecutorOptions,
): Promise<ExecuteResult> {
  const command = await findCommand(parsed.command, options);

  if (!command) {
    return {
      success: false,
      error: `Command "/${parsed.command}" not found. Use the slashcommand tool to list available commands.`,
    };
  }

  try {
    const template = await formatCommandTemplate(command, parsed.args);
    return {
      success: true,
      replacementText: template,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load command "/${parsed.command}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

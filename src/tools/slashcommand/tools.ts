import {tool, type ToolDefinition} from '@opencode-ai/plugin/tool';
import {existsSync, readdirSync, readFileSync} from 'fs';
import {basename, dirname, join} from 'path';
import {getBuiltinCommands} from '../../features/builtin-commands';
import type {CommandFrontmatter} from '../../features/claude-code-command-loader/types';
import {
  discoverAllSkills,
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
import type {
  CommandInfo,
  CommandMetadata,
  CommandScope,
  SlashcommandToolOptions,
} from './types';

function discoverTomlCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
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

      logToFile(
        `[slashcommand] Parsing ${commandPath}, keys: ${Object.keys(data).join(', ')}`,
      );

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
    } catch (err) {
      logToFile(
        `[slashcommand] Failed to parse TOML command ${commandPath}: ${err}`,
      );
      continue;
    }
  }

  return commands;
}

import * as fs from 'node:fs';

function logToFile(msg: string) {
  fs.appendFileSync('/tmp/slashcommand.log', msg + '\n');
}

export function discoverCommandsSync(): CommandInfo[] {
  const configDir = getGeminiConfigDir({binary: 'gemini'});
  const userCommandsDir = join(getClaudeConfigDir(), 'commands');
  const projectCommandsDir = join(process.cwd(), '.claude', 'commands');
  const geminiGlobalDir = join(configDir, 'command');
  const geminiProjectDir = join(process.cwd(), '.gemini', 'command');
  const rootCommandsDir = join(process.cwd(), 'commands');

  logToFile(
    `[slashcommand] Discovering commands in: ${JSON.stringify({
      user: userCommandsDir,
      project: projectCommandsDir,
      geminiGlobal: geminiGlobalDir,
      geminiProject: geminiProjectDir,
      root: rootCommandsDir,
    })}`,
  );

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
        argumentHint: cmd.argumentHint,
        model: cmd.model,
        agent: cmd.agent,
        subtask: cmd.subtask,
      },
      content: cmd.template,
      scope: 'builtin',
    }),
  );

  const all = [
    ...builtinCommands,
    ...rootTomlCommands,
    ...geminiProjectTomlCommands,
    ...projectTomlCommands,
    ...geminiGlobalTomlCommands,
    ...userTomlCommands,
  ];

  logToFile(`[slashcommand] Found ${all.length} commands total.`);
  if (all.length > 0) {
    logToFile(
      `[slashcommand] Command names: ${all.map((c) => c.name).join(', ')}`,
    );
  }

  return all;
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
    scope: skill.scope,
    lazyContentLoader: skill.lazyContent,
  };
}

async function formatLoadedCommand(
  cmd: CommandInfo,
  userMessage?: string,
): Promise<string> {
  const sections: string[] = [];

  sections.push(`# /${cmd.name} Command\n`);

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`);
  }

  if (cmd.metadata.argumentHint) {
    sections.push(`**Usage**: /${cmd.name} ${cmd.metadata.argumentHint}\n`);
  }

  if (userMessage) {
    sections.push(`**Arguments**: ${userMessage}\n`);
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`);
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`);
  }

  if (cmd.metadata.subtask) {
    sections.push(`**Subtask**: true\n`);
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
  const subMsg = userMessage || '';
  finalContent = finalContent
    .replace(/\$ARGUMENTS/g, subMsg)
    .replace(/\$\{user_message\}/g, subMsg);

  sections.push(finalContent);

  return sections.join('\n');
}

function formatCommandList(items: CommandInfo[]): string {
  if (items.length === 0) {
    return 'No commands or skills found.';
  }

  const lines = ['# Available Commands & Skills\n'];

  for (const cmd of items) {
    const hint = cmd.metadata.argumentHint
      ? ` ${cmd.metadata.argumentHint}`
      : '';
    lines.push(
      `- **/${cmd.name}${hint}**: ${cmd.metadata.description || '(no description)'} (${cmd.scope})`,
    );
  }

  lines.push(`\n**Total**: ${items.length} items`);
  return lines.join('\n');
}

const TOOL_DESCRIPTION_PREFIX = `Load a skill or execute a command to get detailed instructions for a specific task.

Skills and commands provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's or command's description.

**How to use:**
- Call with command name only: command='publish'
- Call with command and arguments: command='publish' user_message='patch'
- The tool will return detailed instructions for the command with your arguments substituted.
`;

function buildDescriptionFromItems(items: CommandInfo[]): string {
  const commandListForDescription = items
    .map((cmd) => {
      const hint = cmd.metadata.argumentHint
        ? ` ${cmd.metadata.argumentHint}`
        : '';
      return `- /${cmd.name}${hint}: ${cmd.metadata.description} (${cmd.scope})`;
    })
    .join('\n');

  return `${TOOL_DESCRIPTION_PREFIX}
<available_skills>
${commandListForDescription}
</available_skills>`;
}

export function createSlashcommandTool(
  options: SlashcommandToolOptions & {
    getSkills?: () => Promise<LoadedSkill[]>;
  } = {},
): ToolDefinition {
  const getCommands = (): CommandInfo[] => {
    return discoverCommandsSync();
  };

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (options.skills) return options.skills;
    if (options.getSkills) return options.getSkills();
    return await discoverAllSkills();
  };

  const getAllItems = async (): Promise<CommandInfo[]> => {
    const commands = getCommands();
    const skills = await getSkills();
    return [...commands, ...skills.map(skillToCommandInfo)];
  };

  return tool({
    get description() {
      // NOTE: description getter must be synchronous in @gemini-ai/sdk.
      // We return the static prefix, but execute() will always use fresh data.
      return TOOL_DESCRIPTION_PREFIX;
    },

    args: {
      command: tool.schema
        .string()
        .describe(
          "The slash command name (without leading slash). E.g., 'publish', 'commit', 'plan'",
        ),
      user_message: tool.schema
        .string()
        .optional()
        .describe(
          "Optional arguments or context to pass to the command. E.g., for '/publish patch', command='publish' user_message='patch'",
        ),
    },

    async execute(args) {
      const allItems = await getAllItems();

      if (!args.command) {
        return (
          formatCommandList(allItems) +
          '\n\nProvide a command or skill name to execute.'
        );
      }

      const cmdName = args.command.replace(/^\//, '');

      const exactMatch = allItems.find(
        (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase(),
      );

      if (exactMatch) {
        return await formatLoadedCommand(exactMatch, args.user_message);
      }

      const partialMatches = allItems.filter((cmd) =>
        cmd.name.toLowerCase().includes(cmdName.toLowerCase()),
      );

      if (partialMatches.length > 0) {
        const matchList = partialMatches
          .map((cmd) => `/${cmd.name}`)
          .join(', ');
        return (
          `No exact match for "/${cmdName}". Did you mean: ${matchList}?\n\n` +
          formatCommandList(allItems)
        );
      }

      return (
        `Command or skill "/${cmdName}" not found.\n\n` +
        formatCommandList(allItems) +
        '\n\nTry a different name.'
      );
    },
  });
}

// Default instance for backward compatibility (lazy loading)
export const slashcommand: ToolDefinition = createSlashcommandTool();

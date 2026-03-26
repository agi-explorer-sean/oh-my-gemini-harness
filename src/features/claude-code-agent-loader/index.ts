export * from '../../../third_party/oh-my-opencode/src/features/claude-code-agent-loader/index';
export {
  loadProjectAgents as getProjectAgents,
  loadUserAgents as getUserAgents,
} from '../../../third_party/oh-my-opencode/src/features/claude-code-agent-loader/loader';

import type {AgentConfig} from '@opencode-ai/sdk';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {isMarkdownFile} from '../../shared/file-utils';
import {parseFrontmatter} from '../../shared/frontmatter';
import {getGeminiConfigDir} from '../../shared/gemini-config-dir';

interface GeminiAgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  tools?: string;
}

function loadGeminiAgentsFromDir(
  agentsDir: string,
  scope: 'gemini' | 'gemini-project',
): Record<string, AgentConfig> {
  if (!existsSync(agentsDir)) {
    return {};
  }

  const entries = readdirSync(agentsDir, {withFileTypes: true});
  const result: Record<string, AgentConfig> = {};

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue;

    const agentPath = join(agentsDir, entry.name);
    const agentName = basename(entry.name, '.md');

    try {
      const content = readFileSync(agentPath, 'utf-8');
      const {data, body} = parseFrontmatter<GeminiAgentFrontmatter>(content);

      const name = data.name || agentName;
      const config: AgentConfig = {
        description: `(${scope}) ${data.description || ''}`,
        mode: 'subagent',
        prompt: body.trim(),
      };

      if (data.tools) {
        const tools: Record<string, boolean> = {};
        for (const tool of data.tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)) {
          tools[tool.toLowerCase()] = true;
        }
        if (Object.keys(tools).length > 0) {
          config.tools = tools;
        }
      }

      result[name] = config;
    } catch {
      continue;
    }
  }

  return result;
}

export function getGeminiGlobalAgents(): Record<string, AgentConfig> {
  const configDir = getGeminiConfigDir({binary: 'gemini'});
  return loadGeminiAgentsFromDir(join(configDir, 'agents'), 'gemini');
}

export function getGeminiProjectAgents(): Record<string, AgentConfig> {
  return loadGeminiAgentsFromDir(
    join(process.cwd(), '.gemini', 'agents'),
    'gemini-project',
  );
}

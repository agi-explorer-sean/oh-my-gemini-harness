import {
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
  lspManager,
} from './lsp';

import {ast_grep_replace, ast_grep_search} from './ast-grep';
import {
  createBackgroundCancel,
  createBackgroundOutput,
} from './background-task';
import {createCallSubagent} from './call-subagent';
import {createDelegateTask} from './delegate-task';
import {glob} from './glob';
import {grep} from './grep';
import {createLookAt} from './look-at';
import {
  createParallelExecTool,
  createParallelStatusTool,
  createWorkerGetTaskTool,
  createWorkerReportResultTool,
  isWorkerMode,
} from './parallel-exec';
import {
  session_info,
  session_list,
  session_read,
  session_search,
} from './session-manager';
import {sessionExists} from './session-manager/storage';
import {createSkillTool} from './skill';
import {createSkillMcpTool} from './skill-mcp';
import {createSlashcommandTool, discoverCommandsSync} from './slashcommand';
import {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from './task';

import type {PluginInput, ToolDefinition} from '@opencode-ai/plugin';
import type {BackgroundManager} from '../features/background-agent';

type OpencodeClient = PluginInput['client'];

export {
  ast_grep_replace,
  ast_grep_search,
  createCallSubagent,
  createDelegateTask,
  createLookAt,
  createParallelExecTool,
  createParallelStatusTool,
  createWorkerGetTaskTool,
  createWorkerReportResultTool,
  isWorkerMode,
  createSkillMcpTool,
  createSkillTool,
  createSlashcommandTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  discoverCommandsSync,
  glob,
  grep,
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_prepare_rename,
  lsp_rename,
  lsp_symbols,
  lspManager,
  session_info,
  session_list,
  session_read,
  session_search,
  sessionExists,
};

export function createBackgroundTools(
  manager: BackgroundManager,
  client: OpencodeClient,
): Record<string, ToolDefinition> {
  return {
    background_output: createBackgroundOutput(manager, client),
    background_cancel: createBackgroundCancel(manager, client),
  };
}

export const builtinTools: Record<string, ToolDefinition> = {
  lsp_goto_definition,
  lsp_find_references,
  lsp_symbols,
  lsp_diagnostics,
  lsp_prepare_rename,
  lsp_rename,
  ast_grep_search,
  ast_grep_replace,
  grep,
  glob,
  session_list,
  session_read,
  session_search,
  session_info,
};

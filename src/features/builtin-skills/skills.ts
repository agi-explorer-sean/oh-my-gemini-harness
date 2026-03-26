import type {BrowserAutomationProvider} from '../../config/schema';
import type {BuiltinSkill} from './types';

import {
  agentBrowserSkill,
  dataScientistSkill,
  devBrowserSkill,
  frontendUiUxSkill,
  githubIssueTriageSkill,
  githubPrTriageSkill,
  gitMasterSkill,
  golangTuiProgrammerSkill,
  javaProgrammerSkill,
  playwrightSkill,
  promptEngineerSkill,
  pythonDebuggerSkill,
  pythonProgrammerSkill,
  rustProgrammerSkill,
  svelteProgrammerSkill,
  typescriptProgrammerSkill,
} from './skills/index';

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider;
}

export function createBuiltinSkills(
  options: CreateBuiltinSkillsOptions = {},
): BuiltinSkill[] {
  const {browserProvider = 'playwright'} = options;

  const browserSkill =
    browserProvider === 'agent-browser' ? agentBrowserSkill : playwrightSkill;

  return [
    browserSkill,
    frontendUiUxSkill,
    gitMasterSkill,
    devBrowserSkill,
    githubPrTriageSkill,
    githubIssueTriageSkill,
    typescriptProgrammerSkill,
    pythonProgrammerSkill,
    svelteProgrammerSkill,
    golangTuiProgrammerSkill,
    pythonDebuggerSkill,
    dataScientistSkill,
    promptEngineerSkill,
    rustProgrammerSkill,
    javaProgrammerSkill,
  ];
}

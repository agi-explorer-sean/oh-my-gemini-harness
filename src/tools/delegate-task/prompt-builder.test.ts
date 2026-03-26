import {describe, expect, test} from 'bun:test';
import {PLAN_AGENT_SYSTEM_PREPEND} from './constants';
import {buildSystemContent} from './prompt-builder';

describe('buildSystemContent', () => {
  test('returns undefined when all inputs are empty', () => {
    const result = buildSystemContent({
      skillContent: undefined,
      categoryPromptAppend: undefined,
      agentName: 'generic',
    });
    expect(result).toBeUndefined();
  });

  test('returns skillContent alone when only skillContent provided', () => {
    const result = buildSystemContent({
      skillContent: 'You are a TypeScript expert.',
      categoryPromptAppend: undefined,
      agentName: 'generic',
    });
    expect(result).toBe('You are a TypeScript expert.');
  });

  test('returns categoryPromptAppend alone when only it is provided', () => {
    const result = buildSystemContent({
      skillContent: undefined,
      categoryPromptAppend: '<Category_Context>Visual</Category_Context>',
      agentName: 'generic',
    });
    expect(result).toBe('<Category_Context>Visual</Category_Context>');
  });

  test('combines skillContent and categoryPromptAppend with double newline', () => {
    const result = buildSystemContent({
      skillContent: 'Skill content here',
      categoryPromptAppend: 'Category append here',
      agentName: 'generic',
    });
    expect(result).toBe('Skill content here\n\nCategory append here');
  });

  test('prepends plan agent system content for plan agents', () => {
    const result = buildSystemContent({
      skillContent: undefined,
      categoryPromptAppend: undefined,
      agentName: 'plan',
    });
    expect(result).toBe(PLAN_AGENT_SYSTEM_PREPEND);
  });

  test('prepends plan agent content before skill and category', () => {
    const result = buildSystemContent({
      skillContent: 'Skill',
      categoryPromptAppend: 'Category',
      agentName: 'prometheus',
    });
    expect(result).toContain(PLAN_AGENT_SYSTEM_PREPEND);
    expect(result).toContain('Skill');
    expect(result).toContain('Category');
    // Plan prepend comes before skill
    const planIdx = result!.indexOf(PLAN_AGENT_SYSTEM_PREPEND);
    const skillIdx = result!.indexOf('Skill');
    expect(planIdx).toBeLessThan(skillIdx);
  });
});

import {describe, expect, test} from 'bun:test';
import {
  BUILTIN_TOOLS_TO_PROPAGATE,
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
} from './agent-tool-restrictions';

describe('BUILTIN_TOOLS_TO_PROPAGATE', () => {
  test('includes google_web_search as true', () => {
    expect(BUILTIN_TOOLS_TO_PROPAGATE.google_web_search).toBe(true);
  });

  test('does not include any false values', () => {
    for (const value of Object.values(BUILTIN_TOOLS_TO_PROPAGATE)) {
      expect(value).toBe(true);
    }
  });
});

describe('getAgentToolRestrictions', () => {
  test('returns exploration denylist for explore agent', () => {
    const restrictions = getAgentToolRestrictions('explore');
    expect(restrictions).toEqual({
      write: false,
      edit: false,
      task: false,
      delegate_task: false,
      call_subagent: false,
    });
  });

  test('returns exploration denylist for librarian agent', () => {
    const restrictions = getAgentToolRestrictions('librarian');
    expect(restrictions).toEqual({
      write: false,
      edit: false,
      task: false,
      delegate_task: false,
      call_subagent: false,
    });
  });

  test('returns oracle restrictions without call_subagent deny', () => {
    const restrictions = getAgentToolRestrictions('oracle');
    expect(restrictions.write).toBe(false);
    expect(restrictions.edit).toBe(false);
    expect(restrictions.task).toBe(false);
    expect(restrictions.delegate_task).toBe(false);
    expect(restrictions.call_subagent).toBeUndefined();
  });

  test('returns multimodal-looker restrictions with read allowed', () => {
    const restrictions = getAgentToolRestrictions('multimodal-looker');
    expect(restrictions).toEqual({read: true});
  });

  test('returns sisyphus-junior restrictions', () => {
    const restrictions = getAgentToolRestrictions('sisyphus-junior');
    expect(restrictions).toEqual({
      task: false,
      delegate_task: false,
    });
  });

  test('returns empty object for unknown agent', () => {
    const restrictions = getAgentToolRestrictions('nonexistent-agent');
    expect(restrictions).toEqual({});
  });

  test('performs case-insensitive lookup', () => {
    const restrictions = getAgentToolRestrictions('Explore');
    expect(restrictions.write).toBe(false);
    expect(restrictions.edit).toBe(false);
  });

  test('performs case-insensitive lookup for hyphenated names', () => {
    const restrictions = getAgentToolRestrictions('Multimodal-Looker');
    expect(restrictions).toEqual({read: true});
  });
});

describe('hasAgentToolRestrictions', () => {
  test('returns true for agents with restrictions', () => {
    expect(hasAgentToolRestrictions('explore')).toBe(true);
    expect(hasAgentToolRestrictions('librarian')).toBe(true);
    expect(hasAgentToolRestrictions('oracle')).toBe(true);
    expect(hasAgentToolRestrictions('multimodal-looker')).toBe(true);
    expect(hasAgentToolRestrictions('sisyphus-junior')).toBe(true);
  });

  test('returns false for unknown agent', () => {
    expect(hasAgentToolRestrictions('nonexistent')).toBe(false);
  });

  test('performs case-insensitive lookup', () => {
    expect(hasAgentToolRestrictions('EXPLORE')).toBe(true);
    expect(hasAgentToolRestrictions('Librarian')).toBe(true);
  });
});

describe('BUILTIN_TOOLS_TO_PROPAGATE with agent restrictions', () => {
  test('propagated tools are not overridden by exploration agents', () => {
    const merged = {
      ...BUILTIN_TOOLS_TO_PROPAGATE,
      ...getAgentToolRestrictions('librarian'),
    };
    expect(merged.google_web_search).toBe(true);
    expect(merged.write).toBe(false);
  });

  test('propagated tools survive empty restrictions', () => {
    const merged = {
      ...BUILTIN_TOOLS_TO_PROPAGATE,
      ...getAgentToolRestrictions('nonexistent'),
    };
    expect(merged.google_web_search).toBe(true);
  });
});

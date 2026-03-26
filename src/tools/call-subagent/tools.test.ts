import {describe, expect, test} from 'bun:test';
import {ALLOWED_AGENTS, CALL_SUBAGENT_DESCRIPTION} from './constants';

describe('call-subagent constants', () => {
  //#given the allowed agents list
  test('only allows explore and librarian', () => {
    //#then the allowed agents should be exactly explore and librarian
    expect(ALLOWED_AGENTS).toContain('explore');
    expect(ALLOWED_AGENTS).toContain('librarian');
    expect(ALLOWED_AGENTS).toHaveLength(2);
  });

  //#given the call subagent description template
  test('description template contains agent placeholder', () => {
    //#then the description should contain the {agents} placeholder
    expect(CALL_SUBAGENT_DESCRIPTION).toContain('{agents}');
  });

  test('description mentions run_in_background', () => {
    //#then the description should mention run_in_background as required
    expect(CALL_SUBAGENT_DESCRIPTION).toContain('run_in_background');
    expect(CALL_SUBAGENT_DESCRIPTION).toContain('REQUIRED');
  });

  test('description mentions session_id for continuation', () => {
    //#then the description should mention session_id
    expect(CALL_SUBAGENT_DESCRIPTION).toContain('session_id');
  });
});

describe('call-subagent agent validation', () => {
  //#given a valid agent name
  test('accepts explore agent', () => {
    //#when checking if explore is allowed
    const isAllowed = ALLOWED_AGENTS.some(
      (name) => name.toLowerCase() === 'explore',
    );
    //#then it should be allowed
    expect(isAllowed).toBe(true);
  });

  //#given an invalid agent name
  test('rejects unknown agent', () => {
    //#when checking if unknown is allowed
    const isAllowed = ALLOWED_AGENTS.some(
      (name) => name.toLowerCase() === 'oracle',
    );
    //#then it should not be allowed
    expect(isAllowed).toBe(false);
  });

  //#given case-insensitive matching
  test('case-insensitive agent matching works', () => {
    //#when checking with different case
    const isAllowed = ALLOWED_AGENTS.some(
      (name) => name.toLowerCase() === 'EXPLORE'.toLowerCase(),
    );
    //#then it should match
    expect(isAllowed).toBe(true);
  });
});

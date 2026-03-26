import {describe, expect, test} from 'bun:test';
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  isPlanAgent,
  PLAN_AGENT_NAMES,
} from './constants';

describe('isPlanAgent', () => {
  test('returns true for exact plan agent names', () => {
    for (const name of PLAN_AGENT_NAMES) {
      expect(isPlanAgent(name)).toBe(true);
    }
  });

  test('returns true for case-insensitive matches', () => {
    expect(isPlanAgent('Plan')).toBe(true);
    expect(isPlanAgent('PROMETHEUS')).toBe(true);
    expect(isPlanAgent('Planner')).toBe(true);
  });

  test('returns true for names containing plan agent substring', () => {
    expect(isPlanAgent('my-plan-agent')).toBe(true);
    expect(isPlanAgent('prometheus-v2')).toBe(true);
  });

  test('returns false for non-plan agents', () => {
    expect(isPlanAgent('explore')).toBe(false);
    expect(isPlanAgent('librarian')).toBe(false);
    expect(isPlanAgent('sisyphus')).toBe(false);
    expect(isPlanAgent('oracle')).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isPlanAgent(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isPlanAgent('')).toBe(false);
  });

  test('handles whitespace in name', () => {
    expect(isPlanAgent('  plan  ')).toBe(true);
    expect(isPlanAgent(' prometheus ')).toBe(true);
  });
});

describe('DEFAULT_CATEGORIES', () => {
  test('has all expected category keys', () => {
    const expectedCategories = [
      'visual-engineering',
      'ultrabrain',
      'deep',
      'artistry',
      'quick',
      'unspecified-low',
      'unspecified-high',
      'writing',
    ];
    for (const cat of expectedCategories) {
      expect(DEFAULT_CATEGORIES[cat]).toBeDefined();
    }
  });

  test('all categories have a model', () => {
    for (const [, config] of Object.entries(DEFAULT_CATEGORIES)) {
      expect(config.model).toBeTruthy();
    }
  });
});

describe('CATEGORY_PROMPT_APPENDS', () => {
  test('has matching keys with DEFAULT_CATEGORIES', () => {
    const catKeys = Object.keys(DEFAULT_CATEGORIES);
    const appendKeys = Object.keys(CATEGORY_PROMPT_APPENDS);
    expect(appendKeys.sort()).toEqual(catKeys.sort());
  });

  test('all appends are non-empty strings', () => {
    for (const [, append] of Object.entries(CATEGORY_PROMPT_APPENDS)) {
      expect(typeof append).toBe('string');
      expect(append.length).toBeGreaterThan(0);
    }
  });
});

describe('CATEGORY_DESCRIPTIONS', () => {
  test('has a description for each default category', () => {
    for (const key of Object.keys(DEFAULT_CATEGORIES)) {
      expect(CATEGORY_DESCRIPTIONS[key]).toBeDefined();
      expect(typeof CATEGORY_DESCRIPTIONS[key]).toBe('string');
    }
  });
});

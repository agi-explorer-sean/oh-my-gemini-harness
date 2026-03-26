import {describe, expect, test} from 'bun:test';
import {parseSimpleToml, parseToml} from './simple-toml';

describe('parseSimpleToml', () => {
  test('parses single-line string values', () => {
    const result = parseSimpleToml('name = "hello"');
    expect(result.name).toBe('hello');
  });

  test('parses multiple single-line strings', () => {
    const result = parseSimpleToml(`
name = "test-agent"
description = "A test agent"
    `);
    expect(result.name).toBe('test-agent');
    expect(result.description).toBe('A test agent');
  });

  test('parses boolean true', () => {
    const result = parseSimpleToml('enabled = true');
    expect(result.enabled).toBe(true);
  });

  test('parses boolean false', () => {
    const result = parseSimpleToml('disabled = false');
    expect(result.disabled).toBe(false);
  });

  test('parses integer numbers', () => {
    const result = parseSimpleToml('max_turns = 20');
    expect(result.max_turns).toBe(20);
  });

  test('parses floating point numbers', () => {
    const result = parseSimpleToml('temperature = 0.7');
    expect(result.temperature).toBe(0.7);
  });

  test('parses multi-line string values', () => {
    const result = parseSimpleToml(`
prompt = """
You are a helpful assistant.
Be concise.
"""
    `);
    expect(result.prompt).toContain('You are a helpful assistant.');
    expect(result.prompt).toContain('Be concise.');
  });

  test('parses mixed types in one document', () => {
    const result = parseSimpleToml(`
name = "explorer"
enabled = true
max_turns = 10
temperature = 0.5
    `);
    expect(result.name).toBe('explorer');
    expect(result.enabled).toBe(true);
    expect(result.max_turns).toBe(10);
    expect(result.temperature).toBe(0.5);
  });

  test('ignores comment lines', () => {
    const result = parseSimpleToml(`
# This is a comment
name = "test"
# Another comment
enabled = true
    `);
    expect(result.name).toBe('test');
    expect(result.enabled).toBe(true);
  });

  test('handles empty content', () => {
    const result = parseSimpleToml('');
    expect(result).toEqual({});
  });

  test('handles empty string value', () => {
    const result = parseSimpleToml('name = ""');
    expect(result.name).toBe('');
  });

  test('parses a realistic command TOML file', () => {
    const content = `
name = "explore"
description = "Explore and understand the codebase"
max_turns = 15
temperature = 0.1
prompt = """
You are a codebase exploration agent.
Search files and understand patterns.
"""
    `;
    const result = parseSimpleToml(content);
    expect(result.name).toBe('explore');
    expect(result.description).toBe('Explore and understand the codebase');
    expect(result.max_turns).toBe(15);
    expect(result.temperature).toBe(0.1);
    expect(result.prompt).toContain('codebase exploration agent');
  });
});

describe('parseToml', () => {
  test('parses content (using Bun.TOML or fallback)', () => {
    const result = parseToml('name = "hello"');
    expect(result.name).toBe('hello');
  });

  test('parses booleans', () => {
    const result = parseToml('flag = true');
    expect(result.flag).toBe(true);
  });

  test('parses numbers', () => {
    const result = parseToml('count = 42');
    expect(result.count).toBe(42);
  });
});

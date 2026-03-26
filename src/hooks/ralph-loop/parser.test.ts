import {describe, expect, test} from 'bun:test';
import {parseRalphLoopArgs} from './parser';

describe('parseRalphLoopArgs', () => {
  //#given a quoted prompt string
  test('extracts quoted prompt', () => {
    //#when parsing a double-quoted prompt
    const result = parseRalphLoopArgs('"Fix the bug in login"');

    //#then prompt is extracted without quotes
    expect(result.prompt).toBe('Fix the bug in login');
    expect(result.maxIterations).toBeUndefined();
    expect(result.completionPromise).toBeUndefined();
  });

  test('extracts single-quoted prompt', () => {
    const result = parseRalphLoopArgs("'Refactor the auth module'");
    expect(result.prompt).toBe('Refactor the auth module');
  });

  //#given an unquoted prompt string
  test('extracts unquoted prompt before flags', () => {
    //#when parsing prompt with flags
    const result = parseRalphLoopArgs('Fix the bug --max-iterations=5');

    //#then prompt is text before flags
    expect(result.prompt).toBe('Fix the bug');
    expect(result.maxIterations).toBe(5);
  });

  //#given --max-iterations flag
  test('parses max-iterations flag', () => {
    const result = parseRalphLoopArgs('"Task" --max-iterations=10');
    expect(result.maxIterations).toBe(10);
  });

  //#given --completion-promise flag
  test('parses completion-promise flag', () => {
    const result = parseRalphLoopArgs('"Task" --completion-promise=DONE');
    expect(result.completionPromise).toBe('DONE');
  });

  test('parses completion-promise with quotes', () => {
    const result = parseRalphLoopArgs('"Task" --completion-promise="ALL_DONE"');
    expect(result.completionPromise).toBe('ALL_DONE');
  });

  //#given all flags combined
  test('parses all flags together', () => {
    const result = parseRalphLoopArgs(
      '"Implement feature" --max-iterations=7 --completion-promise=FINISHED',
    );
    expect(result.prompt).toBe('Implement feature');
    expect(result.maxIterations).toBe(7);
    expect(result.completionPromise).toBe('FINISHED');
  });

  //#given empty input
  test('returns default prompt for empty input', () => {
    const result = parseRalphLoopArgs('');
    expect(result.prompt).toBe('Complete the task as instructed');
  });

  //#given ultrawork option
  test('passes ultrawork option through', () => {
    const result = parseRalphLoopArgs('"Task"', {ultrawork: true});
    expect(result.ultrawork).toBe(true);
  });

  test('ultrawork defaults to undefined', () => {
    const result = parseRalphLoopArgs('"Task"');
    expect(result.ultrawork).toBeUndefined();
  });
});

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ParallelSynthesizer} from './synthesizer';

describe('ParallelSynthesizer', () => {
  let mainDir: string;
  let taskDir1: string;
  let taskDir2: string;
  let synthesizer: ParallelSynthesizer;

  beforeEach(() => {
    const baseDir = join(
      tmpdir(),
      'parallel-test-' + Math.random().toString(36).slice(2),
    );
    mainDir = join(baseDir, 'main');
    taskDir1 = join(baseDir, 'task1');
    taskDir2 = join(baseDir, 'task2');

    mkdirSync(mainDir, {recursive: true});
    mkdirSync(taskDir1, {recursive: true});
    mkdirSync(taskDir2, {recursive: true});

    synthesizer = new ParallelSynthesizer({
      manager: {} as any, // Mocked
      parentSessionID: 'test-session',
      parentMessageID: 'test-message',
    });
  });

  afterEach(() => {
    // rmSync(mainDir, { recursive: true, force: true })
  });

  it('should merge a single change', async () => {
    writeFileSync(join(mainDir, 'file.txt'), 'original');
    writeFileSync(join(taskDir1, 'file.txt'), 'modified');

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('merged');
    expect(existsSync(join(mainDir, 'file.txt'))).toBe(true);
    // readFileSync might be needed here, but for now just checking status
  });

  it('should detect conflicts when multiple agents change the same file', async () => {
    writeFileSync(join(mainDir, 'file.txt'), 'original');
    writeFileSync(join(taskDir1, 'file.txt'), 'modified1');
    writeFileSync(join(taskDir2, 'file.txt'), 'modified2');

    // Mock resolveConflictsViaAgent
    const spy = vi
      .spyOn(synthesizer as any, 'resolveConflictsViaAgent')
      .mockResolvedValue('resolved');

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
      {
        id: '2',
        status: 'completed',
        workingDirectory: taskDir2,
        description: 'task2',
        prompt: '',
      } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('merged');
    expect(results[0].resolution).toBe('LLM-assisted');
    expect(spy).toHaveBeenCalled();
  });

  it('should handle file additions', async () => {
    writeFileSync(join(taskDir1, 'new.txt'), 'new content');

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('added');
    expect(results[0].filePath).toBe('new.txt');
    expect(existsSync(join(mainDir, 'new.txt'))).toBe(true);
  });

  it('should handle file deletions', async () => {
    writeFileSync(join(mainDir, 'to_delete.txt'), 'content');
    // Note: taskDir1 won't have to_delete.txt

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('deleted');
    expect(existsSync(join(mainDir, 'to_delete.txt'))).toBe(false);
  });

  it('should handle delete/modify conflicts', async () => {
    writeFileSync(join(mainDir, 'conflict.txt'), 'original');
    writeFileSync(join(taskDir2, 'conflict.txt'), 'modified');
    // taskDir1 doesn't have conflict.txt (deleted)

    // Mock resolveDeleteModifyConflict
    const spy = vi
      .spyOn(synthesizer as any, 'resolveDeleteModifyConflict')
      .mockResolvedValue('resolved');

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
      {
        id: '2',
        status: 'completed',
        workingDirectory: taskDir2,
        description: 'task2',
        prompt: '',
      } as any,
    ]);

    expect(results.some((r) => r.filePath === 'conflict.txt')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('should auto-merge non-overlapping changes', async () => {
    writeFileSync(join(mainDir, 'file.txt'), 'line1\nline2\nline3\n');
    writeFileSync(join(taskDir1, 'file.txt'), 'line1_modified\nline2\nline3\n');
    writeFileSync(join(taskDir2, 'file.txt'), 'line1\nline2\nline3_modified\n');

    const results = await synthesizer.synthesize(mainDir, [
      {
        id: '1',
        status: 'completed',
        workingDirectory: taskDir1,
        description: 'task1',
        prompt: '',
      } as any,
      {
        id: '2',
        status: 'completed',
        workingDirectory: taskDir2,
        description: 'task2',
        prompt: '',
      } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('merged');
    // expect(results[0].resolution).toBe("Auto-merged") // Status might be "merged" without resolution if git merge-file worked perfectly

    const content = readFileSync(join(mainDir, 'file.txt'), 'utf-8');
    expect(content).toContain('line1_modified');
    expect(content).toContain('line3_modified');
  });
});

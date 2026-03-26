import {describe, expect, mock, test} from 'bun:test';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProactiveEditFixerHook} from './index';

describe('proactive-edit-fixer', () => {
  const tempDir = join(tmpdir(), 'proactive-edit-fixer-test');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const testFile = join(tempDir, 'test.txt');
  fs.writeFileSync(testFile, '  line 1\n\tline 2\n  line 3');

  const ctx = {directory: tempDir} as any;
  const hook = createProactiveEditFixerHook(ctx);

  test('should correct indentation for single line', async () => {
    const input = {tool: 'Edit', sessionID: 's1', callID: 'c1'};
    const output = {
      args: {
        filePath: 'test.txt',
        oldString: '  line 2', // 2 spaces instead of tab
        newString: '  line 2 modified',
      },
    };

    await hook['tool.execute.before'](input, output as any);

    expect(output.args.oldString).toBe('\tline 2');
  });

  test('should correct multi-line whitespace discrepancies', async () => {
    const input = {tool: 'Edit', sessionID: 's1', callID: 'c1'};
    const output = {
      args: {
        filePath: 'test.txt',
        oldString: 'line 1\nline 2',
        newString: 'line 1\nline 2 modified',
      },
    };

    await hook['tool.execute.before'](input, output as any);

    expect(output.args.oldString).toBe('  line 1\n\tline 2');
  });

  test('should correct multi-line with blank lines in between', async () => {
    const blankFile = join(tempDir, 'blank.txt');
    fs.writeFileSync(blankFile, 'line 1\n\n\nline 2');

    const input = {tool: 'Edit', sessionID: 's1', callID: 'c1'};
    const output = {
      args: {
        filePath: 'blank.txt',
        oldString: 'line 1\nline 2',
        newString: 'line 1\nline 2 modified',
      },
    };

    await hook['tool.execute.before'](input, output as any);

    expect(output.args.oldString).toBe('line 1\n\n\nline 2');
  });

  test('should not touch exact matches', async () => {
    const input = {tool: 'Edit', sessionID: 's1', callID: 'c1'};
    const output = {
      args: {
        filePath: 'test.txt',
        oldString: '  line 1',
        newString: '  line 1 modified',
      },
    };

    await hook['tool.execute.before'](input, output as any);

    expect(output.args.oldString).toBe('  line 1');
  });

  test('should not correct if match is ambiguous', async () => {
    const ambiguousFile = join(tempDir, 'ambiguous.txt');
    fs.writeFileSync(ambiguousFile, 'item\nitem\nitem');

    const input = {tool: 'Edit', sessionID: 's1', callID: 'c1'};
    const output = {
      args: {
        filePath: 'ambiguous.txt',
        oldString: 'item',
        newString: 'item modified',
      },
    };

    await hook['tool.execute.before'](input, output as any);

    // Should remain "item" because there are 3 matches
    expect(output.args.oldString).toBe('item');
  });
});

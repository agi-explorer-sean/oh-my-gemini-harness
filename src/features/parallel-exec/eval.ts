import {join} from 'node:path';
import {log} from '../../shared/logger';
import {BackgroundManager} from '../background-agent';
import {ParallelCoordinator} from './coordinator';
import {ParallelSynthesizer} from './synthesizer';

async function runEval() {
  const directory = join(process.cwd(), 'parallel_example');
  const mockManager = {
    launch: async (args: any) => {
      console.log(`[mock-manager] Launching: ${args.description}`);
      return {id: 'mock-task-id', status: 'pending'};
    },
    getTask: (id: string) => {
      return {
        id: 'mock-task-id',
        status: 'completed',
        result:
          '```typescript\nexport function getOrder(id: number) { console.log("order fetched"); return { id, name: "Order " + id }; }\n```',
      };
    },
  };
  const manager = mockManager as any;

  // We need to simulate the parallel tasks because we can't easily run real background agents in a sync script
  // But we can test the Synthesizer logic with mock results that point to real directories

  const synthesizer = new ParallelSynthesizer({
    manager,
    parentSessionID: 'eval-session',
    parentMessageID: 'eval-message',
  });

  console.log('Starting Advanced Parallel Synthesis Evaluation...');

  // Mock results that simulate what agents would have done
  // We'll create temporary "isolated" directories manually for this test
  const {mkdirSync, writeFileSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');

  const taskDir1 = join(tmpdir(), 'eval-task-1');
  const taskDir2 = join(tmpdir(), 'eval-task-2');
  const taskDir3 = join(tmpdir(), 'eval-task-3');

  const {execSync} = await import('node:child_process');
  const setupDir = (dir: string) => {
    mkdirSync(dir, {recursive: true});
    execSync(`cp -r "${directory}/"* "${dir}/"`, {stdio: 'ignore'});
  };

  setupDir(taskDir1);
  setupDir(taskDir2);
  setupDir(taskDir3);

  // Agent 1: user.ts sync
  writeFileSync(
    join(taskDir1, 'src/user.ts'),
    'export function getUser(id: number) { return { id, name: "User " + id }; }',
  );

  // Agent 2: product.ts sync
  writeFileSync(
    join(taskDir2, 'src/product.ts'),
    'export function getProduct(id: number) { return { id, name: "Product " + id }; }',
  );

  // Agent 4: order.ts sync -> async
  setupDir(join(tmpdir(), 'eval-task-4'));
  const taskDir4 = join(tmpdir(), 'eval-task-4');
  writeFileSync(
    join(taskDir4, 'src/order.ts'),
    'export async function getOrder(id: number) { return { id, name: "Order " + id }; }',
  );

  // Agent 5: README update
  setupDir(join(tmpdir(), 'eval-task-5'));
  const taskDir5 = join(tmpdir(), 'eval-task-5');
  writeFileSync(
    join(taskDir5, 'README.md'),
    '# Parallel Example\n\nAll functions are now asynchronous.',
  );

  const mockResults: any[] = [
    {
      id: '4',
      status: 'completed',
      workingDirectory: taskDir4,
      description: 'Refactor order.ts to async',
    },
    {
      id: '5',
      status: 'completed',
      workingDirectory: taskDir5,
      description: 'Update README to async',
    },
  ];

  console.log('Triggering synthesis...');
  const results = await synthesizer.synthesize(directory, mockResults);

  console.log('\n--- Synthesis Results ---');
  results.forEach((r) => {
    console.log(
      `File: ${r.filePath} | Status: ${r.status.toUpperCase()} | Detail: ${r.resolution || '-'}`,
    );
  });

  // Verify main directory
  const {readFileSync} = await import('node:fs');
  console.log('\n--- Verification ---');
  console.log(
    'order.ts:',
    readFileSync(join(directory, 'src/order.ts'), 'utf-8'),
  );
  console.log(
    'README.md:',
    readFileSync(join(directory, 'README.md'), 'utf-8'),
  );

  process.exit(0);
}

runEval().catch((err) => {
  console.error(err);
  process.exit(1);
});

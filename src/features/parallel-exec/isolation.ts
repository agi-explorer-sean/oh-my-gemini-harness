import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {log} from '../../shared/logger';

/**
 * Creates an isolated execution environment by performing a fast clone (hardlinks) of the source directory.
 * This prevents agents from interfering with each other during parallel parallel execution.
 *
 * @param sourceDir The original project directory
 * @returns The path to the isolated directory
 */
export async function createIsolatedEnvironment(
  sourceDir: string,
): Promise<string> {
  const parallelTmpDir = join(
    tmpdir(),
    'oh-my-gemini',
    'parallels',
    crypto.randomUUID(),
  );

  if (!existsSync(parallelTmpDir)) {
    mkdirSync(parallelTmpDir, {recursive: true});
  }

  const targetDir = join(parallelTmpDir, 'worktree');

  log(`[parallel-isolation] Creating isolation: ${sourceDir} -> ${targetDir}`);

  try {
    // We want to copy everything EXCEPT .git and node_modules
    // rsync is preferred if available as it handles exclusions and links well
    try {
      execSync(
        `rsync -a --exclude=.git --exclude=node_modules "${sourceDir}/" "${targetDir}/"`,
        {stdio: 'ignore'},
      );
      log(`[parallel-isolation] Rsync clone successful`);
    } catch (rsyncErr) {
      log(
        `[parallel-isolation] Rsync failed or not available, falling back to cp: ${rsyncErr}`,
      );
      // cp -R doesn't have an easy exclude on all platforms, so we do it in steps
      mkdirSync(targetDir, {recursive: true});

      // Copy everything except .git and node_modules using tar for better performance and reliability
      mkdirSync(targetDir, {recursive: true});
      execSync(
        `tar -c --exclude=.git --exclude=node_modules -C "${sourceDir}" . | tar -x -C "${targetDir}"`,
        {stdio: 'ignore'},
      );
      log(`[parallel-isolation] Tar clone successful`);
    }

    return targetDir;
  } catch (err) {
    log(`[parallel-isolation] Isolated environment creation failed: ${err}`);
    throw new Error(`Failed to create isolated environment: ${err}`);
  }
}

/**
 * Removes an isolated execution environment.
 * @param dir The directory to clean up
 */
export async function cleanupEnvironment(dir: string): Promise<void> {
  log(`[parallel-isolation] Cleaning up environment: ${dir}`);
  try {
    // The dir is inside /tmp/oh-my-gemini/parallels/<uuid>/worktree
    // We want to remove the uuid directory
    const parent = join(dir, '..');
    if (existsSync(parent)) {
      rmSync(parent, {recursive: true, force: true});
    }
  } catch (err) {
    log(`[parallel-isolation] Cleanup failed for ${dir}: ${err}`);
  }
}

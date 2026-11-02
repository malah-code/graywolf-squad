import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GraywolfAppError } from '../errors/taxonomy';

const execFileAsync = promisify(execFile);

export interface CreateWorktreeOptions {
  repoRoot: string;
  taskId: string;
  worktreesDir?: string; // defaults to path.join(repoRoot, '.agents/worktrees')
  baseRef?: string; // defaults to 'HEAD'
  parentTaskId?: string; // DAG Branch Stacking: branches from 'worktree-<parentTaskId>'
}

export interface TaskWorktreeInfo {
  taskId: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  gitPointerContent: string;
}

export interface WorktreeSnapshot {
  taskId: string;
  snapshotPath: string;
  createdAt: string;
  diffPatch: string;
  untrackedFiles: string[];
}

/**
 * Creates an isolated Git worktree for the task, supporting parent task branch stacking.
 */
export async function createTaskWorktree(
  options: CreateWorktreeOptions
): Promise<TaskWorktreeInfo> {
  const { repoRoot, taskId } = options;
  if (!/^[A-Za-z0-9._-]+$/.test(taskId) || taskId === '.' || taskId === '..') {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid taskId for git worktree: "${taskId}"`,
      { taskId }
    );
  }
  const worktreesBase = options.worktreesDir
    ? path.resolve(options.worktreesDir)
    : path.join(repoRoot, '.agents/worktrees');

  const worktreePath = path.join(worktreesBase, taskId);
  const branchName = `worktree-${taskId}`;

  // Check if worktree directory already exists
  try {
    const stat = await fs.stat(worktreePath);
    if (stat.isDirectory()) {
      throw new GraywolfAppError(
        'GIT_WORKTREE_COLLISION',
        `Worktree directory already exists for task ${taskId} at ${worktreePath}`,
        { taskId, worktreePath }
      );
    }
  } catch (err: unknown) {
    if (err instanceof GraywolfAppError) throw err;
    // ENOENT is expected if worktree directory does not exist
  }

  // Ensure parent directory exists
  await fs.mkdir(worktreesBase, { recursive: true });

  const baseBranch = options.parentTaskId
    ? `worktree-${options.parentTaskId}`
    : options.baseRef ?? 'HEAD';

  // Determine if branch already exists
  let branchExists = false;
  try {
    await execFileAsync('git', ['rev-parse', '--verify', branchName], { cwd: repoRoot });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await execFileAsync('git', ['worktree', 'add', worktreePath, branchName], {
        cwd: repoRoot,
      });
    } else {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-b', branchName, worktreePath, baseBranch],
        { cwd: repoRoot }
      );
    }
  } catch (err: unknown) {
    const msg = (err as Error).message || '';
    if (msg.includes('already exists') || msg.includes('is already checked out')) {
      throw new GraywolfAppError(
        'GIT_WORKTREE_COLLISION',
        `Git worktree or branch collision for task ${taskId}: ${msg}`,
        { taskId, worktreePath, error: msg }
      );
    }
    throw err;
  }

  // Rewrite git pointer to relative path for Docker container portability
  const gitPointerContent = await rewriteWorktreeGitPointerToRelative(worktreePath);

  return {
    taskId,
    branchName,
    baseBranch,
    worktreePath,
    gitPointerContent,
  };
}

/**
 * Rewrites <worktreePath>/.git from absolute gitdir to relative path for Docker portability.
 */
export async function rewriteWorktreeGitPointerToRelative(
  worktreePath: string
): Promise<string> {
  const dotGitPath = path.join(worktreePath, '.git');
  const rawContent = await fs.readFile(dotGitPath, 'utf8');

  const match = rawContent.match(/^gitdir:\s*(.+)$/m);
  if (!match) {
    return rawContent;
  }

  const originalTarget = match[1].trim();

  // If already relative, nothing to change
  if (!path.isAbsolute(originalTarget)) {
    return rawContent;
  }

  const relativeTarget = path.relative(worktreePath, originalTarget).split(path.sep).join('/');
  const newContent = `gitdir: ${relativeTarget}\n`;

  await fs.writeFile(dotGitPath, newContent, 'utf8');
  return newContent;
}

/**
 * Captures a pre-pivot snapshot (git diff + untracked files) of the worktree.
 */
export async function snapshotWorktree(
  worktreePath: string,
  taskId: string,
  snapshotDir?: string
): Promise<WorktreeSnapshot> {
  const dir = snapshotDir
    ? path.resolve(snapshotDir)
    : path.join(path.dirname(path.resolve(worktreePath)), '.snapshots');

  await fs.mkdir(dir, { recursive: true });

  const { stdout: diffPatch } = await execFileAsync('git', ['diff', 'HEAD'], {
    cwd: worktreePath,
  });

  const { stdout: statusOutput } = await execFileAsync(
    'git',
    ['status', '--porcelain'],
    { cwd: worktreePath }
  );

  const untrackedFiles = statusOutput
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.substring(3).trim());

  const timestamp = Date.now();
  const snapshotFileName = `snapshot-${taskId}-${timestamp}.patch`;
  const snapshotPath = path.join(dir, snapshotFileName);

  const snapshotContent = [
    `# Task: ${taskId}`,
    `# Snapshot Created: ${new Date(timestamp).toISOString()}`,
    `# Untracked files:\n${untrackedFiles.map((f) => `# - ${f}`).join('\n')}`,
    '\n',
    diffPatch,
  ].join('\n');

  await fs.writeFile(snapshotPath, snapshotContent, 'utf8');

  return {
    taskId,
    snapshotPath,
    createdAt: new Date(timestamp).toISOString(),
    diffPatch,
    untrackedFiles,
  };
}

/**
 * Restores the worktree to clean HEAD state (discards uncommitted tracked and untracked changes).
 */
export async function restoreWorktree(worktreePath: string): Promise<void> {
  // Discard tracked changes
  await execFileAsync('git', ['restore', '.'], { cwd: worktreePath });
  // Discard untracked files and directories
  await execFileAsync('git', ['clean', '-fd'], { cwd: worktreePath });
}

/**
 * Removes the task worktree and cleans up references.
 */
export async function removeTaskWorktree(
  repoRoot: string,
  worktreePath: string,
  taskId: string
): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoRoot,
    });
  } catch {
    // If git worktree remove fails, remove folder manually
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot });
  } catch {
    // Ignore prune error
  }

  // Remove branch if needed
  try {
    await execFileAsync('git', ['branch', '-D', `worktree-${taskId}`], {
      cwd: repoRoot,
    });
  } catch {
    // Branch may not exist or cannot be deleted
  }
}

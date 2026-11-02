import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createTaskWorktree,
  snapshotWorktree,
  restoreWorktree,
  removeTaskWorktree,
} from '../../src/orchestrator/runner/worktree';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

const execFileAsync = promisify(execFile);

describe('Git Worktree Manager Integration Tests (US2)', () => {
  let testRepoRoot: string;

  beforeEach(async () => {
    testRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-worktree-test-'));

    // Initialize temporary Git repository
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: testRepoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Graywolf Test'], { cwd: testRepoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@graywolf.ai'], { cwd: testRepoRoot });

    // Initial commit so HEAD exists
    const readmePath = path.join(testRepoRoot, 'README.md');
    await fs.writeFile(readmePath, '# Test Repo\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: testRepoRoot });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: testRepoRoot });
  });

  afterEach(async () => {
    try {
      await fs.rm(testRepoRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('provisions isolated worktree with relative .git pointer for Docker portability', async () => {
    const taskId = 'TASK-501';
    const info = await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId,
    });

    expect(info.taskId).toBe(taskId);
    expect(info.branchName).toBe(`worktree-${taskId}`);
    expect(info.baseBranch).toBe('HEAD');

    // Verify .git pointer content is relative
    const dotGitPath = path.join(info.worktreePath, '.git');
    const pointerContent = await fs.readFile(dotGitPath, 'utf8');

    expect(pointerContent).toMatch(/^gitdir:\s*\.\./);
    expect(info.gitPointerContent).toBe(pointerContent);

    // Verify worktree file system is functional
    const worktreeReadme = path.join(info.worktreePath, 'README.md');
    const content = await fs.readFile(worktreeReadme, 'utf8');
    expect(content).toBe('# Test Repo\n');
  });

  it('supports DAG Branch Stacking from parent task worktree branch', async () => {
    // 1. Create parent task worktree
    const parentTaskId = 'TASK-PARENT';
    const parentInfo = await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId: parentTaskId,
    });

    // 2. Commit a file in parent worktree
    const parentFeatureFile = path.join(parentInfo.worktreePath, 'feature.txt');
    await fs.writeFile(parentFeatureFile, 'Parent Feature Implemented\n', 'utf8');
    await execFileAsync('git', ['add', 'feature.txt'], { cwd: parentInfo.worktreePath });
    await execFileAsync('git', ['commit', '-m', 'feat: parent feature'], {
      cwd: parentInfo.worktreePath,
    });

    // 3. Create child worktree branching from parentTaskId
    const childTaskId = 'TASK-CHILD';
    const childInfo = await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId: childTaskId,
      parentTaskId,
    });

    expect(childInfo.baseBranch).toBe(`worktree-${parentTaskId}`);

    // Child worktree must have parent's committed file
    const childFeatureFile = path.join(childInfo.worktreePath, 'feature.txt');
    const childContent = await fs.readFile(childFeatureFile, 'utf8');
    expect(childContent).toBe('Parent Feature Implemented\n');
  });

  it('throws GIT_WORKTREE_COLLISION error when worktree directory already exists', async () => {
    const taskId = 'TASK-COLLISION';
    await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId,
    });

    // Attempting to create duplicate worktree
    await expect(
      createTaskWorktree({
        repoRoot: testRepoRoot,
        taskId,
      })
    ).rejects.toThrowError(GraywolfAppError);

    try {
      await createTaskWorktree({
        repoRoot: testRepoRoot,
        taskId,
      });
    } catch (err: unknown) {
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('GIT_WORKTREE_COLLISION');
      expect(appErr.httpStatus).toBe(409);
    }
  });

  it('captures pre-pivot snapshot and restores dirty worktree back to clean HEAD', async () => {
    const taskId = 'TASK-SNAP-RESTORE';
    const info = await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId,
    });

    // Introduce modifications:
    // 1. Modify tracked file
    const readmePath = path.join(info.worktreePath, 'README.md');
    await fs.writeFile(readmePath, '# Modified Content\n', 'utf8');

    // 2. Create untracked file
    const untrackedFile = path.join(info.worktreePath, 'untracked.txt');
    await fs.writeFile(untrackedFile, 'Dirty untracked file\n', 'utf8');

    // Capture snapshot
    const snapshot = await snapshotWorktree(info.worktreePath, taskId);
    expect(snapshot.taskId).toBe(taskId);
    expect(snapshot.untrackedFiles).toContain('untracked.txt');
    expect(snapshot.diffPatch).toContain('Modified Content');

    const savedSnapshot = await fs.readFile(snapshot.snapshotPath, 'utf8');
    expect(savedSnapshot).toContain('Modified Content');
    expect(savedSnapshot).toContain('untracked.txt');

    // Restore worktree
    await restoreWorktree(info.worktreePath);

    // Snapshot file still exists even after restoreWorktree (git clean -fd)
    const survivingSnapshot = await fs.readFile(snapshot.snapshotPath, 'utf8');
    expect(survivingSnapshot).toContain('Modified Content');

    // Tracked file restored to clean state
    const restoredReadme = await fs.readFile(readmePath, 'utf8');
    expect(restoredReadme).toBe('# Test Repo\n');

    // Untracked file removed
    await expect(fs.stat(untrackedFile)).rejects.toThrow();
  });

  it('removes worktree cleanly via removeTaskWorktree', async () => {
    const taskId = 'TASK-REMOVE';
    const info = await createTaskWorktree({
      repoRoot: testRepoRoot,
      taskId,
    });

    expect(await fs.stat(info.worktreePath)).toBeDefined();

    await removeTaskWorktree(testRepoRoot, info.worktreePath, taskId);

    await expect(fs.stat(info.worktreePath)).rejects.toThrow();
  });
});

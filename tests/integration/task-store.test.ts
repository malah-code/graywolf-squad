import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  initTaskDirectory,
  writeTaskArtifact,
  readTaskArtifact,
  listTaskArtifacts,
  computeSha256,
} from '../../src/orchestrator/runner/task-store';
import {
  TaskBriefWatcher,
  TaskInjectEvent,
  TaskPivotEvent,
} from '../../src/orchestrator/runner/task-watcher';
import * as dbModule from '../../src/orchestrator/db/index';

describe('Task Directory Store & Chokidar Watcher Integration Tests (US1)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-task-store-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Task Directory & Artifacts Management', () => {
    it('initializes task directory and canonical subdirectories (e2e-cache, review)', async () => {
      const taskId = 'TASK-401';
      const taskDir = await initTaskDirectory(taskId, { baseDir: tempBaseDir });

      expect(taskDir).toBe(path.join(tempBaseDir, taskId));

      const dirStat = await fs.stat(taskDir);
      expect(dirStat.isDirectory()).toBe(true);

      const e2eStat = await fs.stat(path.join(taskDir, 'e2e-cache'));
      expect(e2eStat.isDirectory()).toBe(true);

      const reviewStat = await fs.stat(path.join(taskDir, 'review'));
      expect(reviewStat.isDirectory()).toBe(true);

      await expect(
        initTaskDirectory('../escape', { baseDir: tempBaseDir })
      ).rejects.toThrow('Invalid taskId');
    });

    it('writes and reads task artifacts with deterministic SHA-256 contentHash calculation', async () => {
      const taskId = 'TASK-402';
      const content = '# Feature Plan\n\n1. Define schema\n2. Run tests\n';
      const expectedHash = computeSha256(content);

      const writeResult = await writeTaskArtifact(taskId, 'plan.md', content, {
        baseDir: tempBaseDir,
      });

      expect(writeResult.filePath).toBe(path.join(tempBaseDir, taskId, 'plan.md'));
      expect(writeResult.contentHash).toBe(expectedHash);

      const readResult = await readTaskArtifact(taskId, 'plan.md', { baseDir: tempBaseDir });
      expect(readResult.content).toBe(content);
      expect(readResult.contentHash).toBe(expectedHash);
    });

    it('lists all created task artifacts', async () => {
      const taskId = 'TASK-403';
      await writeTaskArtifact(taskId, 'brief.md', '# Brief Content', { baseDir: tempBaseDir });
      await writeTaskArtifact(taskId, 'result.json', '{"status":"success"}', {
        baseDir: tempBaseDir,
      });

      const artifacts = await listTaskArtifacts(taskId, { baseDir: tempBaseDir });
      expect(artifacts.length).toBe(2);

      const brief = artifacts.find((a) => a.fileName === 'brief.md');
      expect(brief).toBeDefined();
      expect(brief?.artifactType).toBe('brief');

      const result = artifacts.find((a) => a.fileName === 'result.json');
      expect(result).toBeDefined();
      expect(result?.artifactType).toBe('result');
    });

    it('syncs artifact metadata to task_artifacts table via withTenantContext when syncToDb is true', async () => {
      const taskId = 'TASK-404';
      const workspaceId = '00000000-0000-0000-0000-000000000001';
      const orgId = '00000000-0000-0000-0000-000000000002';
      const content = 'diff --git a/test.ts b/test.ts\n+const x = 1;\n';
      const expectedHash = computeSha256(content);

      const queryCalls: { sql: string; params?: unknown[] }[] = [];
      const mockClient = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          queryCalls.push({ sql, params });
          return { rowCount: 0, rows: [] };
        }),
      };

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(
        async (ctx, fn) => {
          expect(ctx.workspaceId).toBe(workspaceId);
          expect(ctx.orgId).toBe(orgId);
          return fn(mockClient as never);
        }
      );

      await writeTaskArtifact(taskId, 'changes.patch', content, {
        baseDir: tempBaseDir,
        syncToDb: true,
        workspaceId,
        orgId,
        authoredBy: 'dev-level-3',
      });

      expect(queryCalls.length).toBe(2);
      // First is UPDATE attempt
      expect(queryCalls[0].sql).toContain('UPDATE task_artifacts');
      expect(queryCalls[0].params?.[0]).toBe(expectedHash);
      // Second is INSERT
      expect(queryCalls[1].sql).toContain('INSERT INTO task_artifacts');
      expect(queryCalls[1].params).toEqual([
        taskId,
        workspaceId,
        'patch',
        'dev-level-3',
        expect.stringContaining('changes.patch'),
        expectedHash,
      ]);
    });
  });

  describe('Bi-directional Task Brief Watcher & Debounce Logic', () => {
    it('suppresses programmatic writes to prevent self-triggered loop events', async () => {
      const taskId = 'TASK-405';
      const watcher = new TaskBriefWatcher({
        baseDir: tempBaseDir,
        debounceMs: 50,
      });

      let injectCalled = false;
      let pivotCalled = false;

      watcher.on('task.inject', () => {
        injectCalled = true;
      });
      watcher.on('task.pivot', () => {
        pivotCalled = true;
      });

      await watcher.start();

      const initialContent = '---\nwritableScope:\n  - src/auth\n---\n# Brief description';
      const initialHash = computeSha256(initialContent);

      // Record programmatic write before writing
      watcher.recordProgrammaticWrite(taskId, initialHash);

      await writeTaskArtifact(taskId, 'brief.md', initialContent, {
        baseDir: tempBaseDir,
      });

      // Wait past debounce time
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(injectCalled).toBe(false);
      expect(pivotCalled).toBe(false);

      await watcher.close();
    });

    it('emits task.inject when only markdown body is edited without scope changes', async () => {
      const taskId = 'TASK-406';
      const watcher = new TaskBriefWatcher({
        baseDir: tempBaseDir,
        debounceMs: 50,
      });

      await watcher.start();

      const initialContent = '---\nwritableScope:\n  - src/db\nblockedBy: []\n---\n# Initial Body';
      await writeTaskArtifact(taskId, 'brief.md', initialContent, {
        baseDir: tempBaseDir,
      });

      // Wait for initial registration
      await new Promise((resolve) => setTimeout(resolve, 150));

      const injectPromise = new Promise<TaskInjectEvent>((resolve) => {
        watcher.once('task.inject', (ev) => resolve(ev));
      });

      // Minor body edit
      const updatedContent = '---\nwritableScope:\n  - src/db\nblockedBy: []\n---\n# Clarified Body with extra tips';
      await writeTaskArtifact(taskId, 'brief.md', updatedContent, {
        baseDir: tempBaseDir,
      });

      const event = await injectPromise;
      expect(event.type).toBe('task.inject');
      expect(event.taskId).toBe(taskId);
      expect(event.body.trim()).toBe('# Clarified Body with extra tips');

      await watcher.close();
    });

    it('emits task.pivot (UPDATED) when writableScope or blockedBy is modified', async () => {
      const taskId = 'TASK-407';
      const watcher = new TaskBriefWatcher({
        baseDir: tempBaseDir,
        debounceMs: 50,
      });

      await watcher.start();

      const initialContent = '---\nwritableScope:\n  - src/auth\nblockedBy: []\n---\n# Base Brief';
      await writeTaskArtifact(taskId, 'brief.md', initialContent, {
        baseDir: tempBaseDir,
      });

      // Wait for initial registration
      await new Promise((resolve) => setTimeout(resolve, 150));

      const pivotPromise = new Promise<TaskPivotEvent>((resolve) => {
        watcher.once('task.pivot', (ev) => resolve(ev));
      });

      // Major scope pivot
      const updatedContent = '---\nwritableScope:\n  - src/auth\n  - src/db\nblockedBy:\n  - TASK-100\n---\n# Base Brief';
      await writeTaskArtifact(taskId, 'brief.md', updatedContent, {
        baseDir: tempBaseDir,
      });

      const event = await pivotPromise;
      expect(event.type).toBe('task.pivot');
      expect(event.taskId).toBe(taskId);
      expect(event.nextStatus).toBe('UPDATED');
      expect(event.changedFields).toContain('writableScope');
      expect(event.changedFields).toContain('blockedBy');

      await watcher.close();
    });
  });
});

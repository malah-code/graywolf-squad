import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PoolClient } from 'pg';

import {
  EvidenceLedger,
  VerificationEvidenceEntry,
  EvidenceCommandType,
} from '../../src/orchestrator/guards/evidence-ledger';
import type { TenantContext } from '../../src/orchestrator/db';

/**
 * Task 10.1 — Passive Verification Evidence Ledger (FR-001, SC-001, ADR-062).
 */

interface CapturedMirror {
  ctx: TenantContext;
  sql: string;
  params: unknown[];
}

function makeFakeDbRunner(captured: CapturedMirror[]) {
  return async <T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        captured.push({ ctx, sql, params: params ?? [] });
        return { rows: [] };
      },
    } as unknown as PoolClient;
    return fn(client);
  };
}

function entry(overrides: Partial<VerificationEvidenceEntry> = {}): Omit<VerificationEvidenceEntry, 'id' | 'createdAt'> {
  return {
    taskId: 'TASK-EVIDENCE-01',
    workspaceId: 'ws-tenant-a',
    orgId: 'org-a',
    commandType: 'test',
    command: 'pnpm vitest run',
    exitCode: 0,
    durationMs: 1200,
    stdoutSummary: '5 passed',
    stderrSummary: '',
    ...overrides,
  };
}

describe('Passive Verification Evidence Ledger (US1, Task 10.1)', () => {
  it('appends every command execution to <worktree>/.agent_evidence.db with full fidelity', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    const commandTypes: EvidenceCommandType[] = ['test', 'lint', 'typecheck', 'build', 'browser-test'];
    const recorded: VerificationEvidenceEntry[] = [];
    for (const [index, commandType] of commandTypes.entries()) {
      recorded.push(
        await ledger.recordExecution(worktree, entry({ commandType, exitCode: index === 4 ? 1 : 0 }))
      );
    }

    // Worktree JSONL persistence — one line per execution
    const raw = await fs.readFile(path.join(worktree, '.agent_evidence.db'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const readBack = await ledger.readWorktreeEvidence(worktree);
    expect(readBack).toHaveLength(5);
    expect(readBack.map((e) => e.commandType)).toEqual(commandTypes);
    expect(new Set(readBack.map((e) => e.id)).size).toBe(5);
    for (const item of readBack) {
      expect(item.taskId).toBe('TASK-EVIDENCE-01');
      expect(item.workspaceId).toBe('ws-tenant-a');
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    }

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('mirrors every execution to PostgreSQL review_evidence inside withTenantContext', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    await ledger.recordExecution(worktree, entry({ commandType: 'build', command: 'pnpm build', exitCode: 0, durationMs: 5000 }));

    expect(captured).toHaveLength(1);
    const mirror = captured[0];
    expect(mirror.ctx).toEqual({ workspaceId: 'ws-tenant-a', orgId: 'org-a' });
    expect(mirror.sql).toContain('INSERT INTO review_evidence');
    expect(mirror.sql).toContain('task_id, workspace_id, command_type, command, exit_code, duration_ms, stdout_summary, stderr_summary');
    expect(mirror.params.slice(0, 6)).toEqual(['TASK-EVIDENCE-01', 'ws-tenant-a', 'build', 'pnpm build', 0, 5000]);

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('preserves tenant isolation across workspaces (SC-001)', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    await ledger.recordExecution(worktree, entry({ workspaceId: 'ws-tenant-a', orgId: 'org-a', taskId: 'TASK-A' }));
    await ledger.recordExecution(worktree, entry({ workspaceId: 'ws-tenant-b', orgId: 'org-b', taskId: 'TASK-B' }));

    expect(captured.map((m) => m.ctx.workspaceId)).toEqual(['ws-tenant-a', 'ws-tenant-b']);
    expect(captured[0].params[0]).toBe('TASK-A');
    expect(captured[1].params[0]).toBe('TASK-B');
    expect(captured[1].params[1]).toBe('ws-tenant-b');

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('truncates stdout/stderr summaries to 4,000 chars (data-model §1.1)', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    const huge = 'x'.repeat(9_000);
    const recorded = await ledger.recordExecution(worktree, entry({ stdoutSummary: huge, stderrSummary: huge }));
    expect(recorded.stdoutSummary?.length).toBe(4000);
    expect(recorded.stderrSummary?.length).toBe(4000);
    expect(String(captured[0].params[6]).length).toBe(4000);

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('hasPassingTestExecution reports real test pass/fail status (US1/AC2)', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    // Empty ledger -> no passing test
    expect(await ledger.hasPassingTestExecution(worktree)).toBe(false);

    // Non-test commands never satisfy the check
    await ledger.recordExecution(worktree, entry({ commandType: 'lint', command: 'pnpm lint', exitCode: 0 }));
    expect(await ledger.hasPassingTestExecution(worktree)).toBe(false);

    // Failing test only -> still false
    await ledger.recordExecution(worktree, entry({ commandType: 'test', exitCode: 1 }));
    expect(await ledger.hasPassingTestExecution(worktree)).toBe(false);

    // A later passing test -> true
    await ledger.recordExecution(worktree, entry({ commandType: 'test', exitCode: 0 }));
    expect(await ledger.hasPassingTestExecution(worktree)).toBe(true);

    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('skips malformed trailing lines when reading the append-only ledger', async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-evidence-'));
    const captured: CapturedMirror[] = [];
    const ledger = new EvidenceLedger({ dbRunner: makeFakeDbRunner(captured) });

    await ledger.recordExecution(worktree, entry());
    // Simulate a torn write (crash mid-append)
    await fs.appendFile(path.join(worktree, '.agent_evidence.db'), '{"id": "tor', 'utf8');

    const entries = await ledger.readWorktreeEvidence(worktree);
    expect(entries).toHaveLength(1);

    await fs.rm(worktree, { recursive: true, force: true });
  });
});

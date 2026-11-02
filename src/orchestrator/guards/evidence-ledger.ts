import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { withTenantContext } from '../db';

/**
 * Passive Verification Evidence Ledger (Task 10.1, ADR-062, FR-001).
 *
 * Every in-container execution of a verification command (`test`, `lint`,
 * `typecheck`, `build`, `browser-test`) is appended to
 * `<worktree>/.agent_evidence.db` (JSON-lines, append-only) and mirrored
 * inside `withTenantContext` to PostgreSQL `review_evidence` so the
 * Dev-Level-2 reviewer and the external Test Guard can verify real command
 * execution rather than trusting agent claims (SC-001).
 */

export type EvidenceCommandType = 'test' | 'lint' | 'typecheck' | 'build' | 'browser-test';

export interface VerificationEvidenceInput {
  taskId: string;
  workspaceId: string;
  orgId?: string;
  commandType: EvidenceCommandType;
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutSummary?: string;
  stderrSummary?: string;
}

export interface VerificationEvidenceEntry extends VerificationEvidenceInput {
  id: string;
  createdAt: string;
}

export type EvidenceDbRunner = typeof withTenantContext;

const EVIDENCE_DB_FILENAME = '.agent_evidence.db';
const SUMMARY_MAX_CHARS = 4000;

function truncateSummary(summary: string | undefined): string | undefined {
  if (summary === undefined) return undefined;
  return summary.length > SUMMARY_MAX_CHARS ? summary.slice(0, SUMMARY_MAX_CHARS) : summary;
}

export class EvidenceLedger {
  private readonly dbRunner: EvidenceDbRunner;

  constructor(options?: { dbRunner?: EvidenceDbRunner }) {
    this.dbRunner = options?.dbRunner ?? withTenantContext;
  }

  private evidenceDbPath(worktreePath: string): string {
    return path.join(worktreePath, EVIDENCE_DB_FILENAME);
  }

  /**
   * Appends a verification evidence entry to the worktree JSONL ledger and
   * mirrors the summary row to PostgreSQL `review_evidence` under tenant RLS.
   */
  public async recordExecution(
    worktreePath: string,
    input: VerificationEvidenceInput
  ): Promise<VerificationEvidenceEntry> {
    const entry: VerificationEvidenceEntry = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      stdoutSummary: truncateSummary(input.stdoutSummary),
      stderrSummary: truncateSummary(input.stderrSummary),
    };

    // 1. Append-only worktree ledger (<worktree>/.agent_evidence.db)
    const dbPath = this.evidenceDbPath(worktreePath);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.appendFile(dbPath, `${JSON.stringify(entry)}\n`, 'utf8');

    // 2. Mirror to PostgreSQL review_evidence inside withTenantContext
    await this.dbRunner(
      { workspaceId: entry.workspaceId, orgId: entry.orgId },
      async (client) => {
        await client.query(
          `INSERT INTO review_evidence
             (task_id, workspace_id, command_type, command, exit_code, duration_ms, stdout_summary, stderr_summary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            entry.taskId,
            entry.workspaceId,
            entry.commandType,
            entry.command,
            entry.exitCode,
            entry.durationMs,
            entry.stdoutSummary ?? null,
            entry.stderrSummary ?? null,
          ]
        );
      }
    );

    return entry;
  }

  /**
   * Reads all evidence entries from the worktree ledger. Malformed or
   * partially-written trailing lines are skipped (the file is append-only).
   */
  public async readWorktreeEvidence(worktreePath: string): Promise<VerificationEvidenceEntry[]> {
    let content: string;
    try {
      content = await fs.readFile(this.evidenceDbPath(worktreePath), 'utf8');
    } catch {
      return [];
    }
    const entries: VerificationEvidenceEntry[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        entries.push(JSON.parse(trimmed) as VerificationEvidenceEntry);
      } catch {
        // Skip malformed line — append-only ledger must never throw readers
      }
    }
    return entries;
  }

  /**
   * True iff at least one `test` command completed with `exitCode === 0`
   * in the worktree evidence ledger (ADR-062 passive verification).
   */
  public async hasPassingTestExecution(worktreePath: string): Promise<boolean> {
    const entries = await this.readWorktreeEvidence(worktreePath);
    return entries.some((entry) => entry.commandType === 'test' && entry.exitCode === 0);
  }
}

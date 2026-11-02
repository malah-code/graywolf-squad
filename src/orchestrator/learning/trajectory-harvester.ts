import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  compressHermesTrajectory,
  type HermesCompressedTrajectory,
  type TrajectoryTurn,
} from './trajectory-compressor';
import {
  persistTrajectoryRecord,
  pruneExpiredTrajectoryMonths,
  redactTrajectoryPrivacy,
  type PersistedTrajectoryMessage,
  type PersistedTrajectoryRecord,
} from './dataset-manager';

/**
 * Eligible Trajectory Harvester & 90/10 Deterministic Train/Eval Split
 * (Phase 19, Task 19.1, ADR-064, ADR-079, FR-001, SC-001).
 */

export interface DatasetCollectionConfig {
  collect: boolean;
  protectTailTurns?: number;
  retentionMonths?: number;
  workspaceRoot?: string;
  sensitiveIdentifiers?: string[];
}

export interface CandidateTaskTrajectory {
  taskId: string;
  projectId: string;
  workspaceId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'ESCALATED' | 'IN_PROGRESS';
  strikes: number;
  agreedP0P1Findings: number;
  modelAlias: string;
  systemPrompt: string;
  taskBrief: string;
  turns: TrajectoryTurn[];
  completedAt?: string;
}

export interface TrajectoryEligibilityResult {
  eligible: boolean;
  reason?: string;
  split: 'train' | 'eval';
}

export interface HarvestTrajectoryResult {
  harvested: boolean;
  reason?: string;
  split: 'train' | 'eval';
  filePath: string | null;
  record: PersistedTrajectoryRecord | null;
  compression: HermesCompressedTrajectory | null;
}

/**
 * Computes a deterministic 90/10 train/eval split based on SHA-256 of `taskId` (ADR-079).
 */
export function computeTrajectorySplit(taskId: string): 'train' | 'eval' {
  const hash = crypto
    .createHash('sha256')
    .update(taskId, 'utf8')
    .digest('hex');
  const bucket = Number.parseInt(hash.slice(0, 8), 16) % 10;
  return bucket === 0 ? 'eval' : 'train';
}

/**
 * Evaluates whether a completed task trajectory qualifies for SFT dataset harvesting (FR-001, SC-001).
 */
export function evaluateTrajectoryEligibility(
  candidate: CandidateTaskTrajectory,
  config: DatasetCollectionConfig
): TrajectoryEligibilityResult {
  const split = computeTrajectorySplit(candidate.taskId);

  if (!config.collect) {
    return {
      eligible: false,
      reason: 'dataset.collect is disabled (default false)',
      split,
    };
  }

  if (candidate.status !== 'COMPLETED') {
    return {
      eligible: false,
      reason: `Task terminal status '${candidate.status}' is not COMPLETED`,
      split,
    };
  }

  if (candidate.strikes > 0) {
    return {
      eligible: false,
      reason: `Task incurred ${candidate.strikes} reviewer strike(s); only 0-strike trajectories qualify`,
      split,
    };
  }

  if (candidate.agreedP0P1Findings > 0) {
    return {
      eligible: false,
      reason: `Task incurred ${candidate.agreedP0P1Findings} agreed P0/P1 finding(s); only zero-defect trajectories qualify`,
      split,
    };
  }

  return {
    eligible: true,
    split,
  };
}

/**
 * Harvests an eligible task trajectory:
 * 1. Verifies zero-defect eligibility (`COMPLETED`, `strikes === 0`, `agreedP0P1Findings === 0`, `collect === true`).
 * 2. Compresses via Hermes Protect-Head / Protect-Tail / Summarize-Middle.
 * 3. Scrubs via Multi-Layer Privacy Redaction Gate.
 * 4. Persists to `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl` and prunes expired monthly directories.
 */
export async function harvestEligibleTrajectory(
  candidate: CandidateTaskTrajectory,
  config: DatasetCollectionConfig,
  options?: {
    outputBaseDir?: string;
    now?: Date;
    auxiliarySummarizer?: (middleTurns: TrajectoryTurn[]) => Promise<string>;
  }
): Promise<HarvestTrajectoryResult> {
  const eligibility = evaluateTrajectoryEligibility(candidate, config);
  if (!eligibility.eligible) {
    return {
      harvested: false,
      reason: eligibility.reason,
      split: eligibility.split,
      filePath: null,
      record: null,
      compression: null,
    };
  }

  const compression = await compressHermesTrajectory({
    systemPrompt: candidate.systemPrompt,
    taskBrief: candidate.taskBrief,
    turns: candidate.turns,
    protectTailTurns: config.protectTailTurns,
    auxiliarySummarizer: options?.auxiliarySummarizer,
  });

  let totalRedactions = 0;
  const scrubText = (input: string): string => {
    const res = redactTrajectoryPrivacy(input, {
      workspaceRoot: config.workspaceRoot,
      sensitiveIdentifiers: config.sensitiveIdentifiers,
    });
    totalRedactions += res.redactionCount;
    return res.scrubbedText;
  };

  const scrubbedMessages: PersistedTrajectoryMessage[] = compression.messages.map(
    (msg) => {
      const scrubbedContent = scrubText(msg.content);
      const out: PersistedTrajectoryMessage = {
        role: msg.role,
        content: scrubbedContent,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        out.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: scrubText(tc.arguments),
          },
        }));
      }
      if (msg.toolCallId) {
        out.tool_call_id = msg.toolCallId;
      }
      return out;
    }
  );

  const now =
    options?.now ??
    (candidate.completedAt ? new Date(candidate.completedAt) : new Date());
  const harvestedAt = now.toISOString();
  const yearMonth = harvestedAt.slice(0, 7);

  const record: PersistedTrajectoryRecord = {
    messages: scrubbedMessages,
    metadata: {
      taskId: candidate.taskId,
      projectId: candidate.projectId,
      workspaceId: candidate.workspaceId,
      modelAlias: candidate.modelAlias,
      split: eligibility.split,
      strikes: 0,
      agreedP0P1Findings: 0,
      compressed: compression.compressed,
      compressedMiddleTurnCount: compression.compressedMiddleTurnCount,
      tokensBefore: compression.tokensBefore,
      tokensAfter: compression.tokensAfter,
      compressionRatio: compression.compressionRatio,
      redactionCount: totalRedactions,
      harvestedAt,
    },
  };

  const baseDir =
    options?.outputBaseDir ?? path.join('.agents', 'dataset', 'trajectories');
  const { filePath } = await persistTrajectoryRecord(record, {
    outputBaseDir: baseDir,
    month: yearMonth,
  });

  if (config.retentionMonths && config.retentionMonths > 0) {
    await pruneExpiredTrajectoryMonths(baseDir, config.retentionMonths, now);
  }

  return {
    harvested: true,
    split: eligibility.split,
    filePath,
    record,
    compression,
  };
}


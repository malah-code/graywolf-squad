import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';

import {
  computeCalibratedConfidence,
  ConfidenceCalibrator,
  CalibrationSample,
} from '../../src/orchestrator/delivery/confidence-calibration';
import {
  buildExecutiveReviewPacket,
  resolveDataResidencyTier,
  ExecutiveReviewPacketInput,
} from '../../src/orchestrator/delivery/review-packet';
import type { TenantContext } from '../../src/orchestrator/db';

/**
 * Task 11.3 — 7-Section 60-Second Executive Review Packet & Confidence Calibration (FR-003, SC-003).
 */

interface CapturedQuery {
  ctx: TenantContext;
  sql: string;
  params: unknown[];
}

function makeFakeDbRunner(captured: CapturedQuery[], fakeRows: unknown[] = []) {
  return async <T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> => {
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        captured.push({ ctx, sql, params: params ?? [] });
        return { rows: fakeRows };
      },
    } as unknown as PoolClient;
    return fn(client);
  };
}

describe('Confidence Calibration (US3, Task 11.3, FR-003, PRD Gap 9)', () => {
  it('returns unadjusted confidence when sample count is below the n=30 threshold (SC-003)', () => {
    const samples: CalibrationSample[] = Array.from({ length: 29 }, () => ({
      confidenceScore: 0.95,
      wasAccepted: true,
      ageDays: 1,
    }));

    const result = computeCalibratedConfidence(0.9, samples);
    expect(result.isCalibrated).toBe(false);
    expect(result.calibratedConfidence).toBe(0.9);
    expect(result.delta).toBe(0);
    expect(result.sampleCount).toBe(29);
  });

  it('adjusts confidence with 90-day exponential half-life when n >= 30', () => {
    // Model reported 0.90, but empirical acceptance rate was only 0.70 across 40 samples
    const samples: CalibrationSample[] = Array.from({ length: 40 }, (_, i) => ({
      confidenceScore: 0.9,
      wasAccepted: i < 28, // 28/40 = 70% acceptance
      ageDays: i * 2,     // recent samples have higher weight
    }));

    const result = computeCalibratedConfidence(0.85, samples);
    expect(result.isCalibrated).toBe(true);
    expect(result.sampleCount).toBe(40);
    // Overconfidence -> negative delta
    expect(result.delta).toBeLessThan(0);
    expect(result.calibratedConfidence).toBeLessThan(0.85);
  });

  it('strictly clamps calibration adjustment to [-0.15, +0.15] (SC-003)', () => {
    // Extreme overconfidence: reported 0.99 but wasAccepted is 0% across 35 runs
    const disasterSamples: CalibrationSample[] = Array.from({ length: 35 }, () => ({
      confidenceScore: 0.99,
      wasAccepted: false,
      ageDays: 5,
    }));

    const result = computeCalibratedConfidence(0.9, disasterSamples);
    expect(result.isCalibrated).toBe(true);
    expect(result.delta).toBe(-0.15); // clamped at -0.15
    expect(result.calibratedConfidence).toBe(0.75); // 0.90 - 0.15
  });

  it('records calibration samples in confidence_calibration table under tenant RLS', async () => {
    const captured: CapturedQuery[] = [];
    const calibrator = new ConfidenceCalibrator({ dbRunner: makeFakeDbRunner(captured) });

    const record = await calibrator.recordCalibrationSample({
      taskId: 'TASK-110',
      workspaceId: 'ws-tenant-1',
      modelId: 'claude-3-7-sonnet',
      modelVersion: '2025-02-19',
      filePath: 'src/modules/billing.ts',
      fileType: 'service',
      confidenceScore: 0.92,
      wasAccepted: true,
      justification: 'Clean merge with green test suite',
    });

    expect(record.id).toBeTruthy();
    expect(captured).toHaveLength(1);
    expect(captured[0].ctx.workspaceId).toBe('ws-tenant-1');
    expect(captured[0].sql).toContain('INSERT INTO confidence_calibration');
    expect(captured[0].params[1]).toBe('TASK-110');
    expect(captured[0].params[4]).toBe('claude-3-7-sonnet');
  });

  it('queries historical samples and calibrates confidence via ConfidenceCalibrator', async () => {
    const fakeRows = Array.from({ length: 32 }, (_, i) => ({
      confidence_score: '0.88',
      justification: JSON.stringify({ wasAccepted: i % 2 === 0 }),
      age_days: String(i),
    }));

    const captured: CapturedQuery[] = [];
    const calibrator = new ConfidenceCalibrator({ dbRunner: makeFakeDbRunner(captured, fakeRows) });

    const result = await calibrator.calibrateForModelAndFileType({
      workspaceId: 'ws-tenant-1',
      modelId: 'gpt-4o',
      modelVersion: '2024-11-20',
      fileType: 'route',
      rawConfidence: 0.85,
    });

    expect(result.isCalibrated).toBe(true);
    expect(result.sampleCount).toBe(32);
    expect(captured[0].sql).toContain('SELECT confidence_score,');
    expect(captured[0].params).toEqual(['ws-tenant-1', 'gpt-4o', '2024-11-20', 'route']);
  });
});

describe('Review Packet & Data Residency (US3, Task 11.3, FR-003, SC-003)', () => {
  it('resolves ModelDataResidencyTier accurately across providers', () => {
    // 100% local providers -> Tier 1
    expect(resolveDataResidencyTier(['ollama'])).toBe('tier-1-local-only');
    expect(resolveDataResidencyTier(['vllm', 'llamacpp'])).toBe('tier-1-local-only');
    expect(resolveDataResidencyTier(['cli-subscription-copilot'])).toBe('tier-1-local-only');
    expect(resolveDataResidencyTier([])).toBe('tier-1-local-only');

    // Zero-Data-Retention endpoints -> Tier 2
    expect(resolveDataResidencyTier(['azure-openai', 'openai-zdr'])).toBe('tier-2-zero-retention-cloud');

    // Standard commercial endpoints -> Tier 3
    expect(resolveDataResidencyTier(['openai', 'anthropic'])).toBe('tier-3-standard-commercial-api');
    expect(resolveDataResidencyTier(['ollama', 'anthropic'])).toBe('tier-3-standard-commercial-api');
  });

  it('renders all 7 canonical sections of the 60-Second Executive Review Packet', () => {
    const input: ExecutiveReviewPacketInput = {
      taskId: 'TASK-112',
      title: 'Provider-Agnostic VCS Delivery',
      executiveSummary: 'Implements repo-sdk supporting GitHub, GitLab, Bitbucket, Azure, and Gitea.',
      decisionGateRisk: 'low',
      providersUsed: ['ollama'],
      calibration: {
        rawConfidence: 0.92,
        calibratedConfidence: 0.89,
        delta: -0.03,
        sampleCount: 45,
        isCalibrated: true,
      },
      guardCompliance: {
        cleanCodePassed: true,
        testGuardPassed: true,
        docGuardPassed: true,
        inContainerReviewPassed: true,
      },
      dualAxisMatrix: {
        standardsAxisSummary: 'TypeScript strict mode with zero any types, ESLint 0 warnings.',
        specAxisSummary: 'All 6 VCS operations verified across 5 providers.',
        agreedP2Advisories: ['Consider adding GitLab group token support in Phase 15'],
      },
      docsGuardVerifiedSymbols: ['RepoSdkClient', 'VcsProviderAdapter', 'PullRequestRecord'],
      browserSmokeFindings: [
        { route: '/pull-requests', status: 'pass', note: 'View rendered in 22ms' },
      ],
      visualProofArtifacts: [
        { label: 'PR View Snapshot', pathOrUrl: 'artifact://screenshot.png', mode: 'cached' },
      ],
      semanticDiffSummary: [
        'Added provider-agnostic RepoSdkClient abstraction',
        'Implemented 401/403 remote error mapping to GIT_REMOTE_AUTH_FAILED',
      ],
      scopedFileDiffs: [
        { filePath: 'src/orchestrator/delivery/repo-sdk.ts', scope: 'writable', additions: 180, deletions: 0 },
      ],
    };

    const { residencyTier, markdown } = buildExecutiveReviewPacket(input);

    expect(residencyTier).toBe('tier-1-local-only');
    expect(markdown).toContain('# 60-Second Executive Review Packet: TASK-112');
    expect(markdown).toContain('## 1. 10-Second Executive Summary');
    expect(markdown).toContain('🟢 DecisionGate Risk: LOW');
    expect(markdown).toContain('Tier 1 (Local-Only — 100% Offline, $0 License)');
    expect(markdown).toContain('Calibrated Confidence: 0.890 (Raw: 0.920, Δ: -0.030, n=45)');

    expect(markdown).toContain('## 2. Quality Gate Compliance Table');
    expect(markdown).toContain('Clean-Code Guard');
    expect(markdown).toContain('Test Guard');
    expect(markdown).toContain('Documentation Guard');

    expect(markdown).toContain('## 3. Dual-Axis Review Matrix');
    expect(markdown).toContain('Standards Axis (Code Health & Architecture Standards)');
    expect(markdown).toContain('Spec Axis (Functional Acceptance Criteria)');
    expect(markdown).toContain('GitLab group token support');

    expect(markdown).toContain('## 4. Docs-Guard AST Symbol Verification Badge');
    expect(markdown).toContain('`RepoSdkClient`');

    expect(markdown).toContain('## 5. Browser Smoke Test Findings Table');
    expect(markdown).toContain('`/pull-requests`');

    expect(markdown).toContain('## 6. Visual Proof Artifacts');
    expect(markdown).toContain('CACHED REPLAY (0 tokens)');

    expect(markdown).toContain('## 7. Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown');
    expect(markdown).toContain('src/orchestrator/delivery/repo-sdk.ts');
    expect(markdown).toContain('+180');
  });
});

import { describe, it, expect } from 'vitest';

import {
  evaluateMandatoryHumanGates,
  evaluateAiPmReviewer,
  MandatoryGateCheckInput,
} from '../../src/orchestrator/delivery/mandatory-gates';

/**
 * Task 11.2 — 6 Non-Negotiable Mandatory Human Gates, ai-pm Persona & Solo Auto-Merge (FR-002, SC-002).
 */

function baseInput(overrides: Partial<MandatoryGateCheckInput> = {}): MandatoryGateCheckInput {
  return {
    targetBranch: 'feat/my-feature',
    configuredGatePolicy: 'auto',
    topology: 'solo',
    autoMergeIfGreen: true,
    allTestsAndGuardsGreen: true,
    ...overrides,
  };
}

describe('evaluateMandatoryHumanGates (US2, Task 11.2, FR-002)', () => {
  it('passes when no gates trigger and allows auto-merge in solo mode', () => {
    const result = evaluateMandatoryHumanGates(baseInput());
    expect(result.triggered).toBe(false);
    expect(result.triggeredGates).toHaveLength(0);
    expect(result.effectiveGatePolicy).toBe('auto');
    expect(result.canAutoMerge).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('Gate 1: triggers on blast-radius scope escape (PRD §8.4)', () => {
    const result = evaluateMandatoryHumanGates(baseInput({ hasBlastRadiusEscape: true }));
    expect(result.triggered).toBe(true);
    expect(result.triggeredGates).toContain('blast_radius_escape');
    expect(result.effectiveGatePolicy).toBe('mandatory-human');
    expect(result.canAutoMerge).toBe(false);
  });

  it('Gate 2: triggers on destructive DDL statements in patch or flag (DROP TABLE, TRUNCATE)', () => {
    // Via flag
    const flagResult = evaluateMandatoryHumanGates(baseInput({ hasDestructiveDdl: true }));
    expect(flagResult.triggeredGates).toContain('destructive_ddl');
    expect(flagResult.effectiveGatePolicy).toBe('mandatory-human');

    // Via patch inspection
    const patchResult = evaluateMandatoryHumanGates(
      baseInput({ patchContent: '+++ a/schema.sql\n+DROP TABLE orders CASCADE;' })
    );
    expect(patchResult.triggeredGates).toContain('destructive_ddl');
    expect(patchResult.effectiveGatePolicy).toBe('mandatory-human');

    const truncateResult = evaluateMandatoryHumanGates(
      baseInput({ patchContent: '+++ a/schema.sql\n+TRUNCATE TABLE audit_logs;' })
    );
    expect(truncateResult.triggeredGates).toContain('destructive_ddl');
  });

  it('Gate 3: triggers on leaked secrets, critical CVEs, or copyleft licenses', () => {
    const secretsResult = evaluateMandatoryHumanGates(baseInput({ gitleaksSecretsFound: 1 }));
    expect(secretsResult.triggeredGates).toContain('security_or_license_exposure');
    expect(secretsResult.effectiveGatePolicy).toBe('mandatory-human');

    const cveResult = evaluateMandatoryHumanGates(baseInput({ criticalCvesFound: 2 }));
    expect(cveResult.triggeredGates).toContain('security_or_license_exposure');

    const copyleftResult = evaluateMandatoryHumanGates(baseInput({ copyleftLicenseDetected: true }));
    expect(copyleftResult.triggeredGates).toContain('security_or_license_exposure');
  });

  it('Gate 4: triggers when targeting protected branches (main, master, release/*) unless explicit override', () => {
    for (const targetBranch of ['main', 'master', 'release/v1.0', 'release-2026']) {
      const result = evaluateMandatoryHumanGates(baseInput({ targetBranch }));
      expect(result.triggeredGates).toContain('protected_branch_target');
      expect(result.effectiveGatePolicy).toBe('mandatory-human');
      expect(result.canAutoMerge).toBe(false);
    }

    // Explicit override permitted for maintenance automation
    const overridden = evaluateMandatoryHumanGates(
      baseInput({ targetBranch: 'main', allowProtectedBranchTarget: true })
    );
    expect(overridden.triggeredGates).not.toContain('protected_branch_target');
    expect(overridden.effectiveGatePolicy).toBe('auto');
  });

  it('Gate 5: triggers when task spend reaches or exceeds the per-task limit', () => {
    const spendResult = evaluateMandatoryHumanGates(
      baseInput({ currentSpendUSD: 10.05, spendLimitUSD: 10.0 })
    );
    expect(spendResult.triggeredGates).toContain('task_spend_ceiling_exceeded');
    expect(spendResult.effectiveGatePolicy).toBe('mandatory-human');

    const flagResult = evaluateMandatoryHumanGates(baseInput({ taskSpendExceeded: true }));
    expect(flagResult.triggeredGates).toContain('task_spend_ceiling_exceeded');
  });

  it('Gate 6: triggers on two consecutive internal review rejections (2 strikes)', () => {
    const strikeOne = evaluateMandatoryHumanGates(baseInput({ consecutiveReviewStrikes: 1 }));
    expect(strikeOne.triggeredGates).not.toContain('two_strike_review_rejection');

    const strikeTwo = evaluateMandatoryHumanGates(baseInput({ consecutiveReviewStrikes: 2 }));
    expect(strikeTwo.triggeredGates).toContain('two_strike_review_rejection');
    expect(strikeTwo.effectiveGatePolicy).toBe('mandatory-human');
  });

  it('accumulates multiple triggered gates into reasons array', () => {
    const multi = evaluateMandatoryHumanGates(
      baseInput({
        hasBlastRadiusEscape: true,
        targetBranch: 'main',
        gitleaksSecretsFound: 1,
      })
    );
    expect(multi.triggeredGates).toHaveLength(3);
    expect(multi.reasons).toHaveLength(3);
    expect(multi.effectiveGatePolicy).toBe('mandatory-human');
  });

  it('applies task tag gate policy precedence over default gate policy', () => {
    const result = evaluateMandatoryHumanGates(
      baseInput({
        configuredGatePolicy: 'auto',
        taskTags: ['financial', 'billing'],
        gatePolicyByTaskTag: {
          financial: 'human',
          billing: 'ai-pm',
        },
      })
    );
    // 'financial' matches first tag -> 'human'
    expect(result.effectiveGatePolicy).toBe('human');
    expect(result.canAutoMerge).toBe(false);
  });

  it('Solo Dev Auto-Merge-if-Green respects topology and guard statuses', () => {
    // Fails auto-merge if tests/guards failed
    const redGuards = evaluateMandatoryHumanGates(baseInput({ allTestsAndGuardsGreen: false }));
    expect(redGuards.canAutoMerge).toBe(false);

    // Fails auto-merge if autoMergeIfGreen is false
    const disabled = evaluateMandatoryHumanGates(baseInput({ autoMergeIfGreen: false }));
    expect(disabled.canAutoMerge).toBe(false);

    // Fails auto-merge in team/enterprise topology (requires team review workflow)
    const team = evaluateMandatoryHumanGates(baseInput({ topology: 'team' }));
    expect(team.canAutoMerge).toBe(false);
  });
});

describe('evaluateAiPmReviewer (US2, Task 11.2, FR-002)', () => {
  const mandatoryClean = evaluateMandatoryHumanGates(baseInput());
  const mandatoryDirty = evaluateMandatoryHumanGates(baseInput({ hasBlastRadiusEscape: true }));

  it('non-negotiably escalates to human if any mandatory gate is triggered', () => {
    const result = evaluateAiPmReviewer({
      taskId: 'TASK-1',
      mandatoryEvaluation: mandatoryDirty,
      calibratedConfidence: 0.99,
      allGuardsPassed: true,
    });
    expect(result.decision).toBe('escalated_to_human');
    expect(result.effectiveGatePolicy).toBe('mandatory-human');
    expect(result.auditReason).toContain('blast_radius_escape');
  });

  it('rejects patch if external QA guards failed', () => {
    const result = evaluateAiPmReviewer({
      taskId: 'TASK-1',
      mandatoryEvaluation: mandatoryClean,
      calibratedConfidence: 0.95,
      allGuardsPassed: false,
    });
    expect(result.decision).toBe('rejected');
    expect(result.auditReason).toContain('External QA guards failed');
  });

  it('escalates to human if calibrated confidence is below auto-approval threshold', () => {
    const result = evaluateAiPmReviewer({
      taskId: 'TASK-1',
      mandatoryEvaluation: mandatoryClean,
      calibratedConfidence: 0.75,
      allGuardsPassed: true,
      aiReviewerConfig: {
        persona: 'Lead AI PM',
        autoApproveThreshold: 0.85,
        canEscalateToHuman: true,
      },
    });
    expect(result.decision).toBe('escalated_to_human');
    expect(result.effectiveGatePolicy).toBe('human');
    expect(result.persona).toBe('Lead AI PM');
    expect(result.auditReason).toContain('below auto-approval threshold');
  });

  it('approves patch when all guards green and confidence exceeds threshold', () => {
    const result = evaluateAiPmReviewer({
      taskId: 'TASK-1',
      mandatoryEvaluation: mandatoryClean,
      calibratedConfidence: 0.92,
      allGuardsPassed: true,
      aiReviewerConfig: {
        persona: 'Release AI PM',
        autoApproveThreshold: 0.85,
      },
    });
    expect(result.decision).toBe('approved');
    expect(result.effectiveGatePolicy).toBe('auto');
    expect(result.persona).toBe('Release AI PM');
  });
});

import { describe, it, expect } from 'vitest';
import {
  FindingsV1,
  FinalV1,
  DebateV1,
  ReviewFindingItem,
  parseFindingsV1,
  parseFinalV1,
} from '../../src/orchestrator/schemas/review';
import {
  evaluateAdversarialReview,
  EvidenceRecord,
} from '../../src/orchestrator/tiers/reviewer';
import {
  runNeutralArbiter,
  transitionToInternalReviewFailed,
} from '../../src/orchestrator/tiers/arbiter';
import type { LiteLLMClient, LiteLLMCompletionRequest, LiteLLMCompletionResponse } from '../../src/orchestrator/gateway/litellm-client';

/**
 * Task 9.4 — Dev-Level-2 3-Pass Adversarial Debate & Neutral Arbiter unit tests
 * (FR-006, FR-007, SC-003, ADR-062).
 */

const TASK_ID = 'TASK-REVIEW-01';

function makeFinding(overrides: Partial<ReviewFindingItem> = {}): ReviewFindingItem {
  return {
    id: 'F-001',
    axis: 'standards',
    severity: 'P0',
    category: 'test',
    filePath: 'src/modules/billing/service.ts',
    lineStart: 8,
    lineEnd: 11,
    confidence: 0.9,
    claimsTestFailure: true,
    description: 'Tests fail after the change',
    suggestedFix: 'Fix the regression',
    ...overrides,
  };
}

function makeFindings(findings: ReviewFindingItem[], taskId = TASK_ID): FindingsV1 {
  return { schemaVersion: 'findings.v1', taskId, findings };
}

function makeDebate(taskId = TASK_ID): DebateV1 {
  return {
    schemaVersion: 'debate.v1',
    taskId,
    challenges: [
      { findingId: 'F-001', stance: 'confirm', reasoning: 'Reproduced locally', evidence: 'vitest output' },
    ],
    newGaps: [],
  };
}

function makeFinal(
  verdicts: FinalV1['verdicts'],
  options: { approved?: boolean; strikeIncrement?: 0 | 1; taskId?: string } = {}
): FinalV1 {
  return {
    schemaVersion: 'final.v1',
    taskId: options.taskId ?? TASK_ID,
    verdicts,
    approved: options.approved ?? false,
    strikeIncrement: options.strikeIncrement ?? 1,
  };
}

const verdict = (findingId: string, overrides: Partial<FinalV1['verdicts'][number]> = {}) => ({
  findingId,
  verdict: 'agreed' as const,
  initialSeverity: 'P0' as const,
  effectiveSeverity: 'P0' as const,
  downgradedByEvidenceLedger: false,
  rationale: 'Confirmed by both reviewers',
  ...overrides,
});

function fakeArbiterClient(
  content: string,
  captured: LiteLLMCompletionRequest[] = []
): LiteLLMClient {
  const response: LiteLLMCompletionResponse = {
    id: 'resp-arb',
    aliasUsed: 'agent-arbiter',
    usedFallback: false,
    model: 'test-model',
    provider: 'test',
    content,
    inputTokens: 5,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    latencyMs: 1,
  };
  return {
    complete: async (request: LiteLLMCompletionRequest) => {
      captured.push(request);
      return response;
    },
  } as unknown as LiteLLMClient;
}

describe('Review schema contracts (findings.v1 / debate.v1 / final.v1)', () => {
  it('rejects Pass 1 findings below the 0.5 confidence floor (FR-006)', () => {
    const low = makeFindings([makeFinding({ confidence: 0.4 })]);
    expect(() => parseFindingsV1(low)).toThrow(/confidence/);

    const floor = makeFindings([makeFinding({ confidence: 0.5 })]);
    expect(parseFindingsV1(floor).findings[0].confidence).toBe(0.5);
  });

  it('rejects malformed final.v1 packets (strikeIncrement must be 0 | 1)', () => {
    const bad = { ...makeFinal([]), strikeIncrement: 2 };
    expect(() => parseFinalV1(bad)).toThrow(/strikeIncrement/);
    expect(() => parseFinalV1({ ...makeFinal([]), schemaVersion: 'findings.v1' })).toThrow();
  });
});

describe('Dev-Level-2 3-Pass Adversarial Review (US3, Task 9.4, FR-006/ADR-062)', () => {
  it('downgrades unbacked agreed P0/P1 test-failure claims to P2 advisory (SC-003)', () => {
    const outcome = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([makeFinding({ id: 'F-001', severity: 'P0', claimsTestFailure: true })]),
      pass2: makeDebate(),
      pass3: makeFinal([verdict('F-001')]),
      evidenceLedger: [
        { commandType: 'test', command: 'pnpm vitest run', exitCode: 0 },
      ],
      previousConsecutiveStrikes: 0,
    });

    // No failing test in the ledger -> hallucinated failure downgraded to P2
    expect(outcome.finalPacket.verdicts[0]).toMatchObject({
      effectiveSeverity: 'P2',
      downgradedByEvidenceLedger: true,
    });
    expect(outcome.approved).toBe(true);
    expect(outcome.finalPacket.strikeIncrement).toBe(0);
    expect(outcome.consecutiveStrikes).toBe(0);
    expect(outcome.shouldEscalateToArbiter).toBe(false);
    expect(outcome.reviewSignoffMarkdown).toBeDefined();
    expect(outcome.reviewSignoffMarkdown).toContain('# Review Sign-Off');
    expect(outcome.reviewSignoffMarkdown).toContain('downgraded by evidence ledger');
  });

  it('keeps agreed P0/P1 severity when a failing test record backs the claim', () => {
    const failingLedger: EvidenceRecord[] = [
      { commandType: 'test', command: 'pnpm vitest run', exitCode: 1 },
    ];
    const firstStrike = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([makeFinding({ id: 'F-001' })]),
      pass2: makeDebate(),
      pass3: makeFinal([verdict('F-001')]),
      evidenceLedger: failingLedger,
      previousConsecutiveStrikes: 0,
    });
    expect(firstStrike.approved).toBe(false);
    expect(firstStrike.finalPacket.verdicts[0].effectiveSeverity).toBe('P0');
    expect(firstStrike.finalPacket.verdicts[0].downgradedByEvidenceLedger).toBe(false);
    expect(firstStrike.consecutiveStrikes).toBe(1);
    expect(firstStrike.shouldEscalateToArbiter).toBe(false);
    expect(firstStrike.reviewSignoffMarkdown).toBeUndefined();

    // Second consecutive failed cycle -> 2 strikes -> arbiter escalation
    const secondStrike = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([makeFinding({ id: 'F-002' })]),
      pass2: makeDebate(),
      pass3: makeFinal([verdict('F-002')]),
      evidenceLedger: failingLedger,
      previousConsecutiveStrikes: 1,
    });
    expect(secondStrike.approved).toBe(false);
    expect(secondStrike.consecutiveStrikes).toBe(2);
    expect(secondStrike.shouldEscalateToArbiter).toBe(true);
  });

  it('counts 0 strikes for withdrawn and contested findings (SC-003)', () => {
    const outcome = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([
        makeFinding({ id: 'F-W', severity: 'P0', claimsTestFailure: true }),
        makeFinding({ id: 'F-C', severity: 'P1', claimsTestFailure: false, category: 'logic' }),
      ]),
      pass2: makeDebate(),
      pass3: makeFinal([
        verdict('F-W', { verdict: 'withdrawn' }),
        verdict('F-C', { verdict: 'contested', initialSeverity: 'P1', effectiveSeverity: 'P1' }),
      ]),
      evidenceLedger: [],
      previousConsecutiveStrikes: 3,
    });
    expect(outcome.approved).toBe(true);
    expect(outcome.finalPacket.strikeIncrement).toBe(0);
    // Strike counter resets on an approved pass
    expect(outcome.consecutiveStrikes).toBe(0);
    expect(outcome.shouldEscalateToArbiter).toBe(false);
  });

  it('cross-references Pass 2 gap sweep findings in Pass 3 verdicts', () => {
    const newGap = makeFinding({ id: 'F-GAP', severity: 'P1', category: 'security', claimsTestFailure: false });
    const outcome = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([]),
      pass2: { schemaVersion: 'debate.v1', taskId: TASK_ID, challenges: [], newGaps: [newGap] },
      pass3: makeFinal([
        verdict('F-GAP', { initialSeverity: 'P1', effectiveSeverity: 'P1' }),
      ]),
      evidenceLedger: [],
      previousConsecutiveStrikes: 0,
    });
    expect(outcome.approved).toBe(false);
    expect(outcome.consecutiveStrikes).toBe(1);
  });

  it('fails closed on unknown finding references and task mismatches', () => {
    expect(() =>
      evaluateAdversarialReview({
        taskId: TASK_ID,
        pass1: makeFindings([]),
        pass2: makeDebate(),
        pass3: makeFinal([verdict('F-GHOST')]),
        evidenceLedger: [],
        previousConsecutiveStrikes: 0,
      })
    ).toThrow(/unknown finding/);

    expect(() =>
      evaluateAdversarialReview({
        taskId: TASK_ID,
        pass1: makeFindings([makeFinding()], 'TASK-OTHER-99'),
        pass2: makeDebate(),
        pass3: makeFinal([verdict('F-001')]),
        evidenceLedger: [],
        previousConsecutiveStrikes: 0,
      })
    ).toThrow(/does not match/);
  });
});

describe('Neutral Arbiter (US3, Task 9.4, FR-007)', () => {
  const blockingFinal = makeFinal([verdict('F-001')]);

  it('refuses invocation below the 2-strike threshold', async () => {
    await expect(
      runNeutralArbiter({ taskId: TASK_ID, strikeCount: 1, finalPacket: blockingFinal })
    ).rejects.toThrow(/2-strike rule/);
  });

  it('synthesizes escalation-memo.md content at 2 strikes with Option A/B and a recommendation', async () => {
    const memo = await runNeutralArbiter({
      taskId: TASK_ID,
      strikeCount: 2,
      finalPacket: blockingFinal,
    });
    expect(memo.taskId).toBe(TASK_ID);
    expect(memo.strikeCount).toBe(2);
    expect(memo.optionA.pros.length).toBeGreaterThan(0);
    expect(memo.optionB.cons.length).toBeGreaterThan(0);
    expect(['A', 'B']).toContain(memo.recommendedOption);
    expect(memo.markdown).toContain('# Escalation Memo — Neutral Arbiter');
    expect(memo.markdown).toContain('### Option A:');
    expect(memo.markdown).toContain('### Option B:');
    expect(memo.markdown).toContain(`## Recommendation: Option ${memo.recommendedOption}`);
  });

  it('recommends Option A (human tie-break) when contested findings exist', async () => {
    const withContested = makeFinal([
      verdict('F-001'),
      verdict('F-002', { verdict: 'contested', initialSeverity: 'P1', effectiveSeverity: 'P1' }),
    ]);
    const memo = await runNeutralArbiter({
      taskId: TASK_ID,
      strikeCount: 2,
      finalPacket: withContested,
    });
    expect(memo.recommendedOption).toBe('A');
    expect(memo.disputeSummary).toContain('F-002');
  });

  it('routes synthesis through LiteLLMClient agent-arbiter alias when provided', async () => {
    const captured: LiteLLMCompletionRequest[] = [];
    const client = fakeArbiterClient('LLM DISPUTE SUMMARY', captured);
    const memo = await runNeutralArbiter({
      taskId: TASK_ID,
      strikeCount: 2,
      finalPacket: blockingFinal,
      litellmClient: client,
    });
    expect(memo.disputeSummary).toBe('LLM DISPUTE SUMMARY');
    expect(captured[0].alias).toBe('agent-arbiter');
    expect(captured[0].persona).toBe('arbiter');
  });

  it('transitions the task to INTERNAL_REVIEW_FAILED from legal states only', () => {
    expect(transitionToInternalReviewFailed('INTERNAL_REVIEW', TASK_ID)).toBe('INTERNAL_REVIEW_FAILED');

    // Illegal origin states throw
    expect(() => transitionToInternalReviewFailed('BACKLOG', TASK_ID)).toThrow(
      /Cannot transition task/
    );
    expect(() => transitionToInternalReviewFailed('QA_FIXING', TASK_ID)).toThrow(
      /Cannot transition task/
    );
    expect(() => transitionToInternalReviewFailed('MERGED' as never, TASK_ID)).toThrow();
  });
});

describe('Evidence ledger plumbing', () => {
  it('treats non-test evidence (lint/typecheck) as insufficient to block a downgrade', () => {
    const outcome = evaluateAdversarialReview({
      taskId: TASK_ID,
      pass1: makeFindings([makeFinding({ id: 'F-001', claimsTestFailure: true })]),
      pass2: makeDebate(),
      pass3: makeFinal([verdict('F-001')]),
      evidenceLedger: [
        { commandType: 'lint', command: 'pnpm lint', exitCode: 1 },
        { commandType: 'typecheck', command: 'pnpm typecheck', exitCode: 1 },
      ],
      previousConsecutiveStrikes: 1,
    });
    // Only failing `test` executions can back a test-failure claim (ADR-062)
    expect(outcome.finalPacket.verdicts[0].effectiveSeverity).toBe('P2');
    expect(outcome.approved).toBe(true);
  });
});

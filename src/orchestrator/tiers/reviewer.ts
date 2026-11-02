import {
  DebateV1,
  FinalV1,
  FinalVerdictItem,
  FindingsV1,
  ReviewFindingItem,
  parseDebateV1,
  parseFinalV1,
  parseFindingsV1,
} from '../schemas/review';
import { GraywolfAppError } from '../errors/taxonomy';

/**
 * Dev-Level-2 — 3-Pass Adversarial Reviewer (FR-006, FR-007, ADR-062).
 * Pass 1: `findings.v1` (confidence >= 0.5)
 * Pass 2: `debate.v1` cross-family challenge & gap sweep
 * Pass 3: `final.v1` verdict synthesis with passive evidence-ledger cross-check.
 *
 * Any `agreed P0/P1` finding that alleges a test failure without a matching
 * failing `test` record in the evidence ledger is deterministically
 * downgraded to `P2` advisory so hallucinated test failures never burn a
 * strike (SC-003).
 */

export interface EvidenceRecord {
  commandType: 'test' | 'lint' | 'typecheck' | 'build' | 'browser-test';
  command: string;
  exitCode: number;
}

export interface EvaluateAdversarialReviewOptions {
  taskId: string;
  pass1: FindingsV1;
  pass2: DebateV1;
  pass3: FinalV1;
  evidenceLedger: EvidenceRecord[];
  previousConsecutiveStrikes: number;
}

export interface AdversarialReviewOutcome {
  finalPacket: FinalV1;
  approved: boolean;
  consecutiveStrikes: number;
  shouldEscalateToArbiter: boolean;
  reviewSignoffMarkdown?: string;
}

const BLOCKING_SEVERITIES: readonly string[] = ['P0', 'P1'];

function hasFailingTestEvidence(evidenceLedger: EvidenceRecord[]): boolean {
  return evidenceLedger.some((record) => record.commandType === 'test' && record.exitCode !== 0);
}

function renderReviewSignoff(options: {
  taskId: string;
  verdicts: FinalVerdictItem[];
  downgradedCount: number;
  withdrawnCount: number;
  contestedCount: number;
}): string {
  const { taskId, verdicts, downgradedCount, withdrawnCount, contestedCount } = options;
  const agreedRows = verdicts
    .filter((verdict) => verdict.verdict === 'agreed')
    .map(
      (verdict) =>
        `- \`${verdict.findingId}\` agreed @ ${verdict.effectiveSeverity}${
          verdict.downgradedByEvidenceLedger ? ' (downgraded by evidence ledger)' : ''
        }`
    );
  return [
    '# Review Sign-Off',
    '',
    `Task \`${taskId}\` passed internal review with **0 blocking agreed P0/P1 findings**.`,
    '',
    '## Final Verdicts',
    '',
    ...(agreedRows.length > 0 ? agreedRows : ['- _(no agreed findings)_']),
    '',
    '## Strike Accounting',
    '',
    `- Withdrawn findings: ${withdrawnCount} (0 strikes)`,
    `- Contested findings: ${contestedCount} (0 strikes)`,
    `- Evidence-ledger downgrades (P0/P1 -> P2): ${downgradedCount}`,
    `- Consecutive strikes: 0`,
    '',
    '_Signed: Dev-Level-2 (agent-reviewer) — cleared for guard verification._',
    '',
  ].join('\n');
}

export function evaluateAdversarialReview(
  options: EvaluateAdversarialReviewOptions
): AdversarialReviewOutcome {
  const {
    taskId,
    pass1,
    pass2,
    pass3,
    evidenceLedger,
    previousConsecutiveStrikes,
  } = options;

  // Fail-closed schema validation of all three passes (ADR-042)
  const findings = parseFindingsV1(pass1);
  const debate = parseDebateV1(pass2);
  const finalPacketInput = parseFinalV1(pass3);

  for (const packet of [findings, debate, finalPacketInput] as Array<{ taskId: string }>) {
    if (packet.taskId !== taskId) {
      throw new GraywolfAppError(
        'ACI_VALIDATION_FAILED',
        `Review packet taskId '${packet.taskId}' does not match task '${taskId}'`
      );
    }
  }

  // Union of Pass 1 findings + Pass 2 gap sweep findings
  const findingMap = new Map<string, ReviewFindingItem>();
  for (const finding of [...findings.findings, ...debate.newGaps]) {
    findingMap.set(finding.id, finding);
  }

  const failingTestExists = hasFailingTestEvidence(evidenceLedger);

  const finalVerdicts: FinalVerdictItem[] = finalPacketInput.verdicts.map((verdict) => {
    const finding = findingMap.get(verdict.findingId);
    if (!finding) {
      throw new GraywolfAppError(
        'ACI_VALIDATION_FAILED',
        `final.v1 verdict references unknown finding '${verdict.findingId}'`
      );
    }

    const claimsTestFailure =
      (finding.claimsTestFailure ?? false) || finding.category === 'test';
    const isAgreedBlocking =
      verdict.verdict === 'agreed' && BLOCKING_SEVERITIES.includes(verdict.initialSeverity);

    // ADR-062 passive evidence cross-check: an agreed P0/P1 test-failure claim
    // without a failing `test` record is auto-downgraded to P2 advisory.
    if (isAgreedBlocking && claimsTestFailure && !failingTestExists) {
      return {
        ...verdict,
        effectiveSeverity: 'P2' as const,
        downgradedByEvidenceLedger: true,
      };
    }
    return verdict;
  });

  const blockingFindings = finalVerdicts.filter(
    (verdict) => verdict.verdict === 'agreed' && BLOCKING_SEVERITIES.includes(verdict.effectiveSeverity)
  );
  const approved = blockingFindings.length === 0;
  const strikeIncrement = approved ? 0 : 1;
  const consecutiveStrikes = approved ? 0 : previousConsecutiveStrikes + strikeIncrement;
  const shouldEscalateToArbiter = !approved && consecutiveStrikes >= 2;

  const finalPacket: FinalV1 = {
    schemaVersion: 'final.v1',
    taskId,
    verdicts: finalVerdicts,
    approved,
    strikeIncrement,
  };

  const withdrawnCount = finalVerdicts.filter((verdict) => verdict.verdict === 'withdrawn').length;
  const contestedCount = finalVerdicts.filter((verdict) => verdict.verdict === 'contested').length;
  const downgradedCount = finalVerdicts.filter((verdict) => verdict.downgradedByEvidenceLedger).length;

  const reviewSignoffMarkdown = approved
    ? renderReviewSignoff({ taskId, verdicts: finalVerdicts, downgradedCount, withdrawnCount, contestedCount })
    : undefined;

  return {
    finalPacket,
    approved,
    consecutiveStrikes,
    shouldEscalateToArbiter,
    reviewSignoffMarkdown,
  };
}

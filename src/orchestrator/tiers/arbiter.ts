import { EscalationMemo, FinalV1, parseEscalationMemo, parseFinalV1 } from '../schemas/review';
import { GraywolfAppError } from '../errors/taxonomy';
import { TaskStatus, TaskStatusSchema } from '../schemas/task';
import { assertValidTaskTransition } from '../services/state-machine';
import type { LiteLLMClient, ChatMessage } from '../gateway/litellm-client';
import { Value } from '@sinclair/typebox/value';

/**
 * Neutral Arbiter — `agent-arbiter` (FR-007).
 * Invoked after 2 consecutive Dev-Level-2 review strikes: synthesizes
 * `escalation-memo.md` (plain-English dispute summary, Option A/B trade-offs,
 * recommended default) and transitions the task to `INTERNAL_REVIEW_FAILED`.
 */

export interface RunNeutralArbiterOptions {
  taskId: string;
  strikeCount: number;
  finalPacket: FinalV1;
  litellmClient?: LiteLLMClient;
}

const MIN_STRIKES_FOR_ARBITER = 2;

function buildDeterministicDisputeSummary(
  taskId: string,
  finalPacket: FinalV1,
  strikeCount: number
): string {
  const blocking = finalPacket.verdicts.filter(
    (verdict) => verdict.verdict === 'agreed' && ['P0', 'P1'].includes(verdict.effectiveSeverity)
  );
  const contested = finalPacket.verdicts.filter((verdict) => verdict.verdict === 'contested');

  const lines: string[] = [
    `Task ${taskId} accumulated ${strikeCount} consecutive review strikes between Dev-Level-2 passes.`,
    '',
  ];
  if (blocking.length > 0) {
    lines.push('Unresolved blocking findings (agreed P0/P1):');
    for (const verdict of blocking) {
      lines.push(`- \`${verdict.findingId}\` (${verdict.effectiveSeverity}): ${verdict.rationale}`);
    }
  }
  if (contested.length > 0) {
    lines.push('Contested findings attached for human adjudication:');
    for (const verdict of contested) {
      lines.push(`- \`${verdict.findingId}\` (${verdict.effectiveSeverity}): ${verdict.rationale}`);
    }
  }
  if (blocking.length === 0 && contested.length === 0) {
    lines.push('No agreed or contested findings remain; the strike history itself is disputed.');
  }
  return lines.join('\n');
}

function renderEscalationMemoMarkdown(memo: Omit<EscalationMemo, 'markdown'>): string {
  const option = (label: string, option: EscalationMemo['optionA']): string[] => [
    `### Option ${label}: ${option.title}`,
    '',
    '**Pros**',
    ...option.pros.map((pro) => `- ${pro}`),
    '',
    '**Cons**',
    ...option.cons.map((con) => `- ${con}`),
    '',
  ];

  return [
    '# Escalation Memo — Neutral Arbiter',
    '',
    `Task \`${memo.taskId}\` — ${memo.strikeCount} consecutive review strikes.`,
    '',
    '## Dispute Summary',
    '',
    memo.disputeSummary,
    '',
    '## Options',
    '',
    ...option('A', memo.optionA),
    ...option('B', memo.optionB),
    `## Recommendation: Option ${memo.recommendedOption}`,
    '',
    memo.recommendationRationale,
    '',
    '_Synthesized by the Neutral Arbiter (`agent-arbiter`) — requires human decision before further automated retries._',
    '',
  ].join('\n');
}

export async function runNeutralArbiter(
  options: RunNeutralArbiterOptions
): Promise<EscalationMemo> {
  const { taskId, strikeCount, finalPacket, litellmClient } = options;

  const packet = parseFinalV1(finalPacket);
  if (packet.taskId !== taskId) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `final.v1 packet taskId '${packet.taskId}' does not match task '${taskId}'`
    );
  }
  if (strikeCount < MIN_STRIKES_FOR_ARBITER) {
    throw new GraywolfAppError(
      'RELAY_INTERNAL_REVIEW_TWO_STRIKES',
      `Neutral Arbiter invoked for task '${taskId}' with ${strikeCount} strike(s); the 2-strike rule requires at least ${MIN_STRIKES_FOR_ARBITER} consecutive strikes`,
      { taskId, strikeCount }
    );
  }

  let disputeSummary = buildDeterministicDisputeSummary(taskId, packet, strikeCount);

  if (litellmClient) {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are the Neutral Arbiter (agent-arbiter). Summarize the review dispute in plain English. ' +
          'Be strictly neutral: present both sides of every contested finding without endorsing either reviewer.',
      },
      {
        role: 'user',
        content: JSON.stringify(
          { taskId, strikeCount, verdicts: packet.verdicts, approved: packet.approved },
          null,
          2
        ),
      },
    ];
    const response = await litellmClient.complete({
      alias: 'agent-arbiter',
      messages,
      persona: 'arbiter',
      taskId,
    });
    if (response.content.trim().length > 0) {
      disputeSummary = response.content;
    }
  }

  const contestedCount = packet.verdicts.filter((verdict) => verdict.verdict === 'contested').length;

  const memoWithoutMarkdown: Omit<EscalationMemo, 'markdown'> = {
    taskId,
    strikeCount,
    disputeSummary,
    optionA: {
      title: 'Accept the implementation and route this memo to the human review gate',
      pros: [
        'Preserves the completed Dev-Level-3 work instead of discarding a cycle',
        'A human adjudicates the contested findings with full organizational context',
        'Terminates the automatic retry loop, capping token spend',
      ],
      cons: [
        'Consumes scarce human attention on a possibly minor dispute',
        'Delays the merge while waiting for the human decision',
      ],
    },
    optionB: {
      title: 'Fail the cycle and return the task to Dev-Level-3 for one corrective pass',
      pros: [
        'Targets the technical root cause autonomously without human cost',
        'Keeps the two-strike escalation path available if the fix is rejected again',
      ],
      cons: [
        'Risks a third failed cycle on possibly-flawed reviewer assumptions',
        'Adds another full implement + review token spend',
      ],
    },
    recommendedOption: contestedCount > 0 ? 'A' : 'B',
    recommendationRationale:
      contestedCount > 0
        ? 'Cross-family reviewers remain deadlocked on at least one finding; a neutral human tie-break is the only resolution that preserves correctness guarantees.'
        : 'No contested findings remain — the blocking evidence is factual, so one corrective Dev-Level-3 pass is the highest-probability resolution.',
  };

  const markdown = renderEscalationMemoMarkdown(memoWithoutMarkdown);
  return parseEscalationMemo({ ...memoWithoutMarkdown, markdown });
}

/**
 * Canonical arbiter escalation state transition (FR-007): records the
 * `INTERNAL_REVIEW_FAILED` task state transition against the 16-state
 * lifecycle state machine and returns the target state.
 */
export function transitionToInternalReviewFailed(
  currentStatus: TaskStatus,
  taskId?: string
): 'INTERNAL_REVIEW_FAILED' {
  if (!Value.Check(TaskStatusSchema, currentStatus)) {
    throw new GraywolfAppError('ACI_VALIDATION_FAILED', `Unknown task status '${String(currentStatus)}'`);
  }
  assertValidTaskTransition(currentStatus, 'INTERNAL_REVIEW_FAILED', taskId);
  return 'INTERNAL_REVIEW_FAILED';
}

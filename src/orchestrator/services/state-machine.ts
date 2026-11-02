import { TaskStatus } from '../schemas/task';
import { GraywolfAppError } from '../errors/taxonomy';

/**
 * Canonical 16-State Task Lifecycle State Machine Transition Table
 * Aligned with specs/001-multi-agent-platform/data-model.md §3 and ADR-042.
 */
export const LEGAL_TASK_STATE_TRANSITIONS: Readonly<
  Record<TaskStatus, readonly TaskStatus[]>
> = Object.freeze({
  BACKLOG: Object.freeze(['QUEUED', 'BLOCKED', 'CANCELLED'] as const),
  QUEUED: Object.freeze(['IN_PROGRESS', 'BLOCKED', 'UPDATED', 'CANCELLED'] as const),
  IN_PROGRESS: Object.freeze([
    'INTERNAL_REVIEW',
    'BLOCKED',
    'AWAITING_CLARIFICATION',
    'ESCALATED',
    'UPDATED',
    'CANCELLED',
  ] as const),
  BLOCKED: Object.freeze([
    'QUEUED',
    'IN_PROGRESS',
    'AWAITING_CLARIFICATION',
    'UPDATED',
    'CANCELLED',
  ] as const),
  AWAITING_CLARIFICATION: Object.freeze([
    'IN_PROGRESS',
    'QUEUED',
    'ESCALATED',
    'UPDATED',
    'CANCELLED',
  ] as const),
  INTERNAL_REVIEW: Object.freeze([
    'GUARD_VERIFYING',
    'IN_PROGRESS',
    'INTERNAL_REVIEW_FAILED',
    'ESCALATED',
    'UPDATED',
    'CANCELLED',
  ] as const),
  INTERNAL_REVIEW_FAILED: Object.freeze([
    'HUMAN_REVIEW_GATE',
    'IN_PROGRESS',
    'ESCALATED',
    'CANCELLED',
  ] as const),
  GUARD_VERIFYING: Object.freeze([
    'HUMAN_REVIEW_GATE',
    'QA_FIXING',
    'VERIFICATION_FAILED',
    'ESCALATED',
    'CANCELLED',
  ] as const),
  QA_FIXING: Object.freeze([
    'GUARD_VERIFYING',
    'INTERNAL_REVIEW',
    'VERIFICATION_FAILED',
    'ESCALATED',
    'UPDATED',
    'CANCELLED',
  ] as const),
  VERIFICATION_FAILED: Object.freeze([
    'HUMAN_REVIEW_GATE',
    'QA_FIXING',
    'IN_PROGRESS',
    'ESCALATED',
    'CANCELLED',
  ] as const),
  HUMAN_REVIEW_GATE: Object.freeze([
    'MERGED',
    'REJECTED',
    'IN_PROGRESS',
    'QUEUED',
    'CANCELLED',
  ] as const),
  ESCALATED: Object.freeze([
    'HUMAN_REVIEW_GATE',
    'IN_PROGRESS',
    'QUEUED',
    'REJECTED',
    'CANCELLED',
  ] as const),
  UPDATED: Object.freeze(['QUEUED', 'BACKLOG', 'CANCELLED'] as const),
  REJECTED: Object.freeze(['BACKLOG', 'QUEUED', 'CANCELLED'] as const),
  MERGED: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});

/**
 * Checks whether transitioning from `from` state to `to` state is permitted.
 * Transitions to the identical state are considered idempotent (returns true).
 */
export function canTransitionTaskState(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const allowed = LEGAL_TASK_STATE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that transitioning from `from` state to `to` state is valid.
 * Throws GraywolfAppError('TASK_INVALID_STATE_TRANSITION', ..., 409) if illegal.
 */
export function assertValidTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
  taskId?: string
): void {
  if (!canTransitionTaskState(from, to)) {
    throw new GraywolfAppError(
      'TASK_INVALID_STATE_TRANSITION',
      `Cannot transition task ${taskId ? `'${taskId}' ` : ''}from state '${from}' to '${to}'`,
      { taskId, from, to, allowedNextStates: LEGAL_TASK_STATE_TRANSITIONS[from] }
    );
  }
}

/**
 * Returns the array of allowed next states from the given state.
 */
export function getAllowedNextStates(from: TaskStatus): readonly TaskStatus[] {
  return LEGAL_TASK_STATE_TRANSITIONS[from] ?? [];
}

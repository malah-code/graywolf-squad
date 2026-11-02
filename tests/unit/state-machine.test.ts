import { describe, it, expect } from 'vitest';
import {
  canTransitionTaskState,
  assertValidTaskTransition,
  getAllowedNextStates,
} from '../../src/orchestrator/services/state-machine';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';
import { TaskStatus } from '../../src/orchestrator/schemas/task';

describe('Canonical 16-State Task Lifecycle State Machine (US1)', () => {
  describe('Happy Path & Valid Operational Transitions', () => {
    it('supports full linear greenfield happy path from BACKLOG to MERGED', () => {
      const happyPath: TaskStatus[] = [
        'BACKLOG',
        'QUEUED',
        'IN_PROGRESS',
        'INTERNAL_REVIEW',
        'GUARD_VERIFYING',
        'HUMAN_REVIEW_GATE',
        'MERGED',
      ];

      for (let i = 0; i < happyPath.length - 1; i++) {
        const from = happyPath[i];
        const to = happyPath[i + 1];
        expect(canTransitionTaskState(from, to)).toBe(true);
        expect(() => assertValidTaskTransition(from, to, 'TASK-100')).not.toThrow();
      }
    });

    it('supports clarification pause and resume loop', () => {
      expect(canTransitionTaskState('IN_PROGRESS', 'AWAITING_CLARIFICATION')).toBe(true);
      expect(canTransitionTaskState('AWAITING_CLARIFICATION', 'IN_PROGRESS')).toBe(true);
      expect(canTransitionTaskState('AWAITING_CLARIFICATION', 'QUEUED')).toBe(true);
    });

    it('supports 2-strike internal review failure escalation to human review gate', () => {
      expect(canTransitionTaskState('INTERNAL_REVIEW', 'INTERNAL_REVIEW_FAILED')).toBe(true);
      expect(canTransitionTaskState('INTERNAL_REVIEW_FAILED', 'HUMAN_REVIEW_GATE')).toBe(true);
      expect(canTransitionTaskState('INTERNAL_REVIEW_FAILED', 'IN_PROGRESS')).toBe(true);
    });

    it('supports QA fixing loop between GUARD_VERIFYING and QA_FIXING', () => {
      expect(canTransitionTaskState('GUARD_VERIFYING', 'QA_FIXING')).toBe(true);
      expect(canTransitionTaskState('QA_FIXING', 'GUARD_VERIFYING')).toBe(true);
      expect(canTransitionTaskState('GUARD_VERIFYING', 'VERIFICATION_FAILED')).toBe(true);
      expect(canTransitionTaskState('VERIFICATION_FAILED', 'QA_FIXING')).toBe(true);
    });

    it('supports major pivot transition (UPDATED -> QUEUED or BACKLOG)', () => {
      expect(canTransitionTaskState('QUEUED', 'UPDATED')).toBe(true);
      expect(canTransitionTaskState('IN_PROGRESS', 'UPDATED')).toBe(true);
      expect(canTransitionTaskState('UPDATED', 'QUEUED')).toBe(true);
      expect(canTransitionTaskState('UPDATED', 'BACKLOG')).toBe(true);
    });

    it('supports Panic Button cancellation from all non-terminal states', () => {
      const activeStates: TaskStatus[] = [
        'BACKLOG',
        'QUEUED',
        'IN_PROGRESS',
        'BLOCKED',
        'AWAITING_CLARIFICATION',
        'INTERNAL_REVIEW',
        'INTERNAL_REVIEW_FAILED',
        'GUARD_VERIFYING',
        'QA_FIXING',
        'VERIFICATION_FAILED',
        'HUMAN_REVIEW_GATE',
        'ESCALATED',
        'UPDATED',
        'REJECTED',
      ];

      for (const st of activeStates) {
        expect(canTransitionTaskState(st, 'CANCELLED')).toBe(true);
      }
    });

    it('treats identical state transition as idempotent no-op', () => {
      expect(canTransitionTaskState('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
      expect(() => assertValidTaskTransition('IN_PROGRESS', 'IN_PROGRESS')).not.toThrow();
    });
  });

  describe('Illegal Transitions & Error Rejection', () => {
    it('rejects skipping directly from BACKLOG to MERGED', () => {
      expect(canTransitionTaskState('BACKLOG', 'MERGED')).toBe(false);
      expect(() => assertValidTaskTransition('BACKLOG', 'MERGED', 'TASK-ERR-1')).toThrowError(
        GraywolfAppError
      );

      try {
        assertValidTaskTransition('BACKLOG', 'MERGED', 'TASK-ERR-1');
      } catch (err: unknown) {
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('TASK_INVALID_STATE_TRANSITION');
        expect(appErr.httpStatus).toBe(409);
        expect(appErr.details?.from).toBe('BACKLOG');
        expect(appErr.details?.to).toBe('MERGED');
      }
    });

    it('rejects transitioning out of terminal MERGED state', () => {
      expect(getAllowedNextStates('MERGED')).toEqual([]);
      expect(canTransitionTaskState('MERGED', 'IN_PROGRESS')).toBe(false);
      expect(canTransitionTaskState('MERGED', 'QUEUED')).toBe(false);
      expect(canTransitionTaskState('MERGED', 'CANCELLED')).toBe(false);

      expect(() => assertValidTaskTransition('MERGED', 'IN_PROGRESS', 'TASK-ERR-2')).toThrow(
        GraywolfAppError
      );
    });

    it('rejects invalid jumps such as QUEUED directly to HUMAN_REVIEW_GATE', () => {
      expect(canTransitionTaskState('QUEUED', 'HUMAN_REVIEW_GATE')).toBe(false);
      expect(() => assertValidTaskTransition('QUEUED', 'HUMAN_REVIEW_GATE')).toThrow();
    });
  });
});

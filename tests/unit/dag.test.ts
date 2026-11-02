import { describe, it, expect } from 'vitest';
import {
  detectDependencyCycle,
  assertNoDependencyCycle,
  topologicalSortTasks,
  isTaskReady,
  assertTaskReadyForDispatch,
  hasWritableScopeOverlap,
  DagTaskNode,
} from '../../src/orchestrator/services/dag';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('DAG Topological Scheduler & Scope Overlap Checker (US2)', () => {
  describe('Dependency Cycle Detection & Topological Sort', () => {
    it('detects self-referential cycle', () => {
      const tasks: DagTaskNode[] = [
        {
          id: 'TASK-1',
          status: 'QUEUED',
          blockedBy: ['TASK-1'],
          writableScope: ['src/'],
        },
      ];

      const cycle = detectDependencyCycle(tasks);
      expect(cycle).toEqual(['TASK-1', 'TASK-1']);
      expect(() => assertNoDependencyCycle(tasks)).toThrowError(GraywolfAppError);
    });

    it('detects 2-node mutual dependency cycle', () => {
      const tasks: DagTaskNode[] = [
        { id: 'TASK-A', status: 'QUEUED', blockedBy: ['TASK-B'], writableScope: ['src/a'] },
        { id: 'TASK-B', status: 'QUEUED', blockedBy: ['TASK-A'], writableScope: ['src/b'] },
      ];

      const cycle = detectDependencyCycle(tasks);
      expect(cycle).not.toBeNull();
      expect(cycle?.[0]).toBe(cycle?.[cycle?.length - 1]);
      expect(() => assertNoDependencyCycle(tasks)).toThrowError(GraywolfAppError);
    });

    it('returns null and sorts tasks topologically when DAG is acyclic', () => {
      const tasks: DagTaskNode[] = [
        { id: 'TASK-C', status: 'QUEUED', blockedBy: ['TASK-B'], writableScope: ['src/c'] },
        { id: 'TASK-A', status: 'MERGED', blockedBy: [], writableScope: ['src/a'] },
        { id: 'TASK-B', status: 'QUEUED', blockedBy: ['TASK-A'], writableScope: ['src/b'] },
      ];

      expect(detectDependencyCycle(tasks)).toBeNull();

      const sorted = topologicalSortTasks(tasks);
      const ids = sorted.map((t) => t.id);

      expect(ids.indexOf('TASK-A')).toBeLessThan(ids.indexOf('TASK-B'));
      expect(ids.indexOf('TASK-B')).toBeLessThan(ids.indexOf('TASK-C'));
    });
  });

  describe('Task Readiness Gating (Standard vs DAG Branch Stacking)', () => {
    const taskMap = new Map<string, DagTaskNode>([
      ['TASK-DONE', { id: 'TASK-DONE', status: 'MERGED', blockedBy: [], writableScope: ['src/1'] }],
      ['TASK-REVIEW', { id: 'TASK-REVIEW', status: 'INTERNAL_REVIEW', blockedBy: [], writableScope: ['src/2'] }],
      ['TASK-RUNNING', { id: 'TASK-RUNNING', status: 'IN_PROGRESS', blockedBy: [], writableScope: ['src/3'] }],
    ]);

    it('marks task with no blockers as ready', () => {
      const task: DagTaskNode = { id: 'TASK-NEW', status: 'QUEUED', blockedBy: [], writableScope: ['src/'] };
      expect(isTaskReady(task, taskMap)).toBe(true);
      expect(() => assertTaskReadyForDispatch(task, taskMap)).not.toThrow();
    });

    it('standard mode requires blocker to be in MERGED state', () => {
      const readyTask: DagTaskNode = {
        id: 'TASK-READY',
        status: 'QUEUED',
        blockedBy: ['TASK-DONE'],
        writableScope: ['src/4'],
      };
      expect(isTaskReady(readyTask, taskMap)).toBe(true);

      const notReadyTask: DagTaskNode = {
        id: 'TASK-WAITING',
        status: 'QUEUED',
        blockedBy: ['TASK-REVIEW'],
        writableScope: ['src/5'],
      };
      expect(isTaskReady(notReadyTask, taskMap)).toBe(false);
      expect(() => assertTaskReadyForDispatch(notReadyTask, taskMap)).toThrowError(
        GraywolfAppError
      );
    });

    it('DAG branch stacking allows readiness when blocker is in INTERNAL_REVIEW', () => {
      const task: DagTaskNode = {
        id: 'TASK-STACKED',
        status: 'QUEUED',
        blockedBy: ['TASK-REVIEW'],
        writableScope: ['src/5'],
      };

      // Standard mode rejects
      expect(isTaskReady(task, taskMap, { allowBranchStacking: false })).toBe(false);

      // Branch stacking allows
      expect(isTaskReady(task, taskMap, { allowBranchStacking: true })).toBe(true);
      expect(() => assertTaskReadyForDispatch(task, taskMap, { allowBranchStacking: true })).not.toThrow();
    });
  });

  describe('Pre-Dispatch Scope Overlap Checker (ADR-031)', () => {
    it('flags conflict when both candidate and active tasks touch package manifests', () => {
      const candidate: DagTaskNode = {
        id: 'TASK-CANDIDATE',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['package.json', 'src/auth/**'],
      };

      const activeTasks: DagTaskNode[] = [
        {
          id: 'TASK-ACTIVE-1',
          status: 'IN_PROGRESS',
          blockedBy: [],
          writableScope: ['pnpm-lock.yaml', 'src/db/**'],
        },
      ];

      const result = hasWritableScopeOverlap(candidate, activeTasks);
      expect(result.overlaps).toBe(true);
      expect(result.overlappingTaskIds).toContain('TASK-ACTIVE-1');
      expect(result.reasons[0]).toContain('Shared package manifest conflict');
    });

    it('flags overlap when directory prefixes intersect (including wildcard extension globs)', () => {
      const candidate: DagTaskNode = {
        id: 'TASK-CANDIDATE-DIR',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/orchestrator/services/**/*.ts'],
      };

      const activeTasks: DagTaskNode[] = [
        {
          id: 'TASK-ACTIVE-SERVICE',
          status: 'IN_PROGRESS',
          blockedBy: [],
          writableScope: ['src/orchestrator/**'],
        },
      ];

      const result = hasWritableScopeOverlap(candidate, activeTasks);
      expect(result.overlaps).toBe(true);
      expect(result.overlappingTaskIds).toContain('TASK-ACTIVE-SERVICE');
    });

    it('allows disjoint scopes to execute concurrently without overlap', () => {
      const candidate: DagTaskNode = {
        id: 'TASK-AUTH',
        status: 'QUEUED',
        blockedBy: [],
        writableScope: ['src/auth/**'],
      };

      const activeTasks: DagTaskNode[] = [
        {
          id: 'TASK-BILLING',
          status: 'IN_PROGRESS',
          blockedBy: [],
          writableScope: ['src/billing/**'],
        },
      ];

      const result = hasWritableScopeOverlap(candidate, activeTasks);
      expect(result.overlaps).toBe(false);
      expect(result.overlappingTaskIds).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
    });
  });
});

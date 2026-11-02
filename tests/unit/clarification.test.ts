import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  requestTaskClarification,
  resolveTaskClarification,
  resetClarificationState,
} from '../../src/orchestrator/services/clarification';
import { readTaskArtifact } from '../../src/orchestrator/runner/task-store';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Clarification Question Protocol Unit Tests (US3)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-clarification-test-'));
    resetClarificationState();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetClarificationState();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('generates clarification-request.md, creates child subtask, and emits cockpit notification', async () => {
    const taskId = 'TASK-801';
    const notifySpy = vi.fn();

    const result = await requestTaskClarification(
      {
        taskId,
        topic: 'Database Schema Details',
        questions: ['Should users have soft delete?', 'What is the default currency?'],
      },
      {
        baseDir: tempBaseDir,
        onCockpitNotify: notifySpy,
      }
    );

    expect(result.parentStatus).toBe('AWAITING_CLARIFICATION');
    expect(result.childTask.id).toBe(`${taskId}.1`);
    expect(result.childTask.status).toBe('QUEUED');
    expect(result.childTask.round).toBe(1);

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: taskId,
        childTaskId: `${taskId}.1`,
        round: 1,
      })
    );

    // Verify artifact content
    const artifact = await readTaskArtifact(taskId, 'clarification-request.md', {
      baseDir: tempBaseDir,
    });
    expect(artifact.content).toContain('Should users have soft delete?');
    expect(artifact.content).toContain('What is the default currency?');
  });

  it('resolves clarification, marks child MERGED, appends answers to plan.md, and emits ARP response', async () => {
    const taskId = 'TASK-802';
    const arpSpy = vi.fn();

    // 1. Request clarification first
    await requestTaskClarification(
      {
        taskId,
        topic: 'API Rate Limiting',
        questions: ['What is the requests per minute cap?'],
      },
      { baseDir: tempBaseDir }
    );

    // 2. Resolve clarification
    const resolveResult = await resolveTaskClarification(
      {
        taskId,
        answers: ['100 requests per minute with Redis sliding window.'],
      },
      {
        baseDir: tempBaseDir,
        onArpClarificationResponse: arpSpy,
      }
    );

    expect(resolveResult.parentStatus).toBe('IN_PROGRESS');
    expect(resolveResult.childTask.status).toBe('MERGED');
    expect(resolveResult.childTask.answers).toContain(
      '100 requests per minute with Redis sliding window.'
    );

    expect(arpSpy).toHaveBeenCalledTimes(1);
    expect(arpSpy).toHaveBeenCalledWith({
      taskId,
      round: 1,
      answers: ['100 requests per minute with Redis sliding window.'],
    });

    // Verify plan.md was updated
    const planArtifact = await readTaskArtifact(taskId, 'plan.md', { baseDir: tempBaseDir });
    expect(planArtifact.content).toContain('Clarification Resolution (Round 1)');
    expect(planArtifact.content).toContain('100 requests per minute with Redis sliding window.');
  });

  it('throws TASK_CLARIFICATION_LIMIT_REACHED (400) when more than 5 questions requested in a round', async () => {
    const taskId = 'TASK-803';
    const questions = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];

    await expect(
      requestTaskClarification(
        { taskId, topic: 'Too Many Questions', questions },
        { baseDir: tempBaseDir }
      )
    ).rejects.toThrowError(GraywolfAppError);

    try {
      await requestTaskClarification(
        { taskId, topic: 'Too Many Questions', questions },
        { baseDir: tempBaseDir }
      );
    } catch (err: unknown) {
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('TASK_CLARIFICATION_LIMIT_REACHED');
      expect(appErr.httpStatus).toBe(400);
    }
  });

  it('throws TASK_CLARIFICATION_LIMIT_REACHED (400) when exceeding 2 clarification rounds', async () => {
    const taskId = 'TASK-804';

    // Round 1
    await requestTaskClarification(
      { taskId, topic: 'Topic 1', questions: ['Question 1?'] },
      { baseDir: tempBaseDir }
    );
    await resolveTaskClarification(
      { taskId, answers: ['Answer 1'] },
      { baseDir: tempBaseDir }
    );

    // Round 2
    await requestTaskClarification(
      { taskId, topic: 'Topic 2', questions: ['Question 2?'] },
      { baseDir: tempBaseDir }
    );
    await resolveTaskClarification(
      { taskId, answers: ['Answer 2'] },
      { baseDir: tempBaseDir }
    );

    // Round 3 (Attempt - should fail)
    await expect(
      requestTaskClarification(
        { taskId, topic: 'Topic 3', questions: ['Question 3?'] },
        { baseDir: tempBaseDir }
      )
    ).rejects.toThrowError(GraywolfAppError);

    try {
      await requestTaskClarification(
        { taskId, topic: 'Topic 3', questions: ['Question 3?'] },
        { baseDir: tempBaseDir }
      );
    } catch (err: unknown) {
      const appErr = err as GraywolfAppError;
      expect(appErr.code).toBe('TASK_CLARIFICATION_LIMIT_REACHED');
      expect(appErr.httpStatus).toBe(400);
    }
  });
});

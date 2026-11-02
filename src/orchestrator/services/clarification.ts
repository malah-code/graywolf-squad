import { TaskStatus } from '../schemas/task';
import { GraywolfAppError } from '../errors/taxonomy';
import { assertValidTaskTransition } from './state-machine';
import { writeTaskArtifact, readTaskArtifact, TaskStoreOptions } from '../runner/task-store';

export interface ClarificationSubtask {
  id: string; // e.g., TASK-501.1
  parentTaskId: string; // e.g., TASK-501
  round: number; // 1 or 2
  title: string; // [CLARIFICATION REQUIRED] <topic>
  topic: string;
  questions: string[];
  answers?: string[];
  status: TaskStatus; // QUEUED while open, MERGED when resolved
}

export interface ClarificationOptions extends TaskStoreOptions {
  maxQuestionsPerRound?: number; // defaults to 5
  maxRoundsPerTask?: number; // defaults to 2
  currentParentStatus?: TaskStatus; // defaults to IN_PROGRESS
  onCockpitNotify?: (event: {
    parentTaskId: string;
    childTaskId: string;
    title: string;
    round: number;
    questions: string[];
  }) => void | Promise<void>;
  onArpClarificationResponse?: (payload: {
    taskId: string;
    round: number;
    answers: string[];
  }) => void | Promise<void>;
}

const activeTaskRounds = new Map<string, number>();
const activeSubtasks = new Map<string, ClarificationSubtask>();

/**
 * Resets tracked clarification rounds and subtasks (primarily for test isolation).
 */
export function resetClarificationState(taskId?: string): void {
  if (taskId) {
    activeTaskRounds.delete(taskId);
    for (const [key, sub] of activeSubtasks.entries()) {
      if (sub.parentTaskId === taskId) {
        activeSubtasks.delete(key);
      }
    }
  } else {
    activeTaskRounds.clear();
    activeSubtasks.clear();
  }
}

/**
 * Requests clarification for an in-progress task, creating a child subtask and
 * transitioning the parent task to AWAITING_CLARIFICATION.
 */
export async function requestTaskClarification(
  input: {
    taskId: string;
    topic: string;
    questions: string[];
  },
  options?: ClarificationOptions
): Promise<{
  parentStatus: 'AWAITING_CLARIFICATION';
  childTask: ClarificationSubtask;
  filePath: string;
}> {
  const maxQuestions = options?.maxQuestionsPerRound ?? 5;
  const maxRounds = options?.maxRoundsPerTask ?? 2;

  if (!input.questions || input.questions.length === 0 || input.questions.length > maxQuestions) {
    throw new GraywolfAppError(
      'TASK_CLARIFICATION_LIMIT_REACHED',
      `Clarification question count (${input.questions?.length ?? 0}) exceeds maximum allowed (${maxQuestions})`,
      { taskId: input.taskId, questionCount: input.questions?.length ?? 0, maxQuestions }
    );
  }

  const currentRound = activeTaskRounds.get(input.taskId) ?? 0;
  if (currentRound >= maxRounds) {
    throw new GraywolfAppError(
      'TASK_CLARIFICATION_LIMIT_REACHED',
      `Maximum clarification rounds (${maxRounds}) reached for task '${input.taskId}'`,
      { taskId: input.taskId, currentRound, maxRounds }
    );
  }

  const nextRound = currentRound + 1;
  const currentParentStatus = options?.currentParentStatus ?? 'IN_PROGRESS';

  // Validate state transition
  assertValidTaskTransition(currentParentStatus, 'AWAITING_CLARIFICATION', input.taskId);

  // Generate markdown artifact
  const markdownLines = [
    `# Clarification Request: ${input.taskId}`,
    `Round: ${nextRound}`,
    `Topic: ${input.topic}`,
    '',
    '## Questions',
    ...input.questions.map((q, idx) => `${idx + 1}. ${q}`),
    '',
  ];

  const { filePath } = await writeTaskArtifact(
    input.taskId,
    'clarification-request.md',
    markdownLines.join('\n'),
    options
  );

  const childTaskId = `${input.taskId}.${nextRound}`;
  const title = `[CLARIFICATION REQUIRED] ${input.topic}`;

  const childTask: ClarificationSubtask = {
    id: childTaskId,
    parentTaskId: input.taskId,
    round: nextRound,
    title,
    topic: input.topic,
    questions: [...input.questions],
    status: 'QUEUED',
  };

  activeTaskRounds.set(input.taskId, nextRound);
  activeSubtasks.set(input.taskId, childTask);

  if (options?.onCockpitNotify) {
    await options.onCockpitNotify({
      parentTaskId: input.taskId,
      childTaskId,
      title,
      round: nextRound,
      questions: input.questions,
    });
  }

  return {
    parentStatus: 'AWAITING_CLARIFICATION',
    childTask,
    filePath,
  };
}

/**
 * Resolves a pending clarification request with human answers, marking the child subtask
 * MERGED, updating plan.md with answers, and returning parent to IN_PROGRESS.
 */
export async function resolveTaskClarification(
  input: {
    taskId: string;
    answers: string[];
  },
  options?: ClarificationOptions
): Promise<{
  parentStatus: 'IN_PROGRESS';
  childTask: ClarificationSubtask;
  planFilePath: string;
}> {
  const currentParentStatus = options?.currentParentStatus ?? 'AWAITING_CLARIFICATION';

  assertValidTaskTransition(currentParentStatus, 'IN_PROGRESS', input.taskId);

  const childTask = activeSubtasks.get(input.taskId);
  const round = childTask?.round ?? activeTaskRounds.get(input.taskId) ?? 1;

  if (childTask) {
    childTask.answers = [...input.answers];
    childTask.status = 'MERGED';
  }

  // Read existing plan.md or fallback to default header
  let planContent = '';
  try {
    const existing = await readTaskArtifact(input.taskId, 'plan.md', options);
    planContent = existing.content;
  } catch {
    planContent = `# Task Implementation Plan: ${input.taskId}\n`;
  }

  const resolutionSection = [
    '',
    `## Clarification Resolution (Round ${round})`,
    ...input.answers.map((a, idx) => `${idx + 1}. ${a}`),
    '',
  ].join('\n');

  const updatedPlan = `${planContent.trimEnd()}\n${resolutionSection}`;

  const { filePath: planFilePath } = await writeTaskArtifact(
    input.taskId,
    'plan.md',
    updatedPlan,
    options
  );

  if (options?.onArpClarificationResponse) {
    await options.onArpClarificationResponse({
      taskId: input.taskId,
      round,
      answers: input.answers,
    });
  }

  const resolvedChild: ClarificationSubtask = childTask ?? {
    id: `${input.taskId}.${round}`,
    parentTaskId: input.taskId,
    round,
    title: `[CLARIFICATION REQUIRED] Round ${round}`,
    topic: 'Clarification',
    questions: [],
    answers: [...input.answers],
    status: 'MERGED',
  };

  return {
    parentStatus: 'IN_PROGRESS',
    childTask: resolvedChild,
    planFilePath,
  };
}

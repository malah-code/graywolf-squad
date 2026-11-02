import path from 'node:path';
import { Worker, ConnectionOptions } from 'bullmq';
import { TaskStatus } from '../schemas/task';
import { GraywolfAppError } from '../errors/taxonomy';
import { assertValidTaskTransition } from '../services/state-machine';
import {
  isTaskReady,
  assertTaskReadyForDispatch,
  hasWritableScopeOverlap,
  DagTaskNode,
} from '../services/dag';
import { acquireTaskLock, AcquiredTaskLock } from '../runner/lock';
import { createTaskWorktree, restoreWorktree } from '../runner/worktree';
import {
  provisionSandboxDatabase,
  teardownSandboxDatabase,
  resolveSandboxDbTier,
  SandboxDbTier,
} from '../db/sandbox-db';
import { IRunnerProvider } from '../runner/IRunnerProvider';
import { AdmissionController } from '../runner/admission';

export interface ActiveTaskExecution {
  taskId: string;
  workspaceId?: string;
  orgId?: string;
  containerId?: string | null;
  worktreePath?: string;
  dbTier: SandboxDbTier;
  lock?: AcquiredTaskLock;
}

export interface OrchestratorDependencies {
  runnerProvider?: IRunnerProvider;
  repoRoot?: string;
  locksDir?: string;
  baseDatabaseUrl?: string;
  defaultDbTier?: SandboxDbTier;
  maxConcurrentSandboxes?: number;
  admissionController?: AdmissionController;
  arpGateway?: {
    sendTaskCancel?: (taskId: string, reason: string) => Promise<boolean> | boolean;
  };
  llmGateway?: {
    abortCallsForTask?: (taskId: string) => Promise<boolean> | boolean;
  };
  queryExecutor?: (sql: string, targetConnectionString?: string) => Promise<unknown>;
  getTaskById?: (taskId: string) => Promise<DagTaskNode | undefined> | DagTaskNode | undefined;
  getActiveTasks?: () => Promise<DagTaskNode[]> | DagTaskNode[];
  getAllTasksMap?: () =>
    | Promise<Map<string, DagTaskNode> | Record<string, DagTaskNode>>
    | Map<string, DagTaskNode>
    | Record<string, DagTaskNode>;
  updateTaskStatus?: (taskId: string, nextStatus: TaskStatus) => Promise<void> | void;
}

export interface CancelTaskExecutionResult {
  taskId: string;
  status: 'CANCELLED';
  reason: string;
  arpCancelSent: boolean;
  sandboxTornDown: boolean;
  llmAborted: boolean;
  sandboxDbDropped: boolean;
  worktreeRestored: boolean;
  lockReleased: boolean;
}

const activeExecutions = new Map<string, ActiveTaskExecution>();

export function registerActiveExecution(execution: ActiveTaskExecution): void {
  activeExecutions.set(execution.taskId, execution);
}

export function getActiveExecution(taskId: string): ActiveTaskExecution | undefined {
  return activeExecutions.get(taskId);
}

export function unregisterActiveExecution(taskId: string): void {
  activeExecutions.delete(taskId);
}

export function clearActiveExecutions(): void {
  activeExecutions.clear();
}

/**
 * Pre-flight checks and dispatches a task if all admission, DAG, and scope overlap checks pass.
 */
export async function dispatchTaskIfReady(
  taskId: string,
  deps: OrchestratorDependencies
): Promise<ActiveTaskExecution> {
  const task = await deps.getTaskById?.(taskId);
  if (!task) {
    throw new GraywolfAppError('TASK_NOT_FOUND', `Task '${taskId}' not found`, { taskId });
  }

  // 1. Admission Control capacity check
  const maxCapacity = deps.maxConcurrentSandboxes ?? 10;
  if (activeExecutions.size >= maxCapacity) {
    throw new GraywolfAppError(
      'TASK_ALREADY_DISPATCHED',
      `Runner capacity limit reached (${activeExecutions.size}/${maxCapacity}). Task queued.`,
      { taskId, activeCount: activeExecutions.size, maxCapacity }
    );
  }

  // 2. DAG Dependency readiness check
  const allTasksMap = (await deps.getAllTasksMap?.()) ?? new Map<string, DagTaskNode>();
  if (!isTaskReady(task, allTasksMap)) {
    assertTaskReadyForDispatch(task, allTasksMap);
  }

  // 3. Pre-Dispatch Scope Overlap check (ADR-031)
  const activeList = await deps.getActiveTasks?.();
  const activeNodes = activeList ?? Array.from(activeExecutions.keys()).map((id) => ({
    id,
    status: 'IN_PROGRESS' as TaskStatus,
    blockedBy: [],
    writableScope: [],
  }));

  const overlap = hasWritableScopeOverlap(task, activeNodes);
  if (overlap.overlaps) {
    throw new GraywolfAppError(
      'TASK_BLOCKED_BY_DEPENDENCIES',
      `Cannot dispatch task '${taskId}': writable scope overlaps with active tasks: ${overlap.reasons.join('; ')}`,
      { taskId, overlappingTaskIds: overlap.overlappingTaskIds, reasons: overlap.reasons }
    );
  }

  // 4. Assert valid state transition to IN_PROGRESS
  assertValidTaskTransition(task.status, 'IN_PROGRESS', taskId);

    // 4.5 Resolve Sandbox DB Tier & Acquire Weighted Admission Ticket BEFORE acquiring filesystem lock
    const dbTier: SandboxDbTier = resolveSandboxDbTier({
      explicitTier: task.explicitDbTier,
      targetFiles: [...(task.targetFiles ?? []), ...task.writableScope],
      plannerDeclaredTier: task.plannerDeclaredDbTier,
      defaultTier: deps.defaultDbTier,
    });

    if (deps.admissionController) {
      const admissionRes = deps.admissionController.tryAcquire({
        taskId,
        dbTier,
        requiresBrowserE2E: task.requiresBrowserE2E,
      });
      if (!admissionRes.admitted) {
        throw new GraywolfAppError(
          'TASK_ALREADY_DISPATCHED',
          `Admission control rejected dispatch for task '${taskId}': ${admissionRes.reason}`,
          { taskId, weight: admissionRes.weight, reason: admissionRes.reason }
        );
      }
    }

    // 5. Acquire atomic directory lock
    let lock: AcquiredTaskLock;
    try {
      lock = await acquireTaskLock(taskId, { locksDir: deps.locksDir });
    } catch (lockErr) {
      deps.admissionController?.release(taskId);
      throw lockErr;
    }

    let worktreePath: string | undefined;
    let dbProvisioned = false;
    let containerId: string | null = null;

    try {
      if (deps.repoRoot) {
        const worktreeInfo = await createTaskWorktree({
          repoRoot: deps.repoRoot,
          taskId,
        });
        worktreePath = worktreeInfo.worktreePath;
      }

      // 6. Provision Sandbox Database (PRD §5.4 4-level hierarchy)
      if (deps.baseDatabaseUrl) {
        await provisionSandboxDatabase({
          taskId,
          tier: dbTier,
          baseDatabaseUrl: deps.baseDatabaseUrl,
          queryExecutor: deps.queryExecutor,
        });
        dbProvisioned = dbTier !== 'tier-0-mock';
      }

      // 7. Start runner sandbox container if provider configured
      if (deps.runnerProvider) {
        const containerMemoryBytes = deps.admissionController
          ?.getProfile()
          .containerMemoryBytes;
        const sandbox = await deps.runnerProvider.startSandbox({
          taskId,
          image: 'graywolf-runner:latest',
          worktreePath,
          parentGitDir: deps.repoRoot ? path.join(deps.repoRoot, '.git') : undefined,
          memoryBytes: containerMemoryBytes,
          bindMounts: worktreePath ? [{ source: worktreePath, target: '/workspace' }] : undefined,
        });
        containerId = sandbox.containerId;
      }

    // 8. Update task status to IN_PROGRESS
    await deps.updateTaskStatus?.(taskId, 'IN_PROGRESS');
  } catch (err) {
    deps.admissionController?.release(taskId);
    // Rollback provisioned resources on dispatch failure
    if (containerId && deps.runnerProvider) {
      try {
        await deps.runnerProvider.teardownSandbox(taskId);
      } catch {
        // Ignore rollback error
      }
    }
    if (dbProvisioned) {
      try {
        await teardownSandboxDatabase({
          taskId,
          tier: dbTier,
          queryExecutor: deps.queryExecutor,
        });
      } catch {
        // Ignore rollback error
      }
    }
    await lock.release();
    throw err;
  }

  const execution: ActiveTaskExecution = {
    taskId,
    containerId,
    worktreePath,
    dbTier,
    lock,
  };

  registerActiveExecution(execution);
  return execution;
}

/**
 * Executes 7-step Panic Button teardown (PRD §12.1).
 * 1. ARP task.cancel -> 2. teardownSandbox -> 3. abort LiteLLM -> 4. teardownSandboxDatabase ->
 * 5. restoreWorktree -> 6. release task lock -> 7. transition to CANCELLED
 */
export async function cancelTaskExecution(
  taskId: string,
  reason: string,
  deps: OrchestratorDependencies
): Promise<CancelTaskExecutionResult> {
  const execution = getActiveExecution(taskId);
  const task = await deps.getTaskById?.(taskId);
  const currentStatus = task?.status ?? 'IN_PROGRESS';

  // Validate transition before destroying active resources
  assertValidTaskTransition(currentStatus, 'CANCELLED', taskId);

  // 1. Send ARP cancel event to running container if connected
  let arpCancelSent = false;
  try {
    const res = await deps.arpGateway?.sendTaskCancel?.(taskId, reason);
    arpCancelSent = Boolean(res);
  } catch {
    arpCancelSent = false;
  }

  // 2. Teardown Docker sandbox container
  let sandboxTornDown = false;
  if (deps.runnerProvider) {
    try {
      await deps.runnerProvider.teardownSandbox(taskId);
      sandboxTornDown = true;
    } catch {
      sandboxTornDown = false;
    }
  }

  // 3. Abort active LiteLLM calls / spend controller
  let llmAborted = false;
  try {
    const res = await deps.llmGateway?.abortCallsForTask?.(taskId);
    llmAborted = Boolean(res);
  } catch {
    llmAborted = false;
  }

  // 4. Teardown sandbox database
  let sandboxDbDropped = false;
  if (execution?.dbTier && execution.dbTier !== 'tier-0-mock') {
    try {
      await teardownSandboxDatabase({
        taskId,
        tier: execution.dbTier,
        queryExecutor: deps.queryExecutor,
      });
      sandboxDbDropped = true;
    } catch {
      sandboxDbDropped = false;
    }
  }

  // 5. Restore worktree to clean HEAD state (discards uncommitted tracked and untracked changes)
  let worktreeRestored = false;
  if (execution?.worktreePath) {
    try {
      await restoreWorktree(execution.worktreePath);
      worktreeRestored = true;
    } catch {
      worktreeRestored = false;
    }
  }

  // 6. Release held atomic directory lock
  let lockReleased = false;
  if (execution?.lock) {
    try {
      await execution.lock.release();
      lockReleased = true;
    } catch {
      lockReleased = false;
    }
  }

  // 7. Transition task state to CANCELLED
  assertValidTaskTransition(currentStatus, 'CANCELLED', taskId);
  await deps.updateTaskStatus?.(taskId, 'CANCELLED');

  deps.admissionController?.release(taskId);
  unregisterActiveExecution(taskId);

  return {
    taskId,
    status: 'CANCELLED',
    reason,
    arpCancelSent,
    sandboxTornDown,
    llmAborted,
    sandboxDbDropped,
    worktreeRestored,
    lockReleased,
  };
}

/**
 * Creates a BullMQ worker for the 'task-dispatch' queue.
 */
export function createOrchestratorDispatchWorker(
  queueName: string,
  deps: OrchestratorDependencies,
  connection: ConnectionOptions
): Worker {
  return new Worker(
    queueName,
    async (job) => {
      const taskId = job.data?.taskId as string;
      if (!taskId) throw new Error('Missing taskId in dispatch job');
      return await dispatchTaskIfReady(taskId, deps);
    },
    { connection }
  );
}

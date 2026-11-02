import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requirePermission } from '../auth/rbac';
import { withTenantContext } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';
import { TaskStatusSchema, TaskTypeSchema, TaskStatus } from '../schemas/task';
import { assertValidTaskTransition } from '../services/state-machine';
import { assertNoDependencyCycle, hasWritableScopeOverlap, DagTaskNode } from '../services/dag';
import { resolveTaskClarification } from '../services/clarification';
import { cancelTaskExecution } from '../workers/orchestrator';

export interface TaskRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  title: string;
  type: 'feature' | 'bug' | 'refactor' | 'bug-bash-sprint';
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assignedTier?: string | null;
  blockedBy: string[];
  writableScope: string[];
  spendUsd: number;
  internalReviewAttempts: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTaskBody {
  projectId: string;
  title: string;
  briefMarkdown?: string;
  type?: 'feature' | 'bug' | 'refactor' | 'bug-bash-sprint';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  blockedBy?: string[];
  writableScope?: string[];
}

const ListTasksQuerySchema = Type.Object({
  projectId: Type.String({ minLength: 1 }),
  status: Type.Optional(TaskStatusSchema),
});

const CreateTaskBodySchema = Type.Object({
  projectId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  briefMarkdown: Type.Optional(Type.String()),
  type: Type.Optional(TaskTypeSchema),
  priority: Type.Optional(
    Type.Union([
      Type.Literal('LOW'),
      Type.Literal('MEDIUM'),
      Type.Literal('HIGH'),
      Type.Literal('CRITICAL'),
    ])
  ),
  blockedBy: Type.Optional(Type.Array(Type.String())),
  writableScope: Type.Optional(Type.Array(Type.String())),
});

const ClarificationBodySchema = Type.Object({
  answers: Type.Array(
    Type.Object({
      questionId: Type.String({ minLength: 1 }),
      answer: Type.String({ minLength: 1 }),
    }),
    { minItems: 1 }
  ),
});

// In-memory fallback repository for tasks
const inMemoryTasks = new Map<string, TaskRecord>();

export function clearInMemoryTasks(): void {
  inMemoryTasks.clear();
}

export function seedInMemoryTask(task: TaskRecord): void {
  inMemoryTasks.set(task.id, task);
}

export function getInMemoryTask(id: string): TaskRecord | undefined {
  return inMemoryTasks.get(id);
}

async function resolveWorkspaceTask(
  taskId: string,
  workspaceId: string,
  orgId: string
): Promise<TaskRecord> {
  const memTask = inMemoryTasks.get(taskId);
  if (memTask) {
    if (memTask.workspaceId !== workspaceId) {
      throw new GraywolfAppError('TASK_NOT_FOUND', `Task '${taskId}' not found in active workspace`);
    }
    return memTask;
  }

  try {
    const dbTask = await withTenantContext({ workspaceId, orgId }, async (client) => {
      const res = await client.query<{
        id: string;
        project_id: string;
        workspace_id: string;
        title: string;
        type: TaskRecord['type'];
        status: string;
        priority: TaskRecord['priority'];
        assigned_tier: string | null;
        blocked_by: string[] | null;
        writable_scope: string[] | null;
        current_spend_usd: string | number;
        internal_review_attempts: number;
      }>(
        `SELECT id, project_id, workspace_id, title, type, status, priority,
                assigned_tier, blocked_by, writable_scope, current_spend_usd, internal_review_attempts
         FROM tasks
         WHERE id = $1 AND workspace_id = $2`,
        [taskId, workspaceId]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        projectId: r.project_id,
        workspaceId: r.workspace_id,
        title: r.title,
        type: r.type,
        status: r.status,
        priority: r.priority,
        assignedTier: r.assigned_tier,
        blockedBy: r.blocked_by ?? [],
        writableScope: r.writable_scope ?? [],
        spendUsd: Number(r.current_spend_usd || 0),
        internalReviewAttempts: r.internal_review_attempts || 0,
      };
    });

    if (dbTask) {
      inMemoryTasks.set(dbTask.id, dbTask);
      return dbTask;
    }
  } catch {
    // DB offline; fall through to TASK_NOT_FOUND
  }

  throw new GraywolfAppError('TASK_NOT_FOUND', `Task '${taskId}' not found`);
}

async function updateTaskStatus(
  task: TaskRecord,
  newStatus: string,
  orgId: string
): Promise<void> {
  task.status = newStatus;
  inMemoryTasks.set(task.id, task);

  try {
    await withTenantContext({ workspaceId: task.workspaceId, orgId }, async (client) => {
      await client.query(
        `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3`,
        [newStatus, task.id, task.workspaceId]
      );
    });
  } catch (err) {
    if (err instanceof GraywolfAppError) throw err;
    // DB offline; in-memory state already updated
  }
}

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/tasks
  fastify.get(
    '/',
    {
      preHandler: requirePermission('list_tasks'),
      schema: {
        querystring: ListTasksQuerySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const query = (request.query || {}) as { projectId?: string; status?: string };
      const { projectId, status } = query;

      if (!projectId) {
        throw new GraywolfAppError('ACI_VALIDATION_FAILED', 'projectId query parameter is required');
      }

      try {
        const tasks = await withTenantContext(
          { workspaceId: user.currentWorkspaceId, orgId: user.currentOrganizationId },
          async (client) => {
            let sql = `SELECT id, project_id, workspace_id, title, type, status, priority,
                              assigned_tier, blocked_by, writable_scope, current_spend_usd, internal_review_attempts
                       FROM tasks
                       WHERE workspace_id = $1 AND project_id = $2`;
            const params: unknown[] = [user.currentWorkspaceId, projectId];

            if (status) {
              sql += ` AND status = $3`;
              params.push(status);
            }

            const res = await client.query<{
              id: string;
              project_id: string;
              workspace_id: string;
              title: string;
              type: TaskRecord['type'];
              status: string;
              priority: TaskRecord['priority'];
              assigned_tier: string | null;
              blocked_by: string[] | null;
              writable_scope: string[] | null;
              current_spend_usd: string | number;
              internal_review_attempts: number;
            }>(sql, params);

            return res.rows.map((r) => ({
              id: r.id,
              projectId: r.project_id,
              workspaceId: r.workspace_id,
              title: r.title,
              type: r.type,
              status: r.status,
              priority: r.priority,
              assignedTier: r.assigned_tier,
              blockedBy: r.blocked_by ?? [],
              writableScope: r.writable_scope ?? [],
              spendUsd: Number(r.current_spend_usd || 0),
              internalReviewAttempts: r.internal_review_attempts || 0,
            }));
          }
        );

        if (tasks.length > 0) {
          return reply.status(200).send(tasks);
        }
      } catch {
        // Fallback to in-memory tasks
      }

      const tasks = Array.from(inMemoryTasks.values()).filter(
        (t) =>
          t.workspaceId === user.currentWorkspaceId &&
          t.projectId === projectId &&
          (!status || t.status === status)
      );

      return reply.status(200).send(tasks);
    }
  );

  // POST /api/v1/tasks
  fastify.post(
    '/',
    {
      preHandler: requirePermission('create_task'),
      schema: {
        body: CreateTaskBodySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const body = (request.body || {}) as CreateTaskBody;

      if (!body.projectId || !body.title) {
        throw new GraywolfAppError('ACI_VALIDATION_FAILED', 'projectId and title are required');
      }

      const taskId = `TASK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const task: TaskRecord = {
        id: taskId,
        projectId: body.projectId,
        workspaceId: user.currentWorkspaceId,
        title: body.title,
        type: body.type ?? 'feature',
        status: 'BACKLOG',
        priority: body.priority ?? 'MEDIUM',
        assignedTier: null,
        blockedBy: body.blockedBy ?? [],
        writableScope: body.writableScope ?? [],
        spendUsd: 0,
        internalReviewAttempts: 0,
      };

      // Validate DAG cycle integrity across existing workspace tasks + new task
      if (task.blockedBy.length > 0) {
        const existingNodes: DagTaskNode[] = Array.from(inMemoryTasks.values())
          .filter((t) => t.workspaceId === user.currentWorkspaceId)
          .map((t) => ({
            id: t.id,
            status: normalizeTaskStatus(t.status),
            blockedBy: t.blockedBy,
            writableScope: t.writableScope,
          }));
        existingNodes.push({
          id: task.id,
          status: 'BACKLOG',
          blockedBy: task.blockedBy,
          writableScope: task.writableScope,
        });
        assertNoDependencyCycle(existingNodes);
      }

      try {
        await withTenantContext(
          { workspaceId: user.currentWorkspaceId, orgId: user.currentOrganizationId },
          async (client) => {
            await client.query(
              `INSERT INTO tasks (id, project_id, workspace_id, title, type, status, priority, blocked_by, writable_scope)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                task.id,
                task.projectId,
                task.workspaceId,
                task.title,
                task.type,
                task.status,
                task.priority,
                task.blockedBy,
                task.writableScope,
              ]
            );
          }
        );
      } catch {
        // Fallback to in-memory store
      }

      inMemoryTasks.set(task.id, task);
      return reply.status(201).send(task);
    }
  );

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'WAITING_FOR_CLARIFICATION') return 'AWAITING_CLARIFICATION';
  if (status === 'WAITING_FOR_REVIEW_GATE') return 'HUMAN_REVIEW_GATE';
  return status as TaskStatus;
}

  // POST /api/v1/tasks/:taskId/dispatch
  fastify.post(
    '/:taskId/dispatch',
    { preHandler: requirePermission('dispatch_task') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const params = request.params as { taskId: string };
      const { taskId } = params;
      const task = await resolveWorkspaceTask(
        taskId,
        user.currentWorkspaceId,
        user.currentOrganizationId
      );

      if (task.status === 'IN_PROGRESS') {
        throw new GraywolfAppError('TASK_ALREADY_DISPATCHED', `Task '${taskId}' is already in progress`);
      }

      // Check dependencies and scope overlap (ADR-031)
      const allWorkspaceTasks = Array.from(inMemoryTasks.values()).filter(
        (t) => t.workspaceId === user.currentWorkspaceId
      );

      if (task.blockedBy.length > 0) {
        for (const blockerId of task.blockedBy) {
          let blocker: TaskRecord | undefined;
          try {
            blocker = await resolveWorkspaceTask(
              blockerId,
              user.currentWorkspaceId,
              user.currentOrganizationId
            );
          } catch {
            blocker = undefined;
          }

          if (!blocker || blocker.status !== 'MERGED') {
            throw new GraywolfAppError(
              'TASK_BLOCKED_BY_DEPENDENCIES',
              `Task '${taskId}' is blocked by unmet dependency '${blockerId}'`
            );
          }
        }
      }

      const activeStates: string[] = [
        'IN_PROGRESS',
        'INTERNAL_REVIEW',
        'GUARD_VERIFYING',
        'QA_FIXING',
      ];
      const activeNodes: DagTaskNode[] = allWorkspaceTasks
        .filter((t) => t.id !== task.id && activeStates.includes(t.status))
        .map((t) => ({
          id: t.id,
          status: normalizeTaskStatus(t.status),
          blockedBy: t.blockedBy,
          writableScope: t.writableScope,
        }));

      if (activeNodes.length > 0 && task.writableScope.length > 0) {
        const overlap = hasWritableScopeOverlap(
          {
            id: task.id,
            status: normalizeTaskStatus(task.status),
            blockedBy: task.blockedBy,
            writableScope: task.writableScope,
          },
          activeNodes
        );
        if (overlap.overlaps) {
          throw new GraywolfAppError(
            'TASK_BLOCKED_BY_DEPENDENCIES',
            `Cannot dispatch task '${taskId}': writable scope overlaps with active task(s): ${overlap.overlappingTaskIds.join(', ')}`,
            { taskId, overlappingTaskIds: overlap.overlappingTaskIds, reasons: overlap.reasons }
          );
        }
      }

      const currentStatus = normalizeTaskStatus(task.status);
      if (currentStatus === 'BACKLOG') {
        assertValidTaskTransition('BACKLOG', 'QUEUED', taskId);
        assertValidTaskTransition('QUEUED', 'IN_PROGRESS', taskId);
      } else {
        assertValidTaskTransition(currentStatus, 'IN_PROGRESS', taskId);
      }

      await updateTaskStatus(task, 'IN_PROGRESS', user.currentOrganizationId);
      const containerId = `runner-${taskId.toLowerCase()}`;

      return reply.status(200).send({
        taskId,
        status: 'IN_PROGRESS',
        containerId,
      });
    }
  );

  // POST /api/v1/tasks/:taskId/clarification
  fastify.post(
    '/:taskId/clarification',
    {
      preHandler: requirePermission('answer_clarification'),
      schema: {
        body: ClarificationBodySchema,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const params = request.params as { taskId: string };
      const { taskId } = params;
      const body = request.body as { answers: { questionId: string; answer: string }[] };
      const task = await resolveWorkspaceTask(
        taskId,
        user.currentWorkspaceId,
        user.currentOrganizationId
      );

      const currentStatus = normalizeTaskStatus(task.status);
      assertValidTaskTransition(currentStatus, 'IN_PROGRESS', taskId);

      await resolveTaskClarification(
        {
          taskId,
          answers: body.answers.map((a) => `${a.questionId}: ${a.answer}`),
        },
        {
          currentParentStatus: currentStatus,
          workspaceId: user.currentWorkspaceId,
          orgId: user.currentOrganizationId,
        }
      );

      await updateTaskStatus(task, 'IN_PROGRESS', user.currentOrganizationId);
      return reply.status(200).send({
        success: true,
        resumedStatus: 'IN_PROGRESS',
      });
    }
  );

  // POST /api/v1/tasks/:taskId/review-gate/approve
  fastify.post(
    '/:taskId/review-gate/approve',
    { preHandler: requirePermission('approve_review_gate') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const params = request.params as { taskId: string };
      const { taskId } = params;
      const task = await resolveWorkspaceTask(
        taskId,
        user.currentWorkspaceId,
        user.currentOrganizationId
      );

      const currentStatus = normalizeTaskStatus(task.status);
      assertValidTaskTransition(currentStatus, 'MERGED', taskId);

      await updateTaskStatus(task, 'MERGED', user.currentOrganizationId);
      return reply.status(200).send({
        taskId,
        mergedStatus: 'MERGED',
        prUrl: `https://github.com/graywolf-squad/repo/pull/1`,
      });
    }
  );

  // POST /api/v1/tasks/:taskId/cancel (Panic Button endpoint)
  fastify.post(
    '/:taskId/cancel',
    { preHandler: requirePermission('dispatch_task') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const params = request.params as { taskId: string };
      const { taskId } = params;
      const task = await resolveWorkspaceTask(
        taskId,
        user.currentWorkspaceId,
        user.currentOrganizationId
      );

      const currentStatus = normalizeTaskStatus(task.status);
      await cancelTaskExecution(taskId, 'Cancelled via Control Plane API', {
        getTaskById: () => ({
          id: task.id,
          status: currentStatus,
          blockedBy: task.blockedBy,
          writableScope: task.writableScope,
        }),
        updateTaskStatus: async (_id, nextStatus) => {
          await updateTaskStatus(task, nextStatus, user.currentOrganizationId);
        },
      });

      return reply.status(200).send({
        taskId,
        status: 'CANCELLED',
        cancelled: true,
      });
    }
  );
}

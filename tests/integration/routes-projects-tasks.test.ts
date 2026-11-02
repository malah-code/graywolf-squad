import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/orchestrator/app';
import {
  createSession,
  setValkeyClient,
  InMemoryValkeyStore,
} from '../../src/orchestrator/auth/better-auth';
import {
  clearInMemoryProjects,
  seedInMemoryProject,
} from '../../src/orchestrator/routes/projects';
import {
  clearInMemoryTasks,
  seedInMemoryTask,
} from '../../src/orchestrator/routes/tasks';

describe('Control Plane Projects, Tasks & Telemetry Routes Integration Tests (US2)', () => {
  let app: FastifyInstance;
  let valkeyStore: InMemoryValkeyStore;

  const leadDevSessionData = {
    userId: 'usr-lead-002',
    email: 'lead@graywolf.test',
    currentWorkspaceId: 'ws-alpha-111',
    currentOrganizationId: 'org-main-999',
    role: 'lead_dev' as const,
  };

  const devSessionData = {
    userId: 'usr-dev-003',
    email: 'dev@graywolf.test',
    currentWorkspaceId: 'ws-alpha-111',
    currentOrganizationId: 'org-main-999',
    role: 'developer' as const,
  };

  beforeEach(() => {
    valkeyStore = new InMemoryValkeyStore();
    setValkeyClient(valkeyStore);
    clearInMemoryProjects();
    clearInMemoryTasks();
    app = buildApp({ logger: false });
  });

  describe('Project Management Routes (/api/v1/projects)', () => {
    it('GET /api/v1/projects returns accessible projects for workspace', async () => {
      const session = await createSession(devSessionData);
      seedInMemoryProject({
        id: 'proj-1',
        workspaceId: devSessionData.currentWorkspaceId,
        name: 'Squad Core',
        slug: 'squad-core',
        mode: 'greenfield',
        gitRemoteUrl: 'https://github.com/graywolf-squad/core.git',
        gitProvider: 'github',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const projects = JSON.parse(res.payload) as Array<{ id: string; name: string }>;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Squad Core');
    });

    it('POST /api/v1/projects denies creation for developer role with 403 RBAC_INSUFFICIENT_ROLE', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          name: 'Forbidden App',
          slug: 'forbidden-app',
          mode: 'greenfield',
          gitRemoteUrl: 'https://github.com/forbidden/repo.git',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('RBAC_INSUFFICIENT_ROLE');
    });

    it('POST /api/v1/projects allows lead_dev to create project with 201 Created', async () => {
      const session = await createSession(leadDevSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          name: 'Phoenix Platform',
          slug: 'phoenix-platform',
          mode: 'brownfield',
          gitRemoteUrl: 'https://github.com/graywolf-squad/phoenix.git',
          gitProvider: 'github',
        },
      });

      expect(res.statusCode).toBe(201);
      const project = JSON.parse(res.payload) as {
        id: string;
        workspaceId: string;
        name: string;
        slug: string;
        mode: string;
      };

      expect(project.id).toBeDefined();
      expect(project.workspaceId).toBe(leadDevSessionData.currentWorkspaceId);
      expect(project.name).toBe('Phoenix Platform');
      expect(project.mode).toBe('brownfield');
    });

    it('POST /api/v1/projects/:projectId/recon queues reconnaissance and returns 202 Accepted', async () => {
      const session = await createSession(leadDevSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-recon-123/recon',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.payload) as { reconJobId: string; status: string };
      expect(body.reconJobId).toBeDefined();
      expect(body.status).toBe('queued');
    });
  });

  describe('Task Lifecycle & Panic Button Routes (/api/v1/tasks)', () => {
    it('GET /api/v1/tasks returns 400 ACI_VALIDATION_FAILED if projectId is missing', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('ACI_VALIDATION_FAILED');
    });

    it('POST /api/v1/tasks creates a task in BACKLOG status with 201 Created', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: 'proj-phoenix',
          title: 'Implement OAuth callback handler',
          type: 'feature',
          priority: 'HIGH',
          blockedBy: [],
          writableScope: ['src/auth/'],
        },
      });

      expect(res.statusCode).toBe(201);
      const task = JSON.parse(res.payload) as {
        id: string;
        status: string;
        priority: string;
        title: string;
      };
      expect(task.id).toBeDefined();
      expect(task.status).toBe('BACKLOG');
      expect(task.priority).toBe('HIGH');
      expect(task.title).toBe('Implement OAuth callback handler');
    });

    it('POST /api/v1/tasks/:taskId/dispatch enforces dependency gating with 409 TASK_BLOCKED_BY_DEPENDENCIES', async () => {
      const session = await createSession(devSessionData);

      // Seed unmerged dependency
      seedInMemoryTask({
        id: 'task-dep-1',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Prerequisite DB migration',
        type: 'feature',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        blockedBy: [],
        writableScope: ['db/'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      // Seed dependent task
      seedInMemoryTask({
        id: 'task-main-2',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'User profile route',
        type: 'feature',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        blockedBy: ['task-dep-1'],
        writableScope: ['src/routes/'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-main-2/dispatch',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('TASK_BLOCKED_BY_DEPENDENCIES');
    });

    it('POST /api/v1/tasks/:taskId/dispatch starts container execution when dependencies are resolved', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'task-ready-1',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Standalone task',
        type: 'bug',
        status: 'BACKLOG',
        priority: 'CRITICAL',
        blockedBy: [],
        writableScope: ['src/'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-ready-1/dispatch',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as {
        taskId: string;
        status: string;
        containerId: string;
      };
      expect(body.taskId).toBe('task-ready-1');
      expect(body.status).toBe('IN_PROGRESS');
      expect(body.containerId).toContain('runner-');
    });

    it('POST /api/v1/tasks/:taskId/clarification resumes waiting task', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'task-clarify-1',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Task awaiting clarify',
        type: 'feature',
        status: 'WAITING_FOR_CLARIFICATION',
        priority: 'MEDIUM',
        blockedBy: [],
        writableScope: [],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-clarify-1/clarification',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          answers: [{ questionId: 'q1', answer: 'Use PostgreSQL jsonb' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { success: boolean; resumedStatus: string };
      expect(body.success).toBe(true);
      expect(body.resumedStatus).toBe('IN_PROGRESS');
    });

    it('POST /api/v1/tasks/:taskId/review-gate/approve denies developer role with 403 RBAC_MERGE_NOT_AUTHORIZED', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'task-review-1',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Ready for merge',
        type: 'feature',
        status: 'WAITING_FOR_REVIEW_GATE',
        priority: 'MEDIUM',
        blockedBy: [],
        writableScope: [],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-review-1/review-gate/approve',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('RBAC_MERGE_NOT_AUTHORIZED');
    });

    it('POST /api/v1/tasks/:taskId/review-gate/approve allows lead_dev to merge gate and returns PR URL', async () => {
      const session = await createSession(leadDevSessionData);

      seedInMemoryTask({
        id: 'task-review-lead',
        projectId: 'proj-phoenix',
        workspaceId: leadDevSessionData.currentWorkspaceId,
        title: 'Ready for merge',
        type: 'feature',
        status: 'WAITING_FOR_REVIEW_GATE',
        priority: 'MEDIUM',
        blockedBy: [],
        writableScope: [],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-review-lead/review-gate/approve',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { taskId: string; mergedStatus: string; prUrl: string };
      expect(body.taskId).toBe('task-review-lead');
      expect(body.mergedStatus).toBe('MERGED');
      expect(body.prUrl).toContain('pull');
    });

    it('POST /api/v1/tasks/:taskId/cancel (Panic Button) cancels active task immediately', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'task-runaway-1',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Runaway task',
        type: 'feature',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        blockedBy: [],
        writableScope: [],
        spendUsd: 5.4,
        internalReviewAttempts: 1,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-runaway-1/cancel',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { taskId: string; status: string; cancelled: boolean };
      expect(body.taskId).toBe('task-runaway-1');
      expect(body.status).toBe('CANCELLED');
      expect(body.cancelled).toBe(true);
    });

    it('blocks cross-tenant task mutation with 404 TASK_NOT_FOUND', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'task-other-tenant',
        projectId: 'proj-other',
        workspaceId: 'ws-other-999',
        title: 'Other workspace task',
        type: 'feature',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        blockedBy: [],
        writableScope: [],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/task-other-tenant/dispatch',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('TASK_NOT_FOUND');
    });

    it('POST /api/v1/tasks/:taskId/dispatch blocks concurrent execution when writableScope overlaps an active task (ADR-031)', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'TASK-ACTIVE-AUTH',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Active auth task',
        type: 'feature',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        blockedBy: [],
        writableScope: ['src/auth/**'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      seedInMemoryTask({
        id: 'TASK-CANDIDATE-AUTH',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Overlapping auth login task',
        type: 'feature',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        blockedBy: [],
        writableScope: ['src/auth/login.ts'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks/TASK-CANDIDATE-AUTH/dispatch',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload) as { code: string; details: { overlappingTaskIds: string[] } };
      expect(body.code).toBe('TASK_BLOCKED_BY_DEPENDENCIES');
      expect(body.details.overlappingTaskIds).toContain('TASK-ACTIVE-AUTH');
    });

    it('POST /api/v1/tasks rejects circular dependencies with 409 TASK_INVALID_STATE_TRANSITION', async () => {
      const session = await createSession(devSessionData);

      seedInMemoryTask({
        id: 'TASK-CYCLE-A',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Task A waiting on B',
        type: 'feature',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        blockedBy: ['TASK-CYCLE-B'],
        writableScope: ['src/a/'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      seedInMemoryTask({
        id: 'TASK-CYCLE-B',
        projectId: 'proj-phoenix',
        workspaceId: devSessionData.currentWorkspaceId,
        title: 'Task B waiting on A',
        type: 'feature',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        blockedBy: ['TASK-CYCLE-A'],
        writableScope: ['src/b/'],
        spendUsd: 0,
        internalReviewAttempts: 0,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: 'proj-phoenix',
          title: 'Task C triggering cycle validation',
          type: 'feature',
          priority: 'MEDIUM',
          blockedBy: ['TASK-CYCLE-A'],
          writableScope: ['src/c/'],
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('TASK_INVALID_STATE_TRANSITION');
    });
  });

  describe('Telemetry & WebSocket Ticket Routes (/api/v1/telemetry)', () => {
    it('POST /api/v1/telemetry/ws-ticket rejects invalid streamType with 400 ACI_VALIDATION_FAILED', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry/ws-ticket',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          streamType: 'invalid_unsupported_stream',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('ACI_VALIDATION_FAILED');
    });

    it('POST /api/v1/telemetry/ws-ticket mints 60-second single-use ticket for valid streamType', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry/ws-ticket',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          streamType: 'dag_updates',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as {
        ticket: string;
        ttlSeconds: number;
        wsUrl: string;
      };

      expect(body.ticket).toBeDefined();
      expect(body.ticket).toHaveLength(36);
      expect(body.ttlSeconds).toBe(10);
      expect(body.wsUrl).toContain('/stream?ticket=');
    });
  });
});

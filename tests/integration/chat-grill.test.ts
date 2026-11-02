import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/orchestrator/app';
import {
  createSession,
  setValkeyClient,
  InMemoryValkeyStore,
} from '../../src/orchestrator/auth/better-auth';

describe('Chat Cockpit & Socratic Grilling Mode Integration Tests (/api/v1/chat/stream, Task 12.2)', () => {
  let app: FastifyInstance;
  let valkeyStore: InMemoryValkeyStore;

  const devSessionData = {
    userId: 'usr-dev-001',
    email: 'dev@graywolf.test',
    currentWorkspaceId: '00000000-0000-4000-8000-000000000001',
    currentOrganizationId: 'org-main-999',
    role: 'developer' as const,
  };

  const leadDevSessionData = {
    userId: 'usr-lead-002',
    email: 'lead@graywolf.test',
    currentWorkspaceId: '00000000-0000-4000-8000-000000000001',
    currentOrganizationId: 'org-main-999',
    role: 'lead_dev' as const,
  };

  const viewerSessionData = {
    userId: 'usr-viewer-003',
    email: 'viewer@graywolf.test',
    currentWorkspaceId: '00000000-0000-4000-8000-000000000001',
    currentOrganizationId: 'org-main-999',
    role: 'viewer' as const,
  };

  beforeEach(() => {
    valkeyStore = new InMemoryValkeyStore();
    setValkeyClient(valkeyStore);
    app = buildApp({ logger: false });
  });

  describe('RBAC & Session Authentication', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(res.statusCode).toBe(401);
      const json = JSON.parse(res.body);
      const errorCode = json.code || json.error?.code || json.error;
      expect(errorCode).toBe('AUTH_SESSION_MISSING');
    });

    it('rejects viewer role with 403 RBAC_INSUFFICIENT_ROLE', async () => {
      const session = await createSession(viewerSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'What is the current status?' }],
        },
      });

      expect(res.statusCode).toBe(403);
      const json = JSON.parse(res.body);
      const errorCode = json.code || json.error?.code || json.error;
      expect(errorCode).toBe('RBAC_INSUFFICIENT_ROLE');
    });
  });

  describe('Vercel AI SDK Data Stream Framing & @current_file Sync', () => {
    it('streams response with Vercel AI SDK protocol headers and frames', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'Refactor auth routes' }],
          currentFile: 'src/orchestrator/routes/auth.ts',
          accessModeOverride: 'plan-gate',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['x-vercel-ai-data-stream']).toBe('v1');

      const body = res.body;
      // Should contain 2: annotation frame with context sync
      expect(body).toContain('2:');
      expect(body).toContain('src/orchestrator/routes/auth.ts');
      expect(body).toContain('plan-gate');

      // Should contain 0: assistant prose chunk
      expect(body).toContain('0:');

      // Should contain d: finish frame
      expect(body).toContain('d:');
      expect(body).toContain('"finishReason":"stop"');
    });
  });

  describe('Socratic Grilling Mode (GRILL, ADR-083)', () => {
    it('asks first probing question on initial turn in GRILL mode', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          cockpitMode: 'GRILL',
          currentFile: 'src/billing.ts',
          messages: [{ role: 'user', content: 'Implement Stripe webhook handling' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      // Check grill_state annotation
      expect(body).toContain('"type":"grill_state"');
      expect(body).toContain('"active":true');
      expect(body).toContain('"questionIndex":1');
      expect(body).toContain('"maxQuestions":5');
      expect(body).toContain('"requiresConfirmation":false');

      // Prose output should contain Question 1
      expect(body).toContain('Question 1/5:');
    });

    it('bypasses GRILL interview immediately when --skip-grill is entered in message', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          cockpitMode: 'GRILL',
          messages: [{ role: 'user', content: 'Quick hotfix for login session --skip-grill' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      expect(body).toContain('"type":"grill_state"');
      expect(body).toContain('"bypassed":true');
      expect(body).toContain('"requiresConfirmation":true');
      expect(body).toContain('# Task Brief Preview');
    });

    it('bypasses GRILL interview when skipGrill: true flag is provided', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          cockpitMode: 'GRILL',
          skipGrill: true,
          messages: [{ role: 'user', content: 'Implement new database index' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      expect(body).toContain('"bypassed":true');
      expect(body).toContain('"requiresConfirmation":true');
      expect(body).toContain('# Task Brief Preview');
    });
  });

  describe('Cockpit Tools Execution via ACI Gateway (ADR-066)', () => {
    it('executes authorized cockpit tool (create_task) and returns frames 9: and a:', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'Create task' }],
          toolCalls: [
            {
              toolCallId: 'call_create_1',
              toolName: 'create_task',
              args: {
                projectId: '00000000-0000-4000-8000-000000000001',
                title: 'Add export endpoint',
                briefMarkdown: 'Export data to CSV',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      // 9: invocation frame
      expect(body).toContain('9:{"toolCallId":"call_create_1","toolName":"create_task"');

      // a: result frame
      expect(body).toContain('a:{"toolCallId":"call_create_1","result":');
      expect(body).toContain('"authorized":true');
      expect(body).toContain('"executed":true');
    });

    it('rejects unauthorized tool call (approve_pr_merge by developer) with RBAC_COCKPIT_TOOL_FORBIDDEN', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'Merge PR' }],
          toolCalls: [
            {
              toolCallId: 'call_merge_1',
              toolName: 'approve_pr_merge',
              args: {
                taskId: 'TASK-001',
                comment: 'Developer trying to approve',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      // Frame a: should contain unauthorized result
      expect(body).toContain('"authorized":false');
      expect(body).toContain('"error":"RBAC_COCKPIT_TOOL_FORBIDDEN"');
    });

    it('allows lead_dev to execute approve_pr_merge', async () => {
      const session = await createSession(leadDevSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          projectId: '00000000-0000-4000-8000-000000000001',
          messages: [{ role: 'user', content: 'Merge PR now' }],
          toolCalls: [
            {
              toolCallId: 'call_lead_merge_1',
              toolName: 'approve_pr_merge',
              args: {
                taskId: 'TASK-001',
                comment: 'Lead approved',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.body;

      expect(body).toContain('"authorized":true');
      expect(body).toContain('"executed":true');
    });
  });
});

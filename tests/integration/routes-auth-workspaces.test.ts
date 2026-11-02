import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/orchestrator/app';
import {
  createSession,
  setValkeyClient,
  InMemoryValkeyStore,
} from '../../src/orchestrator/auth/better-auth';
import { clearInMemoryInvites } from '../../src/orchestrator/auth/invites';

describe('Control Plane Auth & Workspace Routes Integration Tests (US1)', () => {
  let app: FastifyInstance;
  let valkeyStore: InMemoryValkeyStore;

  const ownerSessionData = {
    userId: 'usr-owner-001',
    email: 'owner@graywolf.test',
    currentWorkspaceId: 'ws-alpha-111',
    currentOrganizationId: 'org-main-999',
    role: 'owner' as const,
  };

  const devSessionData = {
    userId: 'usr-dev-002',
    email: 'dev@graywolf.test',
    currentWorkspaceId: 'ws-alpha-111',
    currentOrganizationId: 'org-main-999',
    role: 'developer' as const,
  };

  beforeEach(() => {
    valkeyStore = new InMemoryValkeyStore();
    setValkeyClient(valkeyStore);
    clearInMemoryInvites();
    app = buildApp({ logger: false });
  });

  describe('GET /api/v1/auth/session', () => {
    it('returns 401 AUTH_SESSION_MISSING when no session token provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('AUTH_SESSION_MISSING');
    });

    it('returns 200 OK with session details when valid cookie is provided', async () => {
      const session = await createSession(ownerSessionData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as typeof ownerSessionData;
      expect(body.userId).toBe(ownerSessionData.userId);
      expect(body.email).toBe(ownerSessionData.email);
      expect(body.currentWorkspaceId).toBe(ownerSessionData.currentWorkspaceId);
      expect(body.role).toBe('owner');
    });

    it('returns 200 OK with session details when Bearer authorization header is provided', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: {
          authorization: `Bearer ${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as typeof devSessionData;
      expect(body.userId).toBe(devSessionData.userId);
      expect(body.role).toBe('developer');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes session immediately and returns 200 with clear-cookie', async () => {
      const session = await createSession(ownerSessionData);

      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(logoutRes.statusCode).toBe(200);
      const logoutBody = JSON.parse(logoutRes.payload) as { success: boolean };
      expect(logoutBody.success).toBe(true);

      // Verify subsequent request fails with AUTH_SESSION_EXPIRED
      const sessionRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(sessionRes.statusCode).toBe(401);
      const sessionBody = JSON.parse(sessionRes.payload) as { code: string };
      expect(sessionBody.code).toBe('AUTH_SESSION_REVOKED');
    });
  });

  describe('GET /api/v1/workspaces', () => {
    it('returns 200 OK with list of accessible workspaces for authenticated user', async () => {
      const session = await createSession(ownerSessionData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/workspaces',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const workspaces = JSON.parse(res.payload) as Array<{ id: string; role: string }>;
      expect(Array.isArray(workspaces)).toBe(true);
      expect(workspaces.length).toBeGreaterThan(0);
      expect(workspaces[0].id).toBe(ownerSessionData.currentWorkspaceId);
      expect(workspaces[0].role).toBe('owner');
    });
  });

  describe('POST /api/v1/workspaces/:workspaceId/invites', () => {
    it('denies invite creation for developer role with 403 RBAC_INSUFFICIENT_ROLE', async () => {
      const session = await createSession(devSessionData);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${devSessionData.currentWorkspaceId}/invites`,
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          targetRole: 'developer',
          expiresInHours: 72,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('RBAC_INSUFFICIENT_ROLE');
    });

    it('rejects cross-tenant invite creation with 403 RBAC_CROSS_TENANT_VIOLATION', async () => {
      const session = await createSession(ownerSessionData);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/ws-other-forbidden/invites',
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          targetRole: 'developer',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload) as { code: string };
      expect(body.code).toBe('RBAC_CROSS_TENANT_VIOLATION');
    });

    it('allows owner to generate high-entropy invite URL and parameters', async () => {
      const session = await createSession(ownerSessionData);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${ownerSessionData.currentWorkspaceId}/invites`,
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
        payload: {
          targetRole: 'developer',
          expiresInHours: 48,
          maxUses: 2,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload) as {
        inviteUrl: string;
        expiresAt: string;
        targetRole: string;
      };

      expect(body.inviteUrl).toContain('/invite/join?token=');
      expect(body.targetRole).toBe('developer');
      expect(body.expiresAt).toBeDefined();
    });
  });

  describe('POST /api/v1/invites/redeem', () => {
    it('successfully redeems an invite and returns target workspaceId and role', async () => {
      const ownerSession = await createSession(ownerSessionData);
      const newDevSession = await createSession({
        userId: 'usr-new-recruit',
        email: 'recruit@graywolf.test',
        currentWorkspaceId: 'ws-none',
        currentOrganizationId: 'org-none',
        role: 'developer',
      });

      // 1. Generate invite
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${ownerSessionData.currentWorkspaceId}/invites`,
        headers: {
          cookie: `__session=${ownerSession.sessionId}`,
        },
        payload: {
          targetRole: 'developer',
          expiresInHours: 24,
          maxUses: 1,
        },
      });

      const inviteBody = JSON.parse(inviteRes.payload) as { inviteUrl: string };
      const rawToken = new URL(inviteBody.inviteUrl).searchParams.get('token')!;
      expect(rawToken).toBeDefined();

      // 2. Redeem invite
      const redeemRes = await app.inject({
        method: 'POST',
        url: '/api/v1/invites/redeem',
        headers: {
          cookie: `__session=${newDevSession.sessionId}`,
        },
        payload: {
          token: rawToken,
        },
      });

      expect(redeemRes.statusCode).toBe(200);
      const redeemBody = JSON.parse(redeemRes.payload) as { workspaceId: string; role: string };
      expect(redeemBody.workspaceId).toBe(ownerSessionData.currentWorkspaceId);
      expect(redeemBody.role).toBe('developer');

      // 3. Second redemption fails because maxUses was 1
      const reRedeemRes = await app.inject({
        method: 'POST',
        url: '/api/v1/invites/redeem',
        headers: {
          cookie: `__session=${newDevSession.sessionId}`,
        },
        payload: {
          token: rawToken,
        },
      });

      expect(reRedeemRes.statusCode).toBe(400);
      const reRedeemBody = JSON.parse(reRedeemRes.payload) as { code: string };
      expect(reRedeemBody.code).toBe('AUTH_INVITE_EXHAUSTED');
    });
  });
});

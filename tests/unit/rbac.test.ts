import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyRequest, FastifyReply } from 'fastify';
import {
  checkPermission,
  enforcePermission,
  requirePermission,
  getRbacEnforcer,
  resetRbacEnforcer,
  RBAC_ACTIONS,
  RbacAction,
} from '../../src/orchestrator/auth/rbac';
import {
  createSession,
  setValkeyClient,
  InMemoryValkeyStore,
  SessionData,
} from '../../src/orchestrator/auth/better-auth';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Casbin RBAC Enforcer (Unit Tests)', () => {
  beforeEach(() => {
    resetRbacEnforcer();
  });

  it('initializes the Casbin enforcer from config/rbac files', async () => {
    const enforcer = await getRbacEnforcer();
    expect(enforcer).toBeDefined();
  });

  describe('Role Hierarchy & 19-Action Matrix Evaluation (76 combinations)', () => {
    const viewerActions: RbacAction[] = [
      'list_workspaces',
      'list_projects',
      'list_tasks',
      'ws_ticket_read',
    ];

    const developerDirectActions: RbacAction[] = [
      'create_task',
      'dispatch_task',
      'answer_clarification',
      'reorder_backlog',
      'chat_turn',
      'change_access_mode_pill',
    ];

    const leadDevDirectActions: RbacAction[] = [
      'create_project',
      'trigger_recon',
      'modify_blast_radius',
      'approve_review_gate',
      'create_invite',
      'promote_addon',
    ];

    const ownerDirectActions: RbacAction[] = [
      'manage_keys',
      'manage_budgets',
      'manage_team_roles',
    ];

    it('viewer role has strictly 4 permitted actions and denies all others', async () => {
      const allowedCount = [];
      const deniedCount = [];

      for (const action of RBAC_ACTIONS) {
        const allowed = await checkPermission('viewer', action);
        if (allowed) {
          allowedCount.push(action);
        } else {
          deniedCount.push(action);
        }
      }

      expect(allowedCount.sort()).toEqual(viewerActions.sort());
      expect(allowedCount).toHaveLength(4);
      expect(deniedCount).toHaveLength(15);
    });

    it('developer role inherits viewer actions and adds 6 direct actions (10 total)', async () => {
      const expected = [...viewerActions, ...developerDirectActions];
      const allowedCount = [];

      for (const action of RBAC_ACTIONS) {
        const allowed = await checkPermission('developer', action);
        if (allowed) {
          allowedCount.push(action);
        }
      }

      expect(allowedCount.sort()).toEqual(expected.sort());
      expect(allowedCount).toHaveLength(10);
    });

    it('lead_dev role inherits developer actions and adds 6 direct actions (16 total)', async () => {
      const expected = [...viewerActions, ...developerDirectActions, ...leadDevDirectActions];
      const allowedCount = [];

      for (const action of RBAC_ACTIONS) {
        const allowed = await checkPermission('lead_dev', action);
        if (allowed) {
          allowedCount.push(action);
        }
      }

      expect(allowedCount.sort()).toEqual(expected.sort());
      expect(allowedCount).toHaveLength(16);
    });

    it('owner role has all 19 platform actions permitted', async () => {
      const expected = [
        ...viewerActions,
        ...developerDirectActions,
        ...leadDevDirectActions,
        ...ownerDirectActions,
      ];
      const allowedCount = [];

      for (const action of RBAC_ACTIONS) {
        const allowed = await checkPermission('owner', action);
        if (allowed) {
          allowedCount.push(action);
        }
      }

      expect(allowedCount.sort()).toEqual(expected.sort());
      expect(allowedCount).toHaveLength(19);
    });
  });

  describe('enforcePermission ADR-042 Structured Taxonomy Codes', () => {
    it('throws RBAC_MERGE_NOT_AUTHORIZED (403) when non-lead_dev attempts approve_review_gate', async () => {
      try {
        await enforcePermission('developer', 'approve_review_gate');
        expect.unreachable('Should have thrown RBAC_MERGE_NOT_AUTHORIZED');
      } catch (err) {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('RBAC_MERGE_NOT_AUTHORIZED');
        expect(appErr.httpStatus).toBe(403);
        expect(appErr.retryable).toBe(false);
      }
    });

    it('throws RBAC_KEY_MANAGEMENT_DENIED (403) when non-owner attempts manage_keys or manage_budgets', async () => {
      for (const action of ['manage_keys', 'manage_budgets'] as RbacAction[]) {
        try {
          await enforcePermission('lead_dev', action);
          expect.unreachable(`Should have thrown for ${action}`);
        } catch (err) {
          expect(err).toBeInstanceOf(GraywolfAppError);
          const appErr = err as GraywolfAppError;
          expect(appErr.code).toBe('RBAC_KEY_MANAGEMENT_DENIED');
          expect(appErr.httpStatus).toBe(403);
        }
      }
    });

    it('throws RBAC_COCKPIT_TOOL_FORBIDDEN (403) when isCockpitTool option is true', async () => {
      try {
        await enforcePermission('viewer', 'create_task', { isCockpitTool: true });
        expect.unreachable('Should have thrown RBAC_COCKPIT_TOOL_FORBIDDEN');
      } catch (err) {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('RBAC_COCKPIT_TOOL_FORBIDDEN');
        expect(appErr.httpStatus).toBe(403);
      }
    });

    it('throws RBAC_INSUFFICIENT_ROLE (403) for generic unauthorized actions', async () => {
      try {
        await enforcePermission('viewer', 'create_task');
        expect.unreachable('Should have thrown RBAC_INSUFFICIENT_ROLE');
      } catch (err) {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('RBAC_INSUFFICIENT_ROLE');
        expect(appErr.httpStatus).toBe(403);
      }
    });

    it('resolves silently when permission is authorized', async () => {
      await expect(enforcePermission('lead_dev', 'approve_review_gate')).resolves.toBeUndefined();
      await expect(enforcePermission('owner', 'manage_keys')).resolves.toBeUndefined();
      await expect(enforcePermission('developer', 'create_task')).resolves.toBeUndefined();
      await expect(enforcePermission('viewer', 'list_tasks')).resolves.toBeUndefined();
    });
  });

  describe('requirePermission Fastify Hook Guard', () => {
    let memoryStore: InMemoryValkeyStore;

    beforeEach(() => {
      memoryStore = new InMemoryValkeyStore();
      setValkeyClient(memoryStore);
    });

    it('authenticates user and executes guard successfully for authorized role', async () => {
      const session = await createSession({
        userId: '11111111-1111-1111-1111-111111111111',
        email: 'dev@graywolf.local',
        currentWorkspaceId: '22222222-2222-2222-2222-222222222222',
        currentOrganizationId: '33333333-3333-3333-3333-333333333333',
        role: 'developer',
      });

      const guard = requirePermission('create_task');
      const req: Partial<FastifyRequest> = {
        headers: {
          'x-session-id': session.sessionId,
        },
      };

      await expect(guard(req as FastifyRequest, {} as FastifyReply)).resolves.toBeUndefined();
      const authenticatedReq = req as FastifyRequest & {
        user?: SessionData;
        tenantContext?: { workspaceId: string; orgId: string };
      };
      expect(authenticatedReq.user).toEqual(session);
      expect(authenticatedReq.tenantContext).toEqual({
        workspaceId: session.currentWorkspaceId,
        orgId: session.currentOrganizationId,
      });
    });

    it('blocks request with RBAC_INSUFFICIENT_ROLE when session role is not authorized', async () => {
      const session = await createSession({
        userId: '11111111-1111-1111-1111-111111111111',
        email: 'viewer@graywolf.local',
        currentWorkspaceId: '22222222-2222-2222-2222-222222222222',
        currentOrganizationId: '33333333-3333-3333-3333-333333333333',
        role: 'viewer',
      });

      const guard = requirePermission('create_task');
      const req: Partial<FastifyRequest> = {
        headers: {
          cookie: `__session=${session.sessionId}`,
        },
      };

      await expect(guard(req as FastifyRequest, {} as FastifyReply)).rejects.toMatchObject({
        code: 'RBAC_INSUFFICIENT_ROLE',
        httpStatus: 403,
      });
    });

    it('blocks request with AUTH_SESSION_MISSING when no session token is provided', async () => {
      const guard = requirePermission('list_tasks');
      const req: Partial<FastifyRequest> = {
        headers: {},
      };

      await expect(guard(req as FastifyRequest, {} as FastifyReply)).rejects.toMatchObject({
        code: 'AUTH_SESSION_MISSING',
        httpStatus: 401,
      });
    });
  });
});

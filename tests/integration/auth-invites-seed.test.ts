import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSession,
  verifySession,
  revokeSession,
  revokeUserSessions,
  setValkeyClient,
  InMemoryValkeyStore,
  SessionData,
} from '../../src/orchestrator/auth/better-auth';
import {
  seedSoloWorkspaceIfEmpty,
} from '../../src/orchestrator/auth/solo-seed';
import {
  createWorkspaceInvite,
  redeemWorkspaceInvite,
  hashInviteToken,
} from '../../src/orchestrator/auth/invites';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Auth, Invites & Solo Seed Integration Tests', () => {
  let memoryStore: InMemoryValkeyStore;

  beforeEach(() => {
    memoryStore = new InMemoryValkeyStore();
    setValkeyClient(memoryStore);
  });

  describe('Zero-Config Solo Mode Seeder (Task 2.1)', () => {
    it('seeds default personal organization, workspace, and owner user when empty', async () => {
      const insertedRows: Record<string, unknown[]> = {
        organizations: [],
        workspaces: [],
        users: [],
        workspace_members: [],
      };

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql.includes('COUNT(*)')) {
            return { rows: [{ count: insertedRows.organizations.length }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO organizations')) {
            const org = { id: 'org-111', slug: params![0] as string, name: params![1] as string };
            insertedRows.organizations.push(org);
            return { rows: [{ id: org.id }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO workspaces')) {
            const ws = { id: 'ws-222', org_id: params![0] as string, name: params![1] as string, slug: params![2] as string };
            insertedRows.workspaces.push(ws);
            return { rows: [{ id: ws.id }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO users')) {
            const user = { id: 'usr-333', email: params![0] as string, full_name: params![1] as string };
            insertedRows.users.push(user);
            return { rows: [{ id: user.id }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO workspace_members')) {
            const member = { workspace_id: params![0] as string, user_id: params![1] as string, role: params![2] as string };
            insertedRows.workspace_members.push(member);
            return { rows: [member], rowCount: 1 };
          }
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      const result = await seedSoloWorkspaceIfEmpty(mockDb as unknown as import('pg').Pool);

      expect(result.seeded).toBe(true);
      expect(result.organizationId).toBe('org-111');
      expect(result.workspaceId).toBe('ws-222');
      expect(result.userId).toBe('usr-333');
      expect(result.role).toBe('owner');
      expect(
        (insertedRows.workspace_members[0] as { role: string }).role
      ).toBe('owner');
    });

    it('skips seeding idempotently when organizations already exist', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({
          rows: [{ count: 1 }],
          rowCount: 1,
        }),
      };

      const result = await seedSoloWorkspaceIfEmpty(mockDb as unknown as import('pg').Pool);
      expect(result.seeded).toBe(false);
      expect(result.message).toContain('already exist');
    });
  });

  describe('Better-Auth Stateful Sessions & Instant Revocation (Task 2.1)', () => {
    it('creates, verifies from Valkey, and instantly revokes user sessions', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const wsId = '22222222-2222-2222-2222-222222222222';
      const orgId = '33333333-3333-3333-3333-333333333333';

      // 1. Create session
      const session = await createSession({
        userId,
        email: 'developer@graywolf.local',
        currentWorkspaceId: wsId,
        currentOrganizationId: orgId,
        role: 'developer',
      });

      expect(session.sessionId).toBeDefined();

      // 2. Verify active session
      const verified = await verifySession(session.sessionId);
      expect(verified.userId).toBe(userId);
      expect(verified.role).toBe('developer');

      // 3. Revoke all user sessions
      const count = await revokeUserSessions(userId);
      expect(count).toBeGreaterThanOrEqual(1);

      // 4. Verification must now throw AUTH_SESSION_REVOKED (401)
      try {
        await verifySession(session.sessionId);
        expect.unreachable('Expected AUTH_SESSION_REVOKED error');
      } catch (err) {
        expect(err).toBeInstanceOf(GraywolfAppError);
        const appErr = err as GraywolfAppError;
        expect(appErr.code).toBe('AUTH_SESSION_REVOKED');
        expect(appErr.httpStatus).toBe(401);
      }
    });

    it('revokes a single session explicitly via revokeSession', async () => {
      const session = await createSession({
        userId: 'u_single',
        email: 'single@graywolf.local',
        currentWorkspaceId: 'ws_single',
        currentOrganizationId: 'org_single',
        role: 'viewer',
      });

      await revokeSession(session.sessionId);

      await expect(verifySession(session.sessionId)).rejects.toMatchObject({
        code: 'AUTH_SESSION_REVOKED',
        httpStatus: 401,
      });
    });

    it('throws AUTH_SESSION_MISSING on empty session tokens', async () => {
      await expect(verifySession('')).rejects.toMatchObject({
        code: 'AUTH_SESSION_MISSING',
        httpStatus: 401,
      });
      await expect(verifySession(undefined)).rejects.toMatchObject({
        code: 'AUTH_SESSION_MISSING',
        httpStatus: 401,
      });
    });

    it('throws AUTH_SESSION_EXPIRED on expired sessions', async () => {
      const expiredSession: SessionData = {
        sessionId: 'expired-session-id',
        userId: 'u_exp',
        email: 'exp@graywolf.local',
        currentWorkspaceId: 'ws_exp',
        currentOrganizationId: 'org_exp',
        role: 'developer',
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      };

      await memoryStore.set(
        `session:${expiredSession.sessionId}`,
        JSON.stringify(expiredSession)
      );

      await expect(verifySession(expiredSession.sessionId)).rejects.toMatchObject({
        code: 'AUTH_SESSION_EXPIRED',
        httpStatus: 401,
      });
    });

    it('falls back to PostgreSQL on Valkey cache miss and repopulates Valkey cache', async () => {
      const dbModule = await import('../../src/orchestrator/db');
      const querySpy = vi.spyOn(dbModule.pool, 'query').mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'db-fallback-session',
            user_id: 'u_db',
            workspace_id: 'ws_db',
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            revoked_at: null,
            email: 'db@graywolf.local',
            role: 'lead_dev',
            org_id: 'org_db',
          },
        ],
      } as never);

      const verified = await verifySession('db-fallback-session');
      expect(verified.userId).toBe('u_db');
      expect(verified.currentOrganizationId).toBe('org_db');
      expect(verified.role).toBe('lead_dev');

      const cached = await memoryStore.get('session:db-fallback-session');
      expect(cached).toBeTruthy();

      querySpy.mockRestore();
    });
  });

  describe('Cryptographic Team Workspace Invites (Task 2.2)', () => {
    interface MockInvite {
      id: string;
      workspace_id: string;
      invited_by: string;
      token_hash: string;
      target_role: string;
      max_uses: number;
      uses_count: number;
      expires_at: string;
    }
    interface MockMember {
      workspace_id: string;
      user_id: string;
      role: string;
    }

    const invitesDb: Record<string, MockInvite> = {};
    const membersDb: MockMember[] = [];

    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO workspace_invites')) {
          const invite: MockInvite = {
            id: 'inv-uuid-1',
            workspace_id: params![0] as string,
            invited_by: params![1] as string,
            token_hash: params![2] as string,
            target_role: params![3] as string,
            max_uses: params![4] as number,
            uses_count: 0,
            expires_at: params![5] as string,
          };
          invitesDb[invite.token_hash] = invite;
          return { rows: [{ id: invite.id }], rowCount: 1 };
        }
        if (sql.includes('SELECT id, workspace_id, target_role, max_uses, uses_count, expires_at')) {
          const hash = params![0] as string;
          const invite = invitesDb[hash];
          return { rows: invite ? [invite] : [], rowCount: invite ? 1 : 0 };
        }
        if (sql.includes('UPDATE workspace_invites')) {
          const usesCount = params![0] as number;
          const id = params![1] as string;
          const invite = Object.values(invitesDb).find((i) => i.id === id);
          if (invite) invite.uses_count = usesCount;
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workspace_members')) {
          membersDb.push({
            workspace_id: params![0] as string,
            user_id: params![1] as string,
            role: params![2] as string,
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const mockClient = mockDb as unknown as import('pg').PoolClient;

    it('creates invite storing only SHA-256 hash in DB and returning raw token', async () => {
      const created = await createWorkspaceInvite(
        {
          workspaceId: 'ws-777',
          invitedBy: 'usr-admin',
          targetRole: 'developer',
          maxUses: 2,
          expiresInHours: 48,
        },
        mockClient
      );

      expect(created.inviteId).toBe('inv-uuid-1');
      expect(created.rawToken).toHaveLength(64); // 32 bytes hex
      expect(created.tokenHash).toBe(hashInviteToken(created.rawToken));
      expect(created.inviteUrl).toContain(created.rawToken);
      expect(invitesDb[created.tokenHash]).toBeDefined();
    });

    it('redeems a valid invite and increments uses_count', async () => {
      const created = await createWorkspaceInvite(
        {
          workspaceId: 'ws-777',
          invitedBy: 'usr-admin',
          targetRole: 'developer',
          maxUses: 2,
        },
        mockClient
      );

      const redeemed = await redeemWorkspaceInvite(
        {
          rawToken: created.rawToken,
          userId: 'usr-new-member',
        },
        mockClient
      );

      expect(redeemed.workspaceId).toBe('ws-777');
      expect(redeemed.userId).toBe('usr-new-member');
      expect(redeemed.role).toBe('developer');
      expect(redeemed.usesCount).toBe(1);
    });

    it('rejects an invalid invite token with AUTH_INVITE_INVALID', async () => {
      await expect(
        redeemWorkspaceInvite({ rawToken: 'bad_token_123', userId: 'u1' }, mockClient)
      ).rejects.toMatchObject({
        code: 'AUTH_INVITE_INVALID',
        httpStatus: 400,
      });
    });

    it('rejects an expired invite token with AUTH_INVITE_EXPIRED', async () => {
      const expiredInvite = {
        id: 'inv-expired',
        workspace_id: 'ws-exp',
        invited_by: 'usr-admin',
        token_hash: hashInviteToken('expired_raw_token'),
        target_role: 'viewer',
        max_uses: 5,
        uses_count: 0,
        expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
      };
      invitesDb[expiredInvite.token_hash] = expiredInvite;

      await expect(
        redeemWorkspaceInvite({ rawToken: 'expired_raw_token', userId: 'u2' }, mockClient)
      ).rejects.toMatchObject({
        code: 'AUTH_INVITE_EXPIRED',
        httpStatus: 400,
      });
    });

    it('rejects an exhausted invite token with AUTH_INVITE_EXHAUSTED', async () => {
      const exhaustedInvite = {
        id: 'inv-exhausted',
        workspace_id: 'ws-exh',
        invited_by: 'usr-admin',
        token_hash: hashInviteToken('exhausted_raw_token'),
        target_role: 'developer',
        max_uses: 1,
        uses_count: 1, // Already reached max
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
      invitesDb[exhaustedInvite.token_hash] = exhaustedInvite;

      await expect(
        redeemWorkspaceInvite({ rawToken: 'exhausted_raw_token', userId: 'u3' }, mockClient)
      ).rejects.toMatchObject({
        code: 'AUTH_INVITE_EXHAUSTED',
        httpStatus: 400,
      });
    });

    it('prevents creating invites for owner or lead_dev roles via public link', async () => {
      await expect(
        createWorkspaceInvite(
          {
            workspaceId: 'ws-1',
            invitedBy: 'usr-admin',
            targetRole: 'owner' as unknown as 'developer',
          },
          mockClient
        )
      ).rejects.toMatchObject({
        code: 'RBAC_INSUFFICIENT_ROLE',
        httpStatus: 403,
      });
    });
  });
});

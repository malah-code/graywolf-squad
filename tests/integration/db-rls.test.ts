import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool, PoolClient, QueryResult } from 'pg';
import * as dbModule from '../../src/orchestrator/db/index';
import { withTenantContext } from '../../src/orchestrator/db/index';
import { env } from '../../src/orchestrator/config/env';

describe('Tenant Context & Database RLS Integration', () => {
  let isDbReachable = false;
  let testPool: Pool;

  beforeAll(async () => {
    testPool = new Pool({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 1000,
    });

    try {
      const client = await testPool.connect();
      client.release();
      isDbReachable = true;
    } catch {
      isDbReachable = false;
    }
  });

  afterAll(async () => {
    await testPool.end();
  });

  describe('withTenantContext helper behavior', () => {
    it('sets transaction and tenant parameters, commits on success, and releases client', async () => {
      const queries: { sql: string; params?: unknown[] }[] = [];
      let released = false;

      const mockClient = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          return { rows: [], rowCount: 0 } as unknown as QueryResult;
        }),
        release: vi.fn(() => {
          released = true;
        }),
      } as unknown as PoolClient;

      const connectSpy = vi
        .spyOn(dbModule.pool, 'connect')
        .mockResolvedValueOnce(mockClient as never);

      let executedInside = false;
      const result = await withTenantContext(
        { workspaceId: 'ws-123', orgId: 'org-456' },
        async (client) => {
          executedInside = true;
          await client.query('SELECT 1');
          return 'success';
        }
      );

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(executedInside).toBe(true);
      expect(result).toBe('success');
      expect(released).toBe(true);
      expect(queries[0].sql).toBe('BEGIN');
      expect(queries[1].sql).toContain("set_config('app.current_workspace_id', $1, true)");
      expect(queries[1].sql).toContain("set_config('app.current_org_id', $2, true)");
      expect(queries[1].params).toEqual(['ws-123', 'org-456']);
      expect(queries[2].sql).toBe('SELECT 1');
      expect(queries[3].sql).toBe('COMMIT');

      connectSpy.mockRestore();
    });

    it('defaults orgId to empty string when omitted', async () => {
      const queries: { sql: string; params?: unknown[] }[] = [];

      const mockClient = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          return { rows: [], rowCount: 0 } as unknown as QueryResult;
        }),
        release: vi.fn(),
      } as unknown as PoolClient;

      const connectSpy = vi
        .spyOn(dbModule.pool, 'connect')
        .mockResolvedValueOnce(mockClient as never);

      await withTenantContext({ workspaceId: 'ws-only' }, async () => 'ok');

      expect(queries[1].params).toEqual(['ws-only', '']);
      connectSpy.mockRestore();
    });

    it('rolls back transaction on exception and always releases client', async () => {
      const queries: { sql: string }[] = [];
      let released = false;

      const mockClient = {
        query: vi.fn(async (sql: string) => {
          queries.push({ sql });
          return { rows: [], rowCount: 0 } as unknown as QueryResult;
        }),
        release: vi.fn(() => {
          released = true;
        }),
      } as unknown as PoolClient;

      const connectSpy = vi
        .spyOn(dbModule.pool, 'connect')
        .mockResolvedValueOnce(mockClient as never);

      await expect(
        withTenantContext({ workspaceId: 'ws-123', orgId: 'org-456' }, async (client) => {
          await client.query('INSERT INTO fail');
          throw new Error('Simulation failed');
        })
      ).rejects.toThrow('Simulation failed');

      expect(released).toBe(true);
      expect(queries.map((q) => q.sql)).toEqual([
        'BEGIN',
        "SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_org_id', $2, true)",
        'INSERT INTO fail',
        'ROLLBACK',
      ]);

      connectSpy.mockRestore();
    });
  });

  describe('Live PostgreSQL RLS Isolation (Live DB Suite)', () => {
    it.skipIf(!isDbReachable)(
      'physically isolates cross-tenant rows, enforces org-wide lesson visibility, and fails closed without context',
      async () => {
        const org1Id = '00000000-0000-0000-0000-000000000001';
        const org2Id = '00000000-0000-0000-0000-000000000002';
        const wsA1Id = '00000000-0000-0000-0000-000000000011';
        const wsA2Id = '00000000-0000-0000-0000-000000000012';
        const wsB1Id = '00000000-0000-0000-0000-000000000022';
        const projA1Id = '00000000-0000-0000-0000-000000000101';
        const lessonOrgWideId = '00000000-0000-0000-0000-000000000201';
        const lessonPrivateId = '00000000-0000-0000-0000-000000000202';

        // Ensure a non-superuser role exists to enforce FORCE ROW LEVEL SECURITY
        const setupClient = await testPool.connect();
        try {
          await setupClient.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'graywolf_rls_tester') THEN
                CREATE ROLE graywolf_rls_tester NOLOGIN NOBYPASSRLS NOSUPERUSER;
              END IF;
            END
            $$;
            GRANT USAGE ON SCHEMA public TO graywolf_rls_tester;
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO graywolf_rls_tester;
          `);
        } finally {
          setupClient.release();
        }

        // Seed data in Workspace A1 (Org 1)
        await withTenantContext({ workspaceId: wsA1Id, orgId: org1Id }, async (client) => {
          await client.query(
            `INSERT INTO organizations (id, slug, name) VALUES ($1, 'org-1', 'Org 1'), ($2, 'org-2', 'Org 2') ON CONFLICT DO NOTHING`,
            [org1Id, org2Id]
          );
          await client.query(
            `INSERT INTO workspaces (id, org_id, name, slug) VALUES
              ($1, $4, 'WS A1', 'ws-a1'),
              ($2, $4, 'WS A2', 'ws-a2'),
              ($3, $5, 'WS B1', 'ws-b1')
             ON CONFLICT DO NOTHING`,
            [wsA1Id, wsA2Id, wsB1Id, org1Id, org2Id]
          );
          await client.query(
            `INSERT INTO projects (id, workspace_id, name, slug, git_remote_url) VALUES ($1, $2, 'Proj A1', 'proj-a1', 'git@github.com:acme/a1.git') ON CONFLICT DO NOTHING`,
            [projA1Id, wsA1Id]
          );
          await client.query('SET LOCAL ROLE graywolf_rls_tester');
          await client.query(
            `INSERT INTO tasks (id, project_id, workspace_id, title, type, status) VALUES ('TASK-101', $1, $2, 'Task A1', 'feature', 'BACKLOG') ON CONFLICT DO NOTHING`,
            [projA1Id, wsA1Id]
          );
          await client.query(
            `INSERT INTO project_lessons (id, org_id, workspace_id, project_id, is_org_wide, provenance, confidence_score, category, trigger_scope, summary, rule_content)
             VALUES
              ($1, $3, $4, $5, true, 'human_correction', 0.95, 'convention', ARRAY['*.ts'], 'Org-wide rule', 'Always use TypeBox'),
              ($2, $3, $4, $5, false, 'human_correction', 0.90, 'convention', ARRAY['*.ts'], 'Workspace-private rule', 'Private WS A1 rule')
             ON CONFLICT DO NOTHING`,
            [lessonOrgWideId, lessonPrivateId, org1Id, wsA1Id, projA1Id]
          );
        });

        // 1. Workspace B1 (Org 2) sees 0 tasks and 0 lessons from Org 1 / WS A1
        await withTenantContext({ workspaceId: wsB1Id, orgId: org2Id }, async (client) => {
          await client.query('SET LOCAL ROLE graywolf_rls_tester');
          const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1', ['TASK-101']);
          expect(taskRes.rowCount).toBe(0);

          const updateRes = await client.query(
            "UPDATE tasks SET status = 'CANCELLED' WHERE id = $1",
            ['TASK-101']
          );
          expect(updateRes.rowCount).toBe(0);

          const lessonRes = await client.query('SELECT * FROM project_lessons');
          expect(lessonRes.rowCount).toBe(0);
        });

        // 2. Workspace A2 (same Org 1) sees the org-wide lesson, but NOT the private WS A1 lesson
        await withTenantContext({ workspaceId: wsA2Id, orgId: org1Id }, async (client) => {
          await client.query('SET LOCAL ROLE graywolf_rls_tester');
          const lessonRes = await client.query('SELECT id, is_org_wide FROM project_lessons');
          expect(lessonRes.rowCount).toBe(1);
          expect(lessonRes.rows[0].id).toBe(lessonOrgWideId);
        });

        // 3. Unset tenant context fails closed (returns 0 rows, does not throw UUID cast syntax error)
        const rawClient = await testPool.connect();
        try {
          await rawClient.query('BEGIN');
          await rawClient.query('SET LOCAL ROLE graywolf_rls_tester');
          const noCtxRes = await rawClient.query('SELECT * FROM tasks');
          expect(noCtxRes.rowCount).toBe(0);
          await rawClient.query('ROLLBACK');
        } finally {
          rawClient.release();
        }
      }
    );
  });
});

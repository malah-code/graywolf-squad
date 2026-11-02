import { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { pool as defaultPool } from '../db';
import { WorkspaceRole } from './better-auth';

const logger = pino({ name: 'auth:solo-seed' });

export interface SoloSeedResult {
  seeded: boolean;
  organizationId?: string;
  workspaceId?: string;
  userId?: string;
  role?: WorkspaceRole;
  message?: string;
}

export interface SoloSeedOptions {
  orgSlug?: string;
  orgName?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  adminEmail?: string;
  adminName?: string;
}

/**
 * Checks if organizations table is empty on startup.
 * If empty, automatically seeds a default personal organization, default workspace,
 * and local owner admin user (PRD §11.2 Zero-Config Solo Mode).
 *
 * Safe and idempotent: returns seeded: false if organizations already exist or on concurrent seed.
 */
export async function seedSoloWorkspaceIfEmpty(
  db: Pool | PoolClient = defaultPool,
  options: SoloSeedOptions = {}
): Promise<SoloSeedResult> {
  const orgSlug = options.orgSlug ?? 'personal';
  const orgName = options.orgName ?? 'Personal Organization';
  const wsSlug = options.workspaceSlug ?? 'default';
  const wsName = options.workspaceName ?? 'Default Workspace';
  const adminEmail = options.adminEmail ?? 'admin@graywolf.local';
  const adminName = options.adminName ?? 'Solo Owner';

  // Fast check: count existing organizations
  const countRes = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM organizations'
  );
  if (countRes.rows[0]?.count > 0) {
    logger.debug('Zero-Config Solo Mode check: organizations exist, skipping seed');
    return {
      seeded: false,
      message: 'Organizations already exist; solo seed skipped',
    };
  }

  // Obtain client for atomic transaction if pool passed
  const isPool = 'connect' in db && typeof (db as Pool).connect === 'function';
  const client: PoolClient = isPool ? await (db as Pool).connect() : (db as PoolClient);

  try {
    await client.query('BEGIN');

    // Re-check inside transaction with FOR UPDATE (or repeat count check)
    const txCountRes = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM organizations'
    );
    if (txCountRes.rows[0]?.count > 0) {
      await client.query('ROLLBACK');
      return {
        seeded: false,
        message: 'Organizations created concurrently; solo seed skipped',
      };
    }

    // 1. Insert Personal Organization
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, plan_tier, mode)
       VALUES ($1, $2, 'community', 'personal')
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [orgSlug, orgName]
    );
    const orgId = orgRes.rows[0].id;

    // 2. Insert Default Workspace
    const wsRes = await client.query<{ id: string }>(
      `INSERT INTO workspaces (org_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [orgId, wsName, wsSlug]
    );
    const wsId = wsRes.rows[0].id;

    // 3. Insert Local Owner Admin User
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [adminEmail, adminName]
    );
    const userId = userRes.rows[0].id;

    // 4. Insert Workspace Member with 'owner' role
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [wsId, userId, 'owner']
    );

    await client.query('COMMIT');

    logger.info(
      { orgId, wsId, userId, email: adminEmail },
      'Zero-Config Solo Mode seeded successfully'
    );

    return {
      seeded: true,
      organizationId: orgId,
      workspaceId: wsId,
      userId,
      role: 'owner',
      message: 'Zero-Config Solo Mode seeded successfully',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Error during Zero-Config Solo Mode seeding');
    throw err;
  } finally {
    if (isPool) {
      client.release();
    }
  }
}

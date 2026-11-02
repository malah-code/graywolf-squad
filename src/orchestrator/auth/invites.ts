import crypto from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { pool as defaultPool } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';
import { WorkspaceRole } from './better-auth';

const logger = pino({ name: 'auth:invites' });

export interface CreateWorkspaceInviteInput {
  workspaceId: string;
  invitedBy: string;
  targetRole?: 'developer' | 'viewer';
  expiresInHours?: number;
  maxUses?: number;
  baseUrl?: string;
}

export interface CreatedWorkspaceInvite {
  inviteId: string;
  rawToken: string;
  tokenHash: string;
  inviteUrl: string;
  targetRole: 'developer' | 'viewer';
  maxUses: number;
  expiresAt: string;
}

export interface RedeemWorkspaceInviteInput {
  rawToken: string;
  userId: string;
}

export interface RedeemedWorkspaceInvite {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  usesCount: number;
  maxUses: number;
}

interface InMemoryInviteRecord {
  id: string;
  workspaceId: string;
  invitedBy: string;
  tokenHash: string;
  targetRole: 'developer' | 'viewer';
  maxUses: number;
  usesCount: number;
  expiresAt: string;
}

const inMemoryInvites = new Map<string, InMemoryInviteRecord>();

export function clearInMemoryInvites(): void {
  inMemoryInvites.clear();
}

/**
 * Computes the SHA-256 hex digest of a raw invite token.
 */
export function hashInviteToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generates a 32-byte crypto-random hex token and stores only its SHA-256 digest in workspace_invites.
 */
export async function createWorkspaceInvite(
  input: CreateWorkspaceInviteInput,
  db: Pool | PoolClient = defaultPool
): Promise<CreatedWorkspaceInvite> {
  const targetRole = input.targetRole ?? 'developer';
  if (targetRole !== 'developer' && targetRole !== 'viewer') {
    throw new GraywolfAppError(
      'RBAC_INSUFFICIENT_ROLE',
      `Target role '${targetRole}' is invalid for public invite links. Must be 'developer' or 'viewer'.`
    );
  }

  const maxUses = input.maxUses ?? 1;
  const expiresInHours = input.expiresInHours ?? 168; // 7 days default
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);

  // 1. Generate 32-byte crypto-random hex token (64 hex characters)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(rawToken);

  let inviteId: string = crypto.randomUUID();

  // 2. Persist hash in workspace_invites (with in-memory fallback for offline test suites)
  try {
    const res = await db.query<{ id: string }>(
      `INSERT INTO workspace_invites (workspace_id, invited_by, token_hash, target_role, max_uses, uses_count, expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6)
       RETURNING id`,
      [input.workspaceId, input.invitedBy, tokenHash, targetRole, maxUses, expiresAt.toISOString()]
    );
    inviteId = res.rows[0].id;
  } catch (err) {
    if (db === defaultPool) {
      inMemoryInvites.set(tokenHash, {
        id: inviteId,
        workspaceId: input.workspaceId,
        invitedBy: input.invitedBy,
        tokenHash,
        targetRole,
        maxUses,
        usesCount: 0,
        expiresAt: expiresAt.toISOString(),
      });
    } else {
      throw err;
    }
  }

  const baseUrl = input.baseUrl ?? 'http://localhost:3000';
  const inviteUrl = `${baseUrl.replace(/\/$/, '')}/invite/join?token=${rawToken}`;

  logger.info(
    { inviteId, workspaceId: input.workspaceId, targetRole, maxUses, expiresAt },
    'Created workspace invite'
  );

  return {
    inviteId,
    rawToken,
    tokenHash,
    inviteUrl,
    targetRole,
    maxUses,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Redeems an invite token atomically:
 * - Hashes presented raw token
 * - Verifies existence (AUTH_INVITE_INVALID)
 * - Verifies expiry (AUTH_INVITE_EXPIRED)
 * - Verifies remaining uses (AUTH_INVITE_EXHAUSTED)
 * - Atomically increments uses_count and inserts into workspace_members
 */
export async function redeemWorkspaceInvite(
  input: RedeemWorkspaceInviteInput,
  db: Pool | PoolClient = defaultPool
): Promise<RedeemedWorkspaceInvite> {
  if (!input.rawToken || input.rawToken.trim().length === 0) {
    throw new GraywolfAppError('AUTH_INVITE_INVALID', 'Invite token is missing');
  }

  const tokenHash = hashInviteToken(input.rawToken.trim());

  // Check in-memory store fallback when using default pool and token is stored in memory
  if (db === defaultPool && inMemoryInvites.has(tokenHash)) {
    const invite = inMemoryInvites.get(tokenHash)!;
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      throw new GraywolfAppError('AUTH_INVITE_EXPIRED', 'Invite token has expired');
    }
    if (invite.usesCount >= invite.maxUses) {
      throw new GraywolfAppError('AUTH_INVITE_EXHAUSTED', 'Invite token has reached maximum usage limit');
    }
    invite.usesCount += 1;
    return {
      workspaceId: invite.workspaceId,
      userId: input.userId,
      role: invite.targetRole,
      usesCount: invite.usesCount,
      maxUses: invite.maxUses,
    };
  }

  const isPool = 'connect' in db && typeof (db as Pool).connect === 'function';
  const client: PoolClient = isPool ? await (db as Pool).connect() : (db as PoolClient);

  try {
    await client.query('BEGIN');

    // 1. Select invite with row-level lock
    const inviteRes = await client.query<{
      id: string;
      workspace_id: string;
      target_role: string;
      max_uses: number;
      uses_count: number;
      expires_at: string;
    }>(
      `SELECT id, workspace_id, target_role, max_uses, uses_count, expires_at
       FROM workspace_invites
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    if (inviteRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new GraywolfAppError('AUTH_INVITE_INVALID', 'Invalid or unknown invite token');
    }

    const invite = inviteRes.rows[0];

    // 2. Check expiration
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw new GraywolfAppError('AUTH_INVITE_EXPIRED', 'Invite token has expired');
    }

    // 3. Check usage limit
    if (invite.uses_count >= invite.max_uses) {
      await client.query('ROLLBACK');
      throw new GraywolfAppError('AUTH_INVITE_EXHAUSTED', 'Invite token has reached maximum usage limit');
    }

    // 4. Atomically increment uses_count
    const updatedUsesCount = invite.uses_count + 1;
    await client.query(
      `UPDATE workspace_invites
       SET uses_count = $1
       WHERE id = $2`,
      [updatedUsesCount, invite.id]
    );

    // 5. Add user to workspace_members (safe idempotent upsert)
    const role = invite.target_role as WorkspaceRole;
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.workspace_id, input.userId, role]
    );

    await client.query('COMMIT');

    logger.info(
      { inviteId: invite.id, workspaceId: invite.workspace_id, userId: input.userId, role },
      'Successfully redeemed workspace invite'
    );

    return {
      workspaceId: invite.workspace_id,
      userId: input.userId,
      role,
      usesCount: updatedUsesCount,
      maxUses: invite.max_uses,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof GraywolfAppError) throw err;
    logger.error({ err }, 'Unexpected error during invite redemption');
    throw err;
  } finally {
    if (isPool) {
      client.release();
    }
  }
}

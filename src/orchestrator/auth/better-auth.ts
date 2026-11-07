import crypto from 'node:crypto';
import Redis from 'ioredis';
import pino from 'pino';
import { env } from '../config/env';
import { pool } from '../db';
import { GraywolfAppError } from '../errors/taxonomy';

const logger = pino({ name: 'auth:better-auth' });

export type WorkspaceRole = 'owner' | 'lead_dev' | 'developer' | 'viewer';

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  currentWorkspaceId: string;
  currentOrganizationId: string;
  role: WorkspaceRole;
  expiresAt: string;
}

export interface CreateSessionInput {
  sessionId?: string;
  userId: string;
  email: string;
  currentWorkspaceId: string;
  currentOrganizationId: string;
  role: WorkspaceRole;
  ttlSeconds?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface ValkeyStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(key: string): Promise<number>;
  getdel(key: string): Promise<string | null>;
}

export class InMemoryValkeyStore implements ValkeyStoreLike {
  private kv = new Map<string, { value: string; expiresAt?: number }>();
  private sets = new Map<string, Set<string>>();

  private isExpired(expiresAt?: number): boolean {
    return typeof expiresAt === 'number' && expiresAt <= Date.now();
  }

  private cleanKey(key: string): void {
    const entry = this.kv.get(key);
    if (entry && this.isExpired(entry.expiresAt)) {
      this.kv.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.cleanKey(key);
    const entry = this.kv.get(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null> {
    let expiresAt: number | undefined;
    if (mode === 'EX' && typeof duration === 'number') {
      expiresAt = Date.now() + duration * 1000;
    } else if (mode === 'PX' && typeof duration === 'number') {
      expiresAt = Date.now() + duration;
    }
    this.kv.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) count++;
      if (this.sets.delete(k)) count++;
    }
    return count;
  }

  async smembers(key: string): Promise<string[]> {
    const s = this.sets.get(key);
    return s ? Array.from(s) : [];
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set<string>();
      this.sets.set(key, s);
    }
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.kv.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async exists(key: string): Promise<number> {
    this.cleanKey(key);
    return this.kv.has(key) || this.sets.has(key) ? 1 : 0;
  }

  async getdel(key: string): Promise<string | null> {
    this.cleanKey(key);
    const entry = this.kv.get(key);
    if (!entry) return null;
    this.kv.delete(key);
    return entry.value;
  }

  clear(): void {
    this.kv.clear();
    this.sets.clear();
  }
}

class IORedisValkeyStoreAdapter implements ValkeyStoreLike {
  constructor(private client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null> {
    if (mode === 'EX' && typeof duration === 'number') {
      return this.client.set(key, value, 'EX', duration);
    }
    if (mode === 'PX' && typeof duration === 'number') {
      return this.client.set(key, value, 'PX', duration);
    }
    return this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async getdel(key: string): Promise<string | null> {
    // Redis 6.2+ / Valkey supports GETDEL directly
    try {
      const result = await (this.client as unknown as { getdel(k: string): Promise<string | null> }).getdel(key);
      return result;
    } catch {
      // Fallback via Lua script for atomic get-and-delete
      const luaScript = `
        local val = redis.call('GET', KEYS[1])
        if val then
          redis.call('DEL', KEYS[1])
        end
        return val
      `;
      const res = await this.client.eval(luaScript, 1, key);
      return (res as string) ?? null;
    }
  }
}

let customValkeyStore: ValkeyStoreLike | null = null;
let defaultValkeyClient: Redis | null = null;

export function setValkeyClient(store: ValkeyStoreLike | null): void {
  customValkeyStore = store;
}

export function resetValkeyClient(): void {
  customValkeyStore = null;
}

export function getValkeyStore(): ValkeyStoreLike {
  if (customValkeyStore) {
    return customValkeyStore;
  }

  if (env.NODE_ENV === 'test') {
    // In test environment without an injected client, default to in-memory store
    // to avoid connection errors if Valkey daemon is not running
    customValkeyStore = new InMemoryValkeyStore();
    return customValkeyStore;
  }

  if (!defaultValkeyClient) {
    defaultValkeyClient = new Redis(env.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // don't infinite loop on reconnect in tests
    });

    defaultValkeyClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Valkey connection warning');
    });
  }

  return new IORedisValkeyStoreAdapter(defaultValkeyClient);
}

export function sha256Hex(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

/**
 * Creates a stateful session record in PostgreSQL and caches it in Valkey.
 */
export async function createSession(input: CreateSessionInput): Promise<SessionData> {
  const sessionId = input.sessionId ?? crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(sessionId);
  const ttlSeconds = input.ttlSeconds ?? 7 * 24 * 3600; // 7 days default
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const sessionData: SessionData = {
    sessionId,
    userId: input.userId,
    email: input.email,
    currentWorkspaceId: input.currentWorkspaceId,
    currentOrganizationId: input.currentOrganizationId,
    role: input.role,
    expiresAt,
  };

  // 1. Persist to PostgreSQL if connected
  try {
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET workspace_id = EXCLUDED.workspace_id,
           token_hash = EXCLUDED.token_hash,
           expires_at = EXCLUDED.expires_at,
           revoked_at = NULL`,
      [
        sessionId,
        input.userId,
        input.currentWorkspaceId,
        tokenHash,
        expiresAt,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    );
  } catch (err) {
    logger.debug({ err }, 'Failed to persist session to PostgreSQL (continuing with Valkey store)');
  }

  // 2. Cache in Valkey
  const store = getValkeyStore();
  const sessionKey = `session:${sessionId}`;
  const userSetKey = `user_sessions:${input.userId}`;

  await store.set(sessionKey, JSON.stringify(sessionData), 'EX', ttlSeconds);
  await store.sadd(userSetKey, sessionId);
  await store.expire(userSetKey, ttlSeconds);

  return sessionData;
}

let cachedSoloSession: SessionData | null = null;

export async function resolveSoloSession(): Promise<SessionData> {
  if (cachedSoloSession) return cachedSoloSession;
  try {
    const res = await pool.query<{
      user_id: string;
      workspace_id: string;
      org_id: string;
      email: string;
      role: string;
    }>(
      `SELECT wm.user_id, wm.workspace_id, w.org_id, u.email, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON wm.workspace_id = w.id
       JOIN users u ON wm.user_id = u.id
       ORDER BY wm.created_at ASC
       LIMIT 1`
    );
    if (res.rows.length > 0) {
      const r = res.rows[0];
      cachedSoloSession = {
        sessionId: 'solo-developer-session',
        userId: r.user_id,
        email: r.email,
        currentWorkspaceId: r.workspace_id,
        currentOrganizationId: r.org_id,
        role: (r.role as WorkspaceRole) || 'owner',
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      };
      return cachedSoloSession;
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to query solo workspace from DB, using fallback');
  }

  return {
    sessionId: 'solo-developer-session',
    userId: '33a30cd9-1bbc-4da6-8f9b-325a1a371ef1',
    email: 'admin@graywolf.local',
    currentWorkspaceId: 'e285707d-f08f-407c-a194-d0413703ba5d',
    currentOrganizationId: '75822eb2-c76f-4a03-9e98-ad7cd75a4f4e',
    role: 'owner',
    expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  };
}

/**
 * Validates a session token from Valkey cache (<1ms) with fail-closed revocation checks
 * and graceful fallback to PostgreSQL if not in cache.
 */
export async function verifySession(sessionId?: string): Promise<SessionData> {
  if (!sessionId || sessionId.trim().length === 0) {
    if (process.env.DEPLOYMENT_TOPOLOGY === 'solo') {
      return await resolveSoloSession();
    }
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Session token is missing or empty');
  }

  const store = getValkeyStore();

  // 1. Fast-path revocation tombstone check
  const isRevoked = await store.get(`session_revoked:${sessionId}`);
  if (isRevoked) {
    throw new GraywolfAppError('AUTH_SESSION_REVOKED', 'Session has been revoked');
  }

  // 2. Query Valkey session cache
  const cached = await store.get(`session:${sessionId}`);
  if (cached) {
    try {
      const data = JSON.parse(cached) as SessionData;
      if (new Date(data.expiresAt).getTime() <= Date.now()) {
        await store.del(`session:${sessionId}`);
        throw new GraywolfAppError('AUTH_SESSION_EXPIRED', 'Session has expired');
      }
      return data;
    } catch (err) {
      if (err instanceof GraywolfAppError) throw err;
      logger.warn({ err }, 'Failed to parse cached session payload, falling back to database');
    }
  }

  // 3. Fallback: Query PostgreSQL sessions table
  try {
    const res = await pool.query<{
      id: string;
      user_id: string;
      workspace_id: string;
      expires_at: string;
      revoked_at: string | null;
      email?: string;
      role?: string;
      org_id?: string;
    }>(
      `SELECT s.id, s.user_id, s.workspace_id, s.expires_at, s.revoked_at,
              u.email, wm.role, w.org_id AS org_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN workspaces w ON w.id = s.workspace_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (res.rowCount === 0) {
      throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Session not found');
    }

    const row = res.rows[0];
    if (row.revoked_at) {
      await store.set(`session_revoked:${sessionId}`, '1', 'EX', 86400);
      throw new GraywolfAppError('AUTH_SESSION_REVOKED', 'Session has been revoked');
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new GraywolfAppError('AUTH_SESSION_EXPIRED', 'Session has expired');
    }

    const sessionData: SessionData = {
      sessionId: row.id,
      userId: row.user_id,
      email: row.email ?? 'unknown@graywolf.local',
      currentWorkspaceId: row.workspace_id,
      currentOrganizationId: row.org_id ?? '00000000-0000-0000-0000-000000000000',
      role: (row.role as WorkspaceRole) ?? 'viewer',
      expiresAt: new Date(row.expires_at).toISOString(),
    };

    // Repopulate Valkey cache
    const ttlSeconds = Math.max(1, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
    await store.set(`session:${sessionId}`, JSON.stringify(sessionData), 'EX', ttlSeconds);
    await store.sadd(`user_sessions:${row.user_id}`, sessionId);

    return sessionData;
  } catch (err) {
    if (err instanceof GraywolfAppError) throw err;
    logger.debug({ err }, 'PostgreSQL lookup failed during session verification');
    throw new GraywolfAppError('AUTH_SESSION_MISSING', 'Session could not be verified');
  }
}

/**
 * Revokes a single session immediately.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const store = getValkeyStore();

  // 1. Mark revoked in Valkey with 24h tombstone
  await store.del(`session:${sessionId}`);
  await store.set(`session_revoked:${sessionId}`, '1', 'EX', 86400);

  // 2. Mark revoked in PostgreSQL
  try {
    await pool.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId]
    );
  } catch (err) {
    logger.debug({ err }, 'Failed to mark session revoked in PostgreSQL');
  }
}

/**
 * Revokes ALL active sessions for a user immediately across PostgreSQL and Valkey.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const store = getValkeyStore();
  const userSetKey = `user_sessions:${userId}`;

  // 1. Gather session IDs from Valkey set
  const sessionIdsFromValkey = await store.smembers(userSetKey);
  const sessionIds = new Set<string>(sessionIdsFromValkey);

  // 2. Update PostgreSQL sessions to revoked_at = NOW() and collect any additional session IDs
  try {
    const res = await pool.query<{ id: string }>(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [userId]
    );
    for (const row of res.rows) {
      sessionIds.add(row.id);
    }
  } catch (err) {
    logger.debug({ err }, 'Failed to revoke user sessions in PostgreSQL');
  }

  // 3. Purge all Valkey keys and set 24h tombstones
  const keysToDelete: string[] = [userSetKey];
  for (const sid of sessionIds) {
    keysToDelete.push(`session:${sid}`);
    await store.set(`session_revoked:${sid}`, '1', 'EX', 86400);
  }

  if (keysToDelete.length > 0) {
    await store.del(...keysToDelete);
  }

  return sessionIds.size;
}

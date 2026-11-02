import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import pino from 'pino';
import { env } from '../config/env';

const logger = pino({ name: 'db' });

// We're building the Graywolf Orchestrator here (Tier 1).
// The Orchestrator's internal state requires PostgreSQL.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error(err, 'Unexpected error on idle client');
  process.exit(-1);
});

export const query = async <R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> => {
  const start = Date.now();
  const res = await pool.query<R>(text, params);
  const duration = Date.now() - start;
  logger.debug({ query: text, duration, rows: res.rowCount }, 'Executed query');
  return res;
};

export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  const release = client.release.bind(client);
  // Track leakages
  const timeout = setTimeout(() => {
    logger.warn('A client has been checked out for more than 5 seconds!');
  }, 5000);

  client.release = (err?: Error | boolean) => {
    clearTimeout(timeout);
    return release(err);
  };
  return client;
};

export interface TenantContext {
  workspaceId: string;
  orgId?: string;
}

/**
 * Executes a callback within a transaction where the tenant context
 * (app.current_workspace_id and app.current_org_id) is set locally.
 * Enforces automatic COMMIT on success, safe ROLLBACK on error, and leak-free client release.
 */
export const withTenantContext = async <T>(
  ctx: TenantContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_org_id', $2, true)",
      [ctx.workspaceId, ctx.orgId ?? '']
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error(rollbackErr, 'Error rolling back transaction in withTenantContext');
    }
    throw error;
  } finally {
    client.release();
  }
};

import { Pool } from 'pg';
import picomatch from 'picomatch';
import { query as defaultQuery } from './index';
import { GraywolfAppError } from '../errors/taxonomy';

export type SandboxDbTier =
  | 'tier-0-mock'
  | 'tier-1-shared-db'
  | 'tier-2-isolated-db';

export interface SandboxDbResolutionInput {
  explicitTier?: SandboxDbTier;
  targetFiles?: string[];
  plannerDeclaredTier?: SandboxDbTier;
  defaultTier?: SandboxDbTier;
}

export interface ProvisionSandboxDbOptions {
  taskId: string;
  tier: SandboxDbTier;
  baseDatabaseUrl: string;
  templateDbName?: string; // defaults to 'graywolf_template'
  queryExecutor?: (sql: string, targetConnectionString?: string) => Promise<unknown>;
  seedSql?: string;
}

export interface TeardownSandboxDbOptions {
  taskId: string;
  tier: SandboxDbTier;
  queryExecutor?: (sql: string) => Promise<unknown>;
}

export interface SandboxDbProvisionResult {
  tier: SandboxDbTier;
  identifier: string | null;
  connectionString: string | null;
}

const MIGRATION_PATTERNS = [
  '**/migrations/**',
  '**/*.sql',
  '**/schema.prisma',
  '**/alembic/**',
  '**/drizzle/**',
];

/**
 * Sanitizes a raw identifier into a valid PostgreSQL identifier (lowercase alphanumeric + underscores, max 63 chars).
 */
export function sanitizePostgresIdentifier(raw: string, prefix?: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid database identifier: "${raw}" contains no alphanumeric characters`,
      { raw }
    );
  }

  const withPrefix =
    prefix && !normalized.startsWith(`${prefix}_`)
      ? `${prefix}_${normalized}`
      : normalized;

  const result = withPrefix.slice(0, 63).replace(/_+$/, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(result)) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Invalid database identifier generated from "${raw}"`,
      { raw, result }
    );
  }

  return result;
}

/**
 * Sanitizes a taskId into a valid PostgreSQL identifier (alphanumeric + underscores, max 63 chars).
 */
export function sanitizeTaskDbIdentifier(taskId: string): string {
  return sanitizePostgresIdentifier(taskId, 'task');
}

/**
 * Resolves the database isolation tier using 4-level precedence hierarchy:
 * 1. Human Task Override (explicitTier)
 * 2. Pre-flight File Pattern Analyzer (targetFiles matching migrations/schemas) -> tier-2-isolated-db
 * 3. Dev-Level-1 plan.md declaration (plannerDeclaredTier)
 * 4. Global Config Default (defaultTier, fallback tier-0-mock)
 */
export function resolveSandboxDbTier(input: SandboxDbResolutionInput): SandboxDbTier {
  // Precedence 1: Explicit Human Override
  if (input.explicitTier) {
    return input.explicitTier;
  }

  // Precedence 2: Pre-flight File Pattern Analyzer
  if (input.targetFiles && input.targetFiles.length > 0) {
    const isMigrationMatch = picomatch(MIGRATION_PATTERNS);
    const hasMigrationFile = input.targetFiles.some((f) => isMigrationMatch(f));
    if (hasMigrationFile) {
      return 'tier-2-isolated-db';
    }
  }

  // Precedence 3: Dev-Level-1 Planner Declaration
  if (input.plannerDeclaredTier) {
    return input.plannerDeclaredTier;
  }

  // Precedence 4: Global Config Default
  return input.defaultTier ?? 'tier-0-mock';
}

/**
 * Provisions a sandbox database according to the resolved isolation tier.
 */
export async function provisionSandboxDatabase(
  options: ProvisionSandboxDbOptions
): Promise<SandboxDbProvisionResult> {
  const { taskId, tier, baseDatabaseUrl } = options;
  const execQuery = options.queryExecutor ?? ((sql: string) => defaultQuery(sql));

  if (tier === 'tier-0-mock') {
    return {
      tier: 'tier-0-mock',
      identifier: null,
      connectionString: null,
    };
  }

  const identifier = sanitizeTaskDbIdentifier(taskId);

  if (tier === 'tier-1-shared-db') {
    // Schema-level isolation: CREATE SCHEMA IF NOT EXISTS
    await execQuery(`CREATE SCHEMA IF NOT EXISTS "${identifier}"`);

    const parsedUrl = new URL(baseDatabaseUrl);
    parsedUrl.searchParams.set('options', `-c search_path=${identifier},public`);

    return {
      tier: 'tier-1-shared-db',
      identifier,
      connectionString: parsedUrl.toString(),
    };
  }

  if (tier === 'tier-2-isolated-db') {
    // Database-level isolation: CREATE DATABASE ... TEMPLATE
    const templateDb = sanitizePostgresIdentifier(
      options.templateDbName ?? 'graywolf_template'
    );
    await execQuery(`CREATE DATABASE "${identifier}" TEMPLATE "${templateDb}"`);

    const parsedUrl = new URL(baseDatabaseUrl);
    parsedUrl.pathname = `/${identifier}`;
    const isolatedConnectionString = parsedUrl.toString();

    if (options.seedSql) {
      if (options.queryExecutor) {
        await options.queryExecutor(options.seedSql, isolatedConnectionString);
      } else {
        const seedPool = new Pool({ connectionString: isolatedConnectionString });
        try {
          await seedPool.query(options.seedSql);
        } finally {
          await seedPool.end();
        }
      }
    }

    return {
      tier: 'tier-2-isolated-db',
      identifier,
      connectionString: isolatedConnectionString,
    };
  }

  return {
    tier: 'tier-0-mock',
    identifier: null,
    connectionString: null,
  };
}

/**
 * Tears down the sandbox database or schema provisioned for the task.
 */
export async function teardownSandboxDatabase(
  options: TeardownSandboxDbOptions
): Promise<void> {
  const { taskId, tier } = options;
  const execQuery = options.queryExecutor ?? ((sql: string) => defaultQuery(sql));

  if (tier === 'tier-0-mock') {
    return;
  }

  const identifier = sanitizeTaskDbIdentifier(taskId);

  if (tier === 'tier-1-shared-db') {
    await execQuery(`DROP SCHEMA IF EXISTS "${identifier}" CASCADE`);
    return;
  }

  if (tier === 'tier-2-isolated-db') {
    // Terminate existing connections first, then drop database
    await execQuery(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${identifier}' AND pid <> pg_backend_pid()`
    );
    await execQuery(`DROP DATABASE IF EXISTS "${identifier}" WITH (FORCE)`);
  }
}

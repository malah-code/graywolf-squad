import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeTaskDbIdentifier,
  resolveSandboxDbTier,
  provisionSandboxDatabase,
  teardownSandboxDatabase,
} from '../../src/orchestrator/db/sandbox-db';

describe('3-Tier Sandbox Database Isolation Engine Integration Tests (US4)', () => {
  const baseDatabaseUrl = 'postgresql://postgres:secret@localhost:5432/graywolf_core';

  describe('SQL Identifier Sanitization', () => {
    it('sanitizes various task IDs into compliant PostgreSQL identifiers', () => {
      expect(sanitizeTaskDbIdentifier('TASK-401')).toBe('task_401');
      expect(sanitizeTaskDbIdentifier('task-401')).toBe('task_401');
      expect(sanitizeTaskDbIdentifier('401')).toBe('task_401');
      expect(sanitizeTaskDbIdentifier('feature/user-auth.v2')).toBe('task_feature_user_auth_v2');

      const longTaskId = 'TASK-VERY-LONG-NAME-THAT-EXCEEDS-SIXTY-THREE-CHARACTERS-IN-LENGTH-FOR-POSTGRESQL-SCHEMA-NAMING';
      const sanitized = sanitizeTaskDbIdentifier(longTaskId);
      expect(sanitized.length).toBeLessThanOrEqual(63);
      expect(sanitized).toMatch(/^[a-z_][a-z0-9_]*$/);
    });

    it('rejects empty or non-alphanumeric task IDs with ACI_VALIDATION_FAILED', () => {
      expect(() => sanitizeTaskDbIdentifier('---')).toThrow('Invalid database identifier');
      expect(() => sanitizeTaskDbIdentifier('   ')).toThrow('Invalid database identifier');
    });
  });

  describe('4-Level Precedence Resolution Hierarchy', () => {
    it('Precedence 1 (Human Override) overrides pre-flight migration file detection', () => {
      const resolved = resolveSandboxDbTier({
        explicitTier: 'tier-1-shared-db',
        targetFiles: ['migrations/1789444040216_create_table.sql'],
        plannerDeclaredTier: 'tier-0-mock',
        defaultTier: 'tier-0-mock',
      });
      expect(resolved).toBe('tier-1-shared-db');
    });

    it('Precedence 2 (Pre-flight File Analyzer) auto-escalates to tier-2-isolated-db on migration/schema files', () => {
      const sqlResolved = resolveSandboxDbTier({
        targetFiles: ['src/db/migrations/001_init.sql', 'src/models.ts'],
        plannerDeclaredTier: 'tier-0-mock',
        defaultTier: 'tier-0-mock',
      });
      expect(sqlResolved).toBe('tier-2-isolated-db');

      const prismaResolved = resolveSandboxDbTier({
        targetFiles: ['prisma/schema.prisma'],
        defaultTier: 'tier-1-shared-db',
      });
      expect(prismaResolved).toBe('tier-2-isolated-db');

      const alembicResolved = resolveSandboxDbTier({
        targetFiles: ['alembic/versions/test.py'],
        defaultTier: 'tier-0-mock',
      });
      expect(alembicResolved).toBe('tier-2-isolated-db');
    });

    it('Precedence 3 (Planner Declaration) selects planner tier when no migrations or human override', () => {
      const resolved = resolveSandboxDbTier({
        targetFiles: ['src/auth/jwt.ts', 'src/routes/login.ts'],
        plannerDeclaredTier: 'tier-1-shared-db',
        defaultTier: 'tier-0-mock',
      });
      expect(resolved).toBe('tier-1-shared-db');
    });

    it('Precedence 4 (Global Config Default) applies when no higher precedence rules match', () => {
      const defaultResolved = resolveSandboxDbTier({
        targetFiles: ['src/utils/helpers.ts'],
        defaultTier: 'tier-1-shared-db',
      });
      expect(defaultResolved).toBe('tier-1-shared-db');

      const fallbackResolved = resolveSandboxDbTier({});
      expect(fallbackResolved).toBe('tier-0-mock');
    });
  });

  describe('Tier Provisioning & Teardown Execution', () => {
    it('handles tier-0-mock lifecycle without executing database commands', async () => {
      const queryExecutor = vi.fn(async () => ({}));

      const provisionResult = await provisionSandboxDatabase({
        taskId: 'TASK-701',
        tier: 'tier-0-mock',
        baseDatabaseUrl,
        queryExecutor,
      });

      expect(provisionResult.tier).toBe('tier-0-mock');
      expect(provisionResult.identifier).toBeNull();
      expect(provisionResult.connectionString).toBeNull();
      expect(queryExecutor).not.toHaveBeenCalled();

      await teardownSandboxDatabase({
        taskId: 'TASK-701',
        tier: 'tier-0-mock',
        queryExecutor,
      });

      expect(queryExecutor).not.toHaveBeenCalled();
    });

    it('provisions and tears down tier-1-shared-db with search_path schema isolation', async () => {
      const queries: string[] = [];
      const queryExecutor = vi.fn(async (sql: string) => {
        queries.push(sql);
        return {};
      });

      const provisionResult = await provisionSandboxDatabase({
        taskId: 'TASK-702',
        tier: 'tier-1-shared-db',
        baseDatabaseUrl,
        queryExecutor,
      });

      expect(provisionResult.tier).toBe('tier-1-shared-db');
      expect(provisionResult.identifier).toBe('task_702');
      expect(provisionResult.connectionString).toContain('search_path%3Dtask_702%2Cpublic');
      expect(queries[0]).toBe('CREATE SCHEMA IF NOT EXISTS "task_702"');

      // Teardown
      await teardownSandboxDatabase({
        taskId: 'TASK-702',
        tier: 'tier-1-shared-db',
        queryExecutor,
      });

      expect(queries[1]).toBe('DROP SCHEMA IF EXISTS "task_702" CASCADE');
    });

    it('provisions and tears down tier-2-isolated-db with template clone and seed script', async () => {
      const queries: { sql: string; targetConnectionString?: string }[] = [];
      const queryExecutor = vi.fn(async (sql: string, targetConnectionString?: string) => {
        queries.push({ sql, targetConnectionString });
        return {};
      });

      const seedSql = 'INSERT INTO users (name) VALUES (\'Seed User\');';

      const provisionResult = await provisionSandboxDatabase({
        taskId: 'TASK-703',
        tier: 'tier-2-isolated-db',
        baseDatabaseUrl,
        templateDbName: 'graywolf_template',
        seedSql,
        queryExecutor,
      });

      expect(provisionResult.tier).toBe('tier-2-isolated-db');
      expect(provisionResult.identifier).toBe('task_703');
      expect(provisionResult.connectionString).toBe(
        'postgresql://postgres:secret@localhost:5432/task_703'
      );
      expect(queries[0].sql).toBe('CREATE DATABASE "task_703" TEMPLATE "graywolf_template"');
      expect(queries[0].targetConnectionString).toBeUndefined();
      expect(queries[1].sql).toBe(seedSql);
      expect(queries[1].targetConnectionString).toBe(
        'postgresql://postgres:secret@localhost:5432/task_703'
      );

      // Teardown
      await teardownSandboxDatabase({
        taskId: 'TASK-703',
        tier: 'tier-2-isolated-db',
        queryExecutor,
      });

      expect(queries[2].sql).toContain('pg_terminate_backend');
      expect(queries[3].sql).toBe('DROP DATABASE IF EXISTS "task_703" WITH (FORCE)');
    });
  });
});

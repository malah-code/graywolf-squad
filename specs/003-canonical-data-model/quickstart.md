# Quickstart & Verification Guide: 003-canonical-data-model

## Prerequisites

- Node.js 20+ and `pnpm`
- PostgreSQL 16 + `pgvector` running (e.g., via `docker compose up -d postgres`)

## 1. Run Canonical Migrations (Up / Down / Up)

```bash
pnpm migrate:up
pnpm migrate:down
pnpm migrate:up
```

Expected outcome: All 24 tables, `vector(768)` columns, RLS policies, and indexes are created, torn down cleanly, and recreated with exit code 0.

## 2. Run Unit & Integration Tests

```bash
pnpm test
```

Expected outcome:
- `tests/unit/schemas-task.test.ts` passes all frontmatter parsing, validation, and round-trip serialization assertions.
- `tests/unit/schemas-contracts.test.ts` passes all `delegate-relay.result.v1` and `project.config.json` validation assertions.
- `tests/integration/db-rls.test.ts` verifies `withTenantContext` GUC injection, transaction rollback, cross-workspace RLS isolation, and org-wide `project_lessons` visibility.

## 3. Run Typecheck & Linter

```bash
pnpm typecheck
pnpm lint
```

Expected outcome: 0 TypeScript errors and 0 ESLint warnings/errors.

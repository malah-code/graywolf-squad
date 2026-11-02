# Phase 1 Research: Canonical Data Model, PostgreSQL RLS & Core Schemas

**Feature**: `003-canonical-data-model`  
**Date**: 2026-10-18

## Decisions & Rationale

### 1. Fail-Closed PostgreSQL Row-Level Security (RLS) Casting
- **Decision**: Use `NULLIF(current_setting('app.current_workspace_id', true), '')::UUID` and `NULLIF(current_setting('app.current_org_id', true), '')::UUID` in all RLS `USING` and `WITH CHECK` clauses, combined with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- **Rationale**: In PostgreSQL, `set_config('app.current_workspace_id', '', true)` or an unset custom GUCs with `missing_ok = true` returns either `''` or `NULL`. Casting `''::UUID` directly throws `invalid input syntax for type uuid: ""` rather than cleanly evaluating the row filter to `false`. Wrapping with `NULLIF(..., '')::UUID` ensures an unset or empty setting evaluates to `NULL`, and `workspace_id = NULL` evaluates to `UNKNOWN` (falsy in `USING`/`WITH CHECK`), guaranteeing a clean fail-closed 0-row result on reads and policy rejection on writes.
- **Alternatives Considered**: Direct `current_setting('app.current_workspace_id')::UUID` without `missing_ok` or `NULLIF` — rejected because any query run before setting the GUC throws a raw PostgreSQL syntax/configuration error (`unrecognized configuration parameter`) instead of failing closed via RLS.

### 2. Testing `FORCE ROW LEVEL SECURITY` Under Non-Superuser Context
- **Decision**: In PostgreSQL 16, `FORCE ROW LEVEL SECURITY` enforces RLS on table owners, **except** roles with the `SUPERUSER` or `BYPASSRLS` attribute (which always bypass RLS in PostgreSQL by engine design). In the migration / RLS integration tests, create/use an application role without `SUPERUSER`/`BYPASSRLS` (or execute `SET LOCAL ROLE` inside test verification / configure a `graywolf_app` role) to prove PostgreSQL physically blocks cross-tenant queries.
- **Rationale**: Guarantees that integration tests genuinely exercise PostgreSQL's RLS policy evaluator rather than passing falsely under a superuser bypass.
- **Alternatives Considered**: Relying solely on default `graywolf` superuser in Docker Compose — rejected because PostgreSQL superusers bypass even `FORCE ROW LEVEL SECURITY`, which would make cross-tenant isolation tests fail to test actual policy enforcement.

### 3. YAML Frontmatter Parsing & Serialization (`gray-matter` + `@sinclair/typebox/value`)
- **Decision**: Use `gray-matter` to parse and stringify YAML frontmatter blocks (`brief.md`, `plan.md`, `review-signoff.md`, `escalation-request.md`) and validate the parsed `data` object using `Value.Check(schema, data)` / `Value.Errors(schema, data)` from `@sinclair/typebox/value`.
- **Rationale**: `gray-matter` is already installed in `package.json`, is MIT-licensed, handles YAML date strings/numbers reliably, and pairs cleanly with TypeBox's zero-dependency runtime validator.
- **Alternatives Considered**: Custom regex YAML splitting — rejected as brittle on multiline strings and edge cases.

# Data Model: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Feature**: `013-review-packet-and-vcs-delivery`  
**Phase**: Phase 11  
**Source of Truth**: `specs/001-multi-agent-platform/data-model.md` & `migrations/1789444040216_create-tasks-table.js`

## 1. Relational Schema Touchpoints (Existing Canonical Tables)

No new database migration is required in Phase 11 because `confidence_calibration` (Table #19) was created in Phase 1 (`migrations/1789444040216_create-tasks-table.js`).

### 1.1 `confidence_calibration` Table (Table #19)
| Column | Type | Nullable | Constraints & Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `task_id` | `VARCHAR(64)` | `NOT NULL` (FK) | References `tasks(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` (RLS key) |
| `user_id` | `UUID` | `NULL` (FK) | References `users(id) ON DELETE SET NULL` |
| `model_id` | `VARCHAR(64)` | `NOT NULL` | Model identifier (e.g. `'claude-3-7-sonnet'`, `'gpt-4o'`) |
| `model_version` | `VARCHAR(32)` | `NOT NULL` | Model version string (e.g. `'2025-02-19'`) |
| `file_path` | `TEXT` | `NOT NULL` | Touched file path |
| `file_language` | `VARCHAR(32)` | `NULL` | Language (e.g. `'typescript'`, `'python'`) |
| `file_type` | `VARCHAR(32)` | `NULL` | File category (e.g. `'service'`, `'migration'`, `'route'`, `'test'`, `'ui'`) |
| `confidence_score` | `NUMERIC(3, 2)` | `NOT NULL` | Reported confidence (`0.00`–`1.00`) |
| `justification` | `TEXT` | `NULL` | JSON/text justification (including empirical outcome `'accepted' \| 'rejected'`) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | Default `NOW()` (used for 90-day half-life decay) |

---

## 2. Domain Entities & Structures

### 2.1 `MandatoryGateId` (The 6 Non-Negotiable Human Gates — PRD §8.4)
1. `'blast_radius_escape'`
2. `'destructive_ddl'`
3. `'security_or_license_exposure'`
4. `'protected_branch_target'`
5. `'task_spend_ceiling_exceeded'`
6. `'two_strike_review_rejection'`

### 2.2 `ModelDataResidencyTier` (PRD §11.3)
- `'tier-1-local-only'`: 100% local open-weight models (`ollama`, `vllm`, `llamacpp`) — zero external data egress.
- `'tier-2-zero-retention-cloud'`: Enterprise zero-data-retention (ZDR) cloud endpoints.
- `'tier-3-standard-commercial-api'`: Standard commercial cloud LLM APIs.

### 2.3 7-Section Executive Review Packet Structure (PRD §8.4)
1. **Section 1**: `## 1. 10-Second Executive Summary` (includes DecisionGate Risk Badge, Model Data Residency Badge, and Calibrated Confidence Score).
2. **Section 2**: `## 2. Quality Gate Compliance Table` (`Clean-Code Guard`, `Test Guard`, `Documentation Guard`, `In-Container Review`).
3. **Section 3**: `## 3. Dual-Axis Review Matrix (Standards Axis vs. Spec Axis)` (ADR-083).
4. **Section 4**: `## 4. Docs-Guard AST Symbol Verification Badge`.
5. **Section 5**: `## 5. Browser Smoke Test Findings Table (e2e explore)`.
6. **Section 6**: `## 6. Visual Proof Artifacts` (Playwright screenshots / WebM + `cached` vs `live` indicator).
7. **Section 7**: `## 7. Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown`.

# Data Model: Brownfield Reconnaissance, 8-Layer Context Engine & Virtual Developer Tiers

**Feature**: `011-recon-context-and-dev-tiers`  
**Phase**: Phase 9  
**Source of Truth**: `specs/001-multi-agent-platform/data-model.md` & `migrations/1789444040216_create-tasks-table.js`

## 1. Relational Schema Touchpoints (Existing Canonical Tables)

No new database migration is required in Phase 9 because `code_symbols`, `code_references`, `project_lessons`, and `review_evidence` were created in Phase 1 (`migrations/1789444040216_create-tasks-table.js`).

### 1.1 `code_symbols` (Table #21)
| Column | Type | Nullable | Constraints & Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `org_id` | `UUID` | `NOT NULL` (FK) | References `organizations(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` (RLS key) |
| `project_id` | `UUID` | `NOT NULL` (FK) | References `projects(id) ON DELETE CASCADE` |
| `name` | `VARCHAR(255)` | `NOT NULL` | Symbol identifier or normalized route literal (`/api/v1/orgs/:id/members`) |
| `kind` | `VARCHAR(32)` | `NOT NULL` | `'function' \| 'class' \| 'interface' \| 'type' \| 'method' \| 'route' \| 'variable'` |
| `file_path` | `TEXT` | `NOT NULL` | Relative repository path (`src/modules/billing/service.ts`) |
| `line_start` | `INT` | `NOT NULL` | 1-based start line |
| `line_end` | `INT` | `NOT NULL` | 1-based end line |
| `exported` | `BOOLEAN` | `DEFAULT false` | Whether symbol is exported |
| `signature` | `TEXT` | `NULL` | Extracted declaration signature |
| `hash` | `VARCHAR(64)` | `NOT NULL` | SHA-256 hex digest of the source file content at index time |

### 1.2 `code_references` (Table #22)
| Column | Type | Nullable | Constraints & Description |
|---|---|---|---|
| `id` | `UUID` | `NOT NULL` (PK) | Default `gen_random_uuid()` |
| `org_id` | `UUID` | `NOT NULL` (FK) | References `organizations(id) ON DELETE CASCADE` |
| `workspace_id` | `UUID` | `NOT NULL` (FK) | References `workspaces(id) ON DELETE CASCADE` |
| `project_id` | `UUID` | `NOT NULL` (FK) | References `projects(id) ON DELETE CASCADE` |
| `caller_symbol_id` | `UUID` | `NULL` (FK) | References `code_symbols(id) ON DELETE CASCADE` |
| `callee_symbol_id` | `UUID` | `NULL` (FK) | References `code_symbols(id) ON DELETE CASCADE` |
| `reference_type` | `VARCHAR(16)` | `NOT NULL` | `'import' \| 'call' \| 'route_fetch'` |

### 1.3 `project_lessons` (Table #20 — Layer 6 Input) & `review_evidence` (Table #16 — ADR-062 Cross-Check)
- `project_lessons`: Queried in Layer 6 (`status = 'active'`, `confidence_score NUMERIC(3, 2)`) to inject verified project anti-patterns into the boot-time context bundle.
- `review_evidence`: Queried by `reviewer.ts` (`command_type = 'test'`, `exit_code INT NOT NULL`) to verify whether an `agreed P0/P1` test-failure claim is backed by an actual failing test execution.

---

## 2. Domain & TypeBox Schemas (`src/orchestrator/schemas/review.ts`)

### 2.1 `FindingsV1` (Pass 1 — Main Reviewer)
- `schemaVersion`: `'findings.v1'`
- `taskId`: `string`
- `findings`: Array of `ReviewFindingItem`:
  - `id`: `string` (e.g. `'F-001'`)
  - `axis`: `'standards' | 'spec'` (ADR-083 Dual-Axis)
  - `severity`: `'P0' | 'P1' | 'P2'`
  - `category`: `'logic' | 'security' | 'test' | 'architecture' | 'style' | 'docs'`
  - `filePath`: `string`
  - `lineStart`: `number`
  - `lineEnd`: `number`
  - `confidence`: `number` (minimum `0.5` required to emit in Pass 1)
  - `claimsTestFailure`: `boolean` (optional, default `false`)
  - `description`: `string`
  - `suggestedFix`: `string`

### 2.2 `DebateV1` (Pass 2 — Challenger / Cross-Family Model)
- `schemaVersion`: `'debate.v1'`
- `taskId`: `string`
- `challenges`: Array of:
  - `findingId`: `string`
  - `stance`: `'confirm' | 'refute'`
  - `reasoning`: `string`
  - `evidence`: `string` (optional)
- `newGaps`: Array of `ReviewFindingItem` (missed in Pass 1)

### 2.3 `FinalV1` (Pass 3 — Verdict Synthesis & Evidence Cross-Check)
- `schemaVersion`: `'final.v1'`
- `taskId`: `string`
- `verdicts`: Array of:
  - `findingId`: `string`
  - `verdict`: `'agreed' | 'contested' | 'withdrawn'`
  - `initialSeverity`: `'P0' | 'P1' | 'P2'`
  - `effectiveSeverity`: `'P0' | 'P1' | 'P2'` (auto-downgraded to `'P2'` if `claimsTestFailure` / `category === 'test'` has no failing `test` record in `review_evidence`)
  - `downgradedByEvidenceLedger`: `boolean`
  - `rationale`: `string`
- `approved`: `boolean` (`true` iff zero `agreed` findings have `effectiveSeverity` in `['P0', 'P1']`)
- `strikeIncrement`: `0 | 1`

### 2.4 `EscalationMemo` (Neutral Arbiter Output)
- `taskId`: `string`
- `strikeCount`: `number` (`>= 2`)
- `disputeSummary`: `string`
- `optionA`: `{ title: string; pros: string[]; cons: string[] }`
- `optionB`: `{ title: string; pros: string[]; cons: string[] }`
- `recommendedOption`: `'A' | 'B'`
- `recommendationRationale`: `string`
- `markdown`: `string` (written to `escalation-memo.md`)

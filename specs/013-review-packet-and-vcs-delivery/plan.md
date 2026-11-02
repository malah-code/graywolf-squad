# Implementation Plan: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Branch**: `013-review-packet-and-vcs-delivery` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/013-review-packet-and-vcs-delivery/spec.md`

## Summary

Implement Phase 11 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 11.1–11.4):
1. **Provider-Agnostic Git & VCS Abstraction (`src/orchestrator/delivery/repo-sdk.ts`, Task 11.1)**: Unified `RepoSdkClient` supporting `'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'` with pluggable provider transport/adapters for `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook`, mapping 401/403 errors to `GraywolfAppError('GIT_REMOTE_AUTH_FAILED')`.
2. **6 Non-Negotiable Mandatory Human Gates, `ai-pm` Reviewer & Solo Auto-Merge (`src/orchestrator/delivery/mandatory-gates.ts`, Task 11.2)**: Deterministic evaluation of the 6 non-negotiable human gates (blast-radius escape, destructive DDL `DROP TABLE`/`TRUNCATE`, secret/CVE/copyleft exposure, protected branch `main`/`release/*`, per-task spend ceiling exceeded, and 2-strike internal review rejection), configurable gate policy resolution (`auto` / `ai-pm` / `human` / `mandatory-human`), `ai-pm` reviewer evaluation with `canEscalateToHuman`, and Solo Dev `Auto-Merge-if-Green`.
3. **7-Section 60-Second Executive Review Packet & Per-Model Confidence Calibration (`src/orchestrator/delivery/review-packet.ts`, `src/orchestrator/delivery/confidence-calibration.ts`, Task 11.3)**:
   - `confidence-calibration.ts`: Persist and query `confidence_calibration` inside `withTenantContext`, enforcing the `n >= 30` sample gate per `(file_type, model_id, model_version)`, 90-day exponential decay half-life (`0.5 ^ (ageDays / 90)`), and `[-0.15, +0.15]` adjustment cap.
   - `review-packet.ts`: Render the 7-section PR Markdown packet (10-Second Executive Summary + DecisionGate risk badge + Model Data Residency Tier 1/2/3 badge + Calibrated Confidence score, Quality Gate Compliance Table, Dual-Axis Review Matrix, Docs-Guard AST Symbol Verification Badge, Browser Smoke Test Findings Table, Visual Proof Artifacts with `cached` vs `live` indicator, and Deterministic AST Semantic Diff summary & Scoped File Diff Breakdown).
4. **Inbound PR Review Comment Webhook Loop & External PM Sync (`src/orchestrator/routes/webhooks-vcs.ts`, `src/orchestrator/delivery/pm-sync.ts`, Task 11.4)**:
   - `webhooks-vcs.ts`: Fastify route `POST /api/v1/webhooks/vcs/:provider` + `VcsWebhookDebouncer` coalescing rapid PR review comments within `webhookDebounceMs`, dispatching ARP `review.feedback`, re-running guards, and pushing the updated commit to the PR branch.
   - `pm-sync.ts`: Bidirectional PM sync (`github`, `gitlab`, `jira`, `linear`) where Graywolf owns execution state (`TaskStatus`) and the external PM tool owns `labels` and `assignees`.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: Fastify 5.x, `@sinclair/typebox`, `pg` (`withTenantContext`), `src/orchestrator/errors/taxonomy.ts`, `src/orchestrator/schemas/project-config.ts`  
**Storage**: PostgreSQL 16 (`confidence_calibration`, `tasks`, `audit_logs` with tenant RLS)  
**Testing**: Vitest (`tests/unit/repo-sdk.test.ts`, `tests/unit/mandatory-gates.test.ts`, `tests/unit/review-packet.test.ts`, `tests/integration/webhook-feedback.test.ts`)  
**Target Platform**: Linux host / Fastify Control Plane API (`src/orchestrator/*`)  
**Project Type**: Backend orchestrator VCS delivery, review packet, calibration & webhook modules  
**Performance Goals**: `< 50ms` review packet synthesis & mandatory gate evaluation; deterministic `webhookDebounceMs` coalescing  
**Constraints**: Host orchestrator (never in-container agent) performs VCS branch push & PR creation; 6 mandatory human gates are non-overridable; calibration adjustment strictly `0` when `n < 30` and capped at `±0.15` when `n >= 30`  
**Scale/Scope**: 6 source modules (`repo-sdk.ts`, `mandatory-gates.ts`, `review-packet.ts`, `confidence-calibration.ts`, `pm-sync.ts`, `routes/webhooks-vcs.ts`) + 4 comprehensive test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Agents never commit or push; the host orchestrator pushes verified patches to isolated task branches and enforces all 6 Non-Negotiable Mandatory Human Gates before any merge.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Provider-agnostic `repo-sdk.ts` supports GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea; `pm-sync.ts` supports GitHub, GitLab, Jira, and Linear via clean adapter interfaces.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — Uses canonical PostgreSQL `confidence_calibration` table with `withTenantContext` RLS isolation.
- **Principle 4 (Headless Execution & Observability)**: PASS — Every PR delivery, `ai-pm` review decision, and webhook feedback loop emits structured logs and audit records.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — Mandatory Gate #1 blocks auto-merge on any blast-radius scope escape.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — Mandatory Gate #6 enforces human escalation on two-strike internal review rejection, and webhook feedback routes through ARP `review.feedback` + guard re-verification.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — Protected branches (`main`, `release/*`) and destructive DDL (`DROP TABLE`, `TRUNCATE`) trigger Mandatory Gates #2 and #4.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — Zero proprietary dependencies added; Model Data Residency Badge explicitly surfaces Tier 1 (`Local-Only` $0 offline) vs. Tier 2/3 cloud execution.

## Project Structure

### Documentation (this feature)

```text
specs/013-review-packet-and-vcs-delivery/
├── spec.md              # Feature specification (FR-001..FR-006, SC-001..SC-004)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for repo-sdk, 6 gates, calibration & webhooks
├── data-model.md        # Relational schema touchpoints (confidence_calibration) & domain models
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass)
└── contracts/
    └── review-packet-and-vcs.md # Exact TypeScript interfaces and method signatures
```

### Source Code (repository root)

```text
src/orchestrator/delivery/
├── repo-sdk.ts               # Task 11.1: Provider-agnostic VCS client (GitHub/GitLab/Bitbucket/Azure/Gitea)
├── mandatory-gates.ts        # Task 11.2: 6 Non-Negotiable Human Gates, ai-pm persona & Auto-Merge-if-Green
├── confidence-calibration.ts # Task 11.3b: Per-model confidence calibration (n>=30, ±0.15, 90d half-life)
├── review-packet.ts          # Task 11.3a: 7-section 60-Second Executive Review Packet builder
└── pm-sync.ts                # Task 11.4b: Bidirectional PM sync (Graywolf owns state; PM owns labels/assignees)

src/orchestrator/routes/
└── webhooks-vcs.ts           # Task 11.4a: Debounced inbound PR comment webhook -> ARP review.feedback loop

tests/
├── unit/
│   ├── repo-sdk.test.ts        # Unit tests for Task 11.1 (5 providers, clone/push/PR/comment/merge/webhook, 401/403)
│   ├── mandatory-gates.test.ts # Unit tests for Task 11.2 (all 6 mandatory gates, ai-pm, Auto-Merge-if-Green)
│   └── review-packet.test.ts   # Unit tests for Task 11.3 (7-section packet, badges, n<30 vs n>=30 calibration)
└── integration/
    └── webhook-feedback.test.ts # Integration tests for Task 11.4 (debounced PR comments -> ARP -> guards -> push + PM sync)
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` §2 Canonical Repository Target Layout and Phase 11 Tasks 11.1–11.4.

## Complexity Tracking

No Constitution violations or complexity exceptions required.

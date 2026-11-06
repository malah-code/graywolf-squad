# Implementation Plan: Attention Firewall & Two-Stage Signal Admission (`021-attention-firewall`)

**Branch**: `021-attention-firewall` | **Date**: 2026-11-05 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/021-attention-firewall/spec.md)  
**Input**: Feature specification + `docs/implementation-plan-detailed.md` Phase 20 + ADR-084 + `docs/PRD.md` §18  
**Upstream reference (MIT, clean-room port per ADR-038)**: `reference-opensources/dsh-superagent-prototype-main/src/{core,policy.ts,admission.ts,limits.ts,sources/admission-context.ts}` and `tests/{core-engine,assessment,admission-context,followups,effects}.spec.ts`

## Summary

Phase 20 puts a firewall between **signal ingestion** (addons → `submitSignal` → `onSignalAccepted`) and **task creation**. Every inbound trigger passes:

1. **Stage 1 – deterministic gate (0 tokens)**: source scope filter → sender allow-list → admission matrix → strength (`explicit` / `inferred`).
2. **Stage 2 – bounded Assessor (Gate 5)**: only for *inferred* candidates. One tool-less, schema-validated LiteLLM call over a host-built message window.
3. **Outcome**: `accept` (creates a Graywolf task carrying an immutable **Mandate**), `ignore`, or `ignore/observed` (a *proposal* shown as a "Needs You" card), or `unavailable`.

Policies are SHA-256 versioned; every decision and mandate records the policy version that authorized it; a policy change runs `policyEffects()` against open tasks.

> **Plan-time reconciliation with the repo (important).** Reading the codebase surfaced several spec/plan assumptions that do not match reality. They are corrected here and in a small spec amendment (see *Spec Amendments* below): there is **no `packages/` directory**; tenancy is **`workspace_id` + `app.current_workspace_id`** (not `project_id`); migrations are **node-pg-migrate `.js`** files; REST/contract schemas use **TypeBox**; and upstream has **no label/assignee filter** — those are a Graywolf addition layered into Stage 1.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+  
**Primary Dependencies**: `node:crypto`, `@sinclair/typebox` (all schemas), Fastify 5.x, `pg` via `withTenantContext`, existing `LiteLLMClient` (gateway), existing addon SDK (`createScopedRelayContext.onSignalAccepted`)  
**Storage**: PostgreSQL 16 (4 new tables + 1 new column on `tasks`), RLS by `workspace_id`  
**Testing**: Vitest — pure-core unit tests with in-memory repositories; PG integration test gated on `DATABASE_URL` reachability (same pattern as `tests/integration/db-rls.test.ts`)  
**Target Platform**: Linux server, Topology A (Pi 5 / 8 GB) compatible — no new daemons, no new queue  
**Project Type**: Backend domain module + Fastify routes + one migration  
**Performance Goals**: Stage 1 `< 5 ms` p99 (pure, in-memory policy snapshot); Assessor deadline per policy (`eval.timeoutSeconds`, default 120 s)  
**Constraints**: Core module imports only `node:crypto` + TypeBox + local files (enforced by a unit test); zero Cordis/DSH dependency; `mode` defaults to `observe`; no phantom tasks outside `auto`/promote  
**Scale/Scope**: 1 pure core (~9 files), 1 control-plane adapter layer (~5 files), 1 route file, 1 migration, 3 test suites

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay** — **PASS**. Firewall only decides *whether a task is created*; it never commits or touches git. `observe` is the default and creates nothing.
2. **Zero Runtime Lock-In & Permissive Licensing** — **PASS**. Upstream is MIT; ported as clean-room TypeBox code with attribution (`THIRD_PARTY_NOTICES.md`, task T001). No Cordis/DSH package imported.
3. **Single ACID Relational Baseline** — **PASS**. All state in PostgreSQL; no new store.
4. **Headless Execution & Observability** — **PASS**. Every trigger, disposition, decision, and policy version is an append-only audited row; metrics emitted via existing telemetry.
5. **Dual Mode (Greenfield/Brownfield)** — **PASS**. Brownfield blast-radius (`writable_scope`) is carried into `Mandate.scope`; a Mandate can never widen scope beyond project config.
6. **Virtual Developer Tier Handoff** — **PASS**. Admission precedes Dev-Level-1 planning; Assessor uses the `agent-router`-class alias, not a hard-coded provider.
7. **Chat as Active Control Plane** — **PASS**. `promote`/`dismiss`/`pause`/policy-write are RBAC-checked state-modifying calls (human actor required for `promote`); rejections use ADR-042 codes.
8. **Blast-Radius & Dependency Integrity** — **PASS**. `policyEffects()` implements the mid-flight rule: minor change → `task.inject` advisory; revoked authority → pause task (never silently continue).
9. **$0 Platform License** — **PASS**. Runs fully offline with a local Ollama Assessor alias; Stage 1 needs no model at all.

**Post-design re-check**: PASS. One justified deviation recorded in Complexity Tracking (separate `admission/core` sub-tree).

## Architecture

```text
 addon (github-issues, discord, slack…)
   │ relay.submitSignal(envelope)         ← existing: validate, sanitize, Valkey dedup
   ▼
 onSignalAccepted(envelope, xmlPayload)   ← NEW hook target: AdmissionService.receive()
   │
   ▼  signalToTrigger()  (adapter: envelope.meta → Trigger{source, scope, actor, addressed, human, threads})
 ┌──────────────────────── admission/core (pure, node:crypto only) ───────────────────────┐
 │ Intake.receive()  → dedupe(trigger.id) → SourceScope filter → record Trigger/Disposition │
 │        │ thread.pending[] ; one Evaluation per thread at a time (batching)                │
 │ Evals.start(thread)                                                                       │
 │   Stage 1  policy.gate(trigger, thread, owned) → {admissible,strength,basis} | reject     │
 │   Stage 2  assessor.assess(candidate)  (only strength==='inferred')                       │
 │            → policy.assessmentOutcome() → accept | ignore | ignore(observed) | unavailable│
 └──────────────────────────────────────────────────────────────────────────────────────────┘
   │ accept → TaskFactory.create(candidate, mandate)  → tasks.mandate (immutable) → QUEUED
   │ observed → signal_decisions row with proposal → Dashboard "Needs You"
   ▼
 policy PUT → policyVersion() → effects.apply(policyEffects(old,new,openTasks)) → task.inject / pause
```

### Module boundaries

| Layer | Path | May import | Responsibility |
|---|---|---|---|
| Pure core | `src/orchestrator/admission/core/` | `node:crypto`, `@sinclair/typebox`, siblings | model, ports, intake, evals, policy, matrix, ids, reasons |
| Adapters | `src/orchestrator/admission/` | core, `db`, `gateway`, `errors`, `addons` | PG repositories, signal adapter, context builder, Assessor, task factory, effects, views |
| HTTP | `src/orchestrator/routes/admission.ts` | admission, `auth/rbac`, `errors` | REST under `/api/v1/projects/:id/admission/*` |
| Schema | `migrations/<ts>_create-attention-firewall.js` | — | DDL + RLS |

## Source Code (repository root)

```text
src/orchestrator/admission/
├── core/
│   ├── model.ts            # T: Trigger, ThreadRef, Thread, Evaluation, Decision, Disposition, Mandate, MandateBasis, Strength (TypeBox + Static)
│   ├── ports.ts            # AdmissionPolicy, Assessor, TaskSink, Repository ports, Clock, SourceScope
│   ├── matrix.ts           # admission cells + defaults (ported from admission.ts)
│   ├── policy.ts           # Settings schema, policyVersion(), createPolicy(), gate(), revalidate(), policyEffects(), assessmentOutcome()
│   ├── intake.ts           # Trigger ingestion, dedupe, scope filter, thread correlation
│   ├── evals.ts            # Per-thread batching, deadlines, requeue×2, unavailable, pause shifting, policy-change re-eval
│   ├── reasons.ts          # Stable reason codes
│   └── index.ts
├── pg-repositories.ts      # withTenantContext-backed repos (+ in-memory twin in tests/helpers)
├── signal-adapter.ts       # GraywolfSignalEnvelope → Trigger (reads additive meta keys)
├── context-builder.ts      # threadWindow(): first 5 + ±5 around trigger, char cap, omission counts
├── assessor.ts             # LiteLLM single-shot structured call + TypeBox validation + 1 repair retry
├── task-factory.ts         # accept → tasks row + mandate (via existing task-store/state-machine)
├── effects.ts              # apply policyEffects(): task.inject advisory | pause
├── views.ts                # overview + needs-you projections
└── service.ts              # AdmissionService: wiring, pause, promote/dismiss, policy write

src/orchestrator/prompts/admission-assessor.md   # system prompt (ported intent from prompts/admission.md)
src/orchestrator/routes/admission.ts
src/orchestrator/addons/builtin/github-issues-signal.ts   # additive meta: actor, assignees, labels, thread, addressed (T-adapter task)
migrations/<ts>_create-attention-firewall.js
THIRD_PARTY_NOTICES.md

tests/
├── unit/admission-core.test.ts            # gate matrix, strength, revalidate, policyVersion, policyEffects, assessmentOutcome
├── unit/admission-evals.test.ts           # batching, requeue×2, unavailable, pause shift, policy re-eval
├── unit/admission-context-and-assessor.test.ts
├── unit/admission-core-purity.test.ts     # asserts core imports ⊆ {node:crypto, @sinclair/typebox, ./*}
└── integration/attention-firewall-api.test.ts   # RBAC, RLS, promote/dismiss/pause, observe→no task
```

## Key Design Decisions (summary; full rationale in `research.md`)

| # | Decision | Why |
|---|---|---|
| D1 | `src/orchestrator/admission/` (+ `core/` purity boundary), not `packages/agent-runtime` | No `packages/` workspace exists; creating one is out of scope and risky |
| D2 | TypeBox everywhere (port upstream zod 4 → TypeBox) | Repo convention across 19 phases; avoids dual-schema stack |
| D3 | RLS on `workspace_id` / `app.current_workspace_id`; `project_id` as scoping column | Matches `tasks`, `llm_calls`, etc. and `withTenantContext` |
| D4 | Policy stored versioned in `signal_policies`; `projects.config_json` unchanged | Needs history for audit and `policyEffects()`; config_json is mutable |
| D5 | Observe = Decision `{verdict:'ignore', reason:'observed', proposal}`; **no** new entity | Upstream-verified; zero phantom tasks (SC-004) |
| D6 | Batching via `thread.pending` + one Evaluation/thread (`Evals.start`) | Free in ported core; replaces separate batching feature |
| D7 | Assessor = tool-less single-shot, host-built window, schema-validated, **1** repair retry | Upstream's router session has read tools; ours must not (prompt-injection blast radius) |
| D8 | Eval timeout from policy (`eval.timeoutSeconds`, 30–600, default 120); requeue ×2 then `unavailable` | Upstream-faithful; spec's flat 15 s was wrong for LLM + context fetch |
| D9 | Label/assignee filters are a Graywolf **addition** in Stage 1 `SourceScope` config, not upstream behavior | Upstream's "Mohamed" demo was a natural-language rule, not code; code-level filter is cheaper and deterministic |
| D10 | Hook at `onSignalAccepted`; extend envelope via **additive `meta` keys** only | No SDK breaking change; existing addons keep working (they default to `strength: inferred`, unlisted/unaddressed → `ignore`) |
| D11 | Silent failure is forbidden: every rejection writes a Disposition/Decision with a reason code | Upstream philosophy ("a failure is reported as a failure"); auditability (Constitution 4) |

## Task Mapping (feeds `/speckit-tasks`)

- **Task 20.1** → `core/*` (model, ports, matrix, intake, evals, reasons), `context-builder.ts`, `assessor.ts`, `prompts/admission-assessor.md`, `signal-adapter.ts`, tests `admission-core`, `admission-evals`, `admission-context-and-assessor`, `admission-core-purity`.
- **Task 20.2** → `core/policy.ts`, migration, `pg-repositories.ts`, `task-factory.ts`, `effects.ts`, `views.ts`, `service.ts`, `routes/admission.ts`, `THIRD_PARTY_NOTICES.md`, addon meta change, tests `attention-firewall-api`.

## Spec Amendments Applied Alongside This Plan

| Spec text | Amended to | Reason |
|---|---|---|
| RLS `project_id = current_setting('app.current_project_id')` | `workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID`, `FORCE ROW LEVEL SECURITY` | Matches migration `1789444040216` |
| Core in `packages/agent-runtime/src/admission/` | `src/orchestrator/admission/core/` | No `packages/` exists |
| FR-004 "15s deadline" | policy `eval.timeoutSeconds` (default 120 s, 30–600) | Upstream `EvalConfigSchema`; LLM + context latency |
| FR-002 "max 4,000 tokens" | message-count window (5 + ±5) **and** `promptMaxChars` cap | Upstream is count-based; char cap bounds tokens deterministically |
| `target_basis: string` (plan v3 artifact) | enum `specified \| existing-standard \| undetermined` | Upstream `AdmissionDirectionSchema` |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected |
|---|---|---|
| `admission/core/` sub-tree with a purity test | Preserves the upstream-validated framework-free domain so its vitest cases can be ported as oracles | Flat module mixing PG/LiteLLM imports would make core untestable without mocks and would erode the ADR-038 clean-room boundary |

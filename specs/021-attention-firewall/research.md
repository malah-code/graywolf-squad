# Architectural Research & Decisions: Attention Firewall & Two-Stage Signal Admission (`021-attention-firewall`)

**Date**: 2026-11-05  
**Spec Reference**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/021-attention-firewall/spec.md)  
**Primary Source Reference**: `reference-opensources/dsh-superagent-prototype-main` (MIT License, DeepSeek AI)  
**Status**: Completed

---

## 1. Clean-Room Module Boundary & Repository Layout (Decision D1)

- **Context**: The preliminary plan draft referenced `packages/agent-runtime/src/admission/`. Inspection of Graywolf Squad's codebase shows that Graywolf is a cohesive monorepo rooted at `src/orchestrator/`, `src/dashboard/`, and `src/relay/`, with no `packages/` directory configured in `pnpm-workspace.yaml`.
- **Decision**: Place the admission engine under `src/orchestrator/admission/`, with a pure, isolated domain core in `src/orchestrator/admission/core/`.
- **Rationale**: 
  - Preserves the clean-room architecture of DeepSeek's `src/core/` (only importing `node:crypto` and TypeBox).
  - Eliminates the need to restructure the monorepo root or add a new workspace package, avoiding regressions in tsconfig, build scripts, or Dockerfiles.
  - A purity test (`tests/unit/admission-core-purity.test.ts`) verifies AST imports in `src/orchestrator/admission/core/` to guarantee zero dependency leaks.
- **Alternatives Considered**:
  - *Creating `packages/agent-runtime`*: Rejected as unnecessary architectural churn that breaks existing build workflows and container setups.
  - *Inlining admission logic directly into `src/orchestrator/services/`*: Rejected because coupling the pure matrix and evaluation state machine with database queries prevents using upstream vitest fixtures as clean unit test oracles.

---

## 2. Schema Framework: TypeBox vs Zod (Decision D2)

- **Context**: Upstream `dsh-superagent-prototype` uses Zod 4 for schemas (`src/policy.ts`). Graywolf Squad standardizes on `@sinclair/typebox` across Phases 0–19 (used in Fastify validation, ACI schemas, task schemas, and addon manifests).
- **Decision**: Implement all admission schemas, policy types, and LiteLLM Assessor structured output definitions using `@sinclair/typebox`.
- **Rationale**:
  - Consistent developer experience and single-schema paradigm across all Fastify routes and internal contracts.
  - TypeBox offers superior compilation performance (JSON Schema compilation) compared to runtime Zod parsing.
  - Porting from Zod to TypeBox is straightforward: `z.object()` $\rightarrow$ `Type.Object()`, `z.enum()` $\rightarrow$ `Type.Union([Type.Literal(...)...])`.
- **Alternatives Considered**:
  - *Keeping Zod for admission and TypeBox for Fastify*: Rejected. Having two validation libraries in the same service causes confusion and dual type definitions.

---

## 3. Database Multitenancy & Row-Level Security (Decision D3)

- **Context**: The preliminary plan drafted RLS policies on `project_id = current_setting('app.current_project_id')`. However, inspection of `migrations/1789444040216_create-tasks-table.js` and `src/orchestrator/db/index.ts` proves that Graywolf's canonical tenant boundary is `workspace_id`, and `withTenantContext` sets `app.current_workspace_id`.
- **Decision**: All four new admission tables (`signal_policies`, `signal_threads`, `signal_triggers`, `signal_decisions`) include `workspace_id UUID NOT NULL REFERENCES workspaces(id)` and `project_id UUID NOT NULL REFERENCES projects(id)`. RLS is strictly enforced on `workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID` with `FORCE ROW LEVEL SECURITY`.
- **Rationale**:
  - 100% architectural consistency with all existing tables (`tasks`, `task_artifacts`, `llm_calls`, `secret_vault`, `addon_registry`).
  - Guarantees complete cross-tenant isolation and seamless integration with `withTenantContext({ workspaceId, orgId }, ...)`.
- **Alternatives Considered**:
  - *Introducing `app.current_project_id`*: Rejected because it would require modifying `withTenantContext`, connection pool handling, and auth middlewares across the entire system.

---

## 4. Policy Versioning & Storage Strategy (Decision D4)

- **Context**: Policies contain active rules, sender allowlists, source configs, and evaluation modes (`off`, `observe`, `auto`).
- **Decision**: Store policies in an append-only versioned table `signal_policies` with a canonical SHA-256 hash `version_hash`. Every policy mutation inserts a new row and updates `is_active = true` within a transaction.
- **Rationale**:
  - Guarantees complete cryptographic auditability: every task's `mandate` records `policyVersion: '<hash>'`, enabling retrospective inspection of the exact rules active at creation time.
  - Enables `policyEffects(oldPolicy, newPolicy, openTasks)` to compute precise diffs and dispatch targeted `task.inject` notices.
- **Alternatives Considered**:
  - *Storing policy inside `projects.config_json`*: Rejected because `config_json` is an unversioned blob that would lose historical policy auditability.

---

## 5. Observe Mode Proposal Storage (Decision D5)

- **Context**: In DeepSeek's video demonstration (`RcwMwtnkQbc`), unprompted/inferred tasks appear in an audit dashboard before execution. The preliminary design considered creating phantom `Task` records in state `OBSERVED`.
- **Decision**: Adopt upstream's exact pattern: Observe mode outputs `Decision { kind: 'ignore', reason: { code: 'observed' }, audit: { would_accept: true, proposal: { title, scope, worktree_name } } }`. It does NOT create a row in `tasks`.
- **Rationale**:
  - Prevents queue congestion, phantom UUIDs, and accidental execution of unconfirmed tasks.
  - The Cockpit dashboard queries `GET /api/v1/projects/:id/admission/decisions?kind=observed` to display the "Needs You" card.
  - When promoted by a human via `POST .../decisions/:id/promote`, the system creates a true `Task` with `mandate.basis.via = 'manual'`.
- **Alternatives Considered**:
  - *Creating tasks with status `OBSERVED`*: Rejected because it pollutes task state machines, metrics, and worktree directories with non-executing entities.

---

## 6. High-Frequency Trigger Ingestion & Per-Thread Batching (Decision D6)

- **Context**: External webhook storms (e.g. 10 rapid comments on an issue) can trigger repetitive LLM evaluations and DoS the admission gateway.
- **Decision**: Port upstream `Evals.start()` per-thread buffering:
  - If a thread has no active evaluation, start evaluating immediately.
  - If an evaluation is already running for that thread, queue new incoming triggers in `thread.pending`.
  - Upon completion or next tick, coalesce all queued triggers for that thread into a single batched `Evaluation` run, taking the strongest trigger (`explicit` > `inferred`) as primary.
- **Rationale**:
  - Validated by DeepSeek benchmarks: coalescing bursts reduced decision latency under load from 6.4s to 1.6s and cut LLM calls by >60%.
- **Alternatives Considered**:
  - *External Redis/Valkey debouncer queue*: Rejected because in-memory per-thread state machine in `Evals` handles this cleanly with zero external queue overhead.

---

## 7. Bounded Context Window Builder vs Tool-Calling Assessor (Decision D7)

- **Context**: Upstream's prototype gave the router session read tools (`dsh-tools`). In Graywolf, granting tool execution privileges to an unauthenticated/unadmitted webhook handler violates the principle of least privilege and opens prompt-injection vectors.
- **Decision**: The Assessor is a **tool-less, single-turn LiteLLM completion** operating over a bounded message window built host-side by `threadWindow()` (`admission-context.ts`):
  - First 5 messages of the thread (root context).
  - Up to 5 messages immediately preceding and following the trigger.
  - Strict JSON schema constraint with TypeBox validation.
  - 1 automatic repair retry if JSON schema parsing fails.
- **Rationale**:
  - Structurally eliminates tool-calling prompt injection at the admission perimeter.
  - Bounds token consumption to $< 4,000$ characters of context.
- **Alternatives Considered**:
  - *Full multi-turn tool-calling router agent*: Rejected for security and cost reasons. Triage must be deterministic, bounded, and fast.

---

## 8. Assessor Timeout & Fault Tolerance (Decision D8)

- **Context**: External LLM providers or LiteLLM routing may experience transient 5xx errors or network delays.
- **Decision**:
  - Use `eval.timeoutSeconds` from policy (default 120s, bounds 30–600s).
  - Upstream 2× requeue policy: on timeout or transient error, requeue the trigger up to 2 times.
  - On the 3rd consecutive failure, record `verdict: 'unavailable'`, `reason_code: 'timeout'`, and log disposition without throwing unhandled exceptions.
  - Pausing intake (`POST .../admission/pause`) shifts the deadline of all currently running evaluations by `pause_duration_ms`.
- **Rationale**:
  - Prevents transient gateway hiccups from permanently dropping important human requests while ensuring stalled evaluations do not leak memory.

---

## 9. Stage 1 Ignored Assignees & Label Gate (Decision D9)

- **Context**: In Video 2, the presenter highlighted the need to stop the agent from hijacking tickets assigned to human developers (e.g. "Mohamed").
- **Decision**: Layer deterministic assignee and label checks directly into Graywolf's Stage 1 `SourceScope` evaluation before matrix lookup:
  - `ignored_assignees: string[]` (e.g. `["mohamed"]`).
  - `excluded_labels: string[]` (e.g. `["needs-human", "wontfix"]`).
  - `required_labels?: string[]`.
  - Matches instantly drop the trigger with `disposition: 'dropped'` and `reason_code: 'ignored_assignee' | 'excluded_label'` at 0 token cost.
- **Rationale**:
  - Guarantees 0-token deterministic exclusion, outperforming fuzzy LLM prompt instructions.

---

## 10. Addon SDK Hook Integration Point (Decision D10)

- **Context**: Signals arrive through `@graywolf/addon-sdk` via `relay.submitSignal(envelope)`.
- **Decision**: Wire the Attention Firewall into `createScopedRelayContext` via the existing `onSignalAccepted` callback. Add additive optional metadata fields to `GraywolfSignalEnvelope['meta']`:
  - `authorHandle?: string`
  - `assignees?: string[]`
  - `labels?: string[]`
  - `threadId?: string`
  - `isDirectMention?: boolean`
- **Rationale**:
  - Non-breaking backwards compatibility: existing addons continue to function seamlessly. Triggers without explicit handles default safely to unlisted/unaddressed `ignore`.

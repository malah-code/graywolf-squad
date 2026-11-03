# Feature Specification: Attention Firewall & Two-Stage Signal Admission

**Feature Branch**: `021-attention-firewall`  
**Created**: 2026-11-02  
**Status**: Draft  
**Input**: User description: "Phase 20 — Attention Firewall: Two-Stage Signal Admission, Versioned Policy, Task Mandates & 'Needs You' Proposals (specs/021-attention-firewall): Implement the Phase 20 Attention Firewall inspired by DeepSeek's dsh-superagent-prototype core engine, protecting human cognitive attention and container compute from signal overload. Incorporates zero-token deterministic gate filtering, bounded LLM context-window evaluation (admission-context), immutable cryptographically-versioned Mandate grants, and a non-disruptive observe mode with a 'Needs You' dashboard review card."

## Clarifications

### Session 2026-11-02

- Q1: How should "Observe" mode store proposals without polluting the task queue with phantom jobs? → A (Recommended): Per `dsh-superagent-prototype`'s `policy.ts`, observe mode does NOT create phantom tasks. It generates a `Decision` record with `verdict: 'ignore'`, `reason_code: 'observed'`, and an embedded `proposal: { title, scope, worktree_name }`. The dashboard renders these directly from the `signal_decisions` table as a "Needs You / Observed Proposals" card.
- Q2: How should rapid incoming triggers on the same thread (e.g. 5 comments in 10 seconds) be handled to avoid duplicate evaluation calls? → A (Recommended): Adopt upstream `Evals.start()` per-thread buffering: when a thread is currently in state `evaluating`, all incoming triggers on that thread are appended to `thread.pending`. When evaluation completes or starts, the entire pending queue coalesces into a single evaluation batch, selecting the strongest trigger (`explicit` > `inferred`) as primary.
- Q3: What happens when the LiteLLM Assessor times out or errors during Gate 5 evaluation? → A (Recommended): Enforce upstream's 2× requeue policy: the trigger is re-queued up to twice with backoff. If it expires or fails a third time, record `verdict: 'unavailable'`, `reason_code: 'timeout'`, and safely drop the trigger without crashing the intake pipeline.
- Q4: When a project administrator updates an active policy, how are currently running tasks and evaluations handled? → A (Recommended): Upstream `policyEffects()` calculates a deterministic diff between the old and new policy. If an active task's mandate basis is invalidated (e.g. requester removed from allowlist, rule disabled), the orchestrator issues a `task.inject` advisory message to the container or marks the task paused. Running evaluations are re-queued to re-evaluate against the new policy hash.
- Q5: How should the Assessor prompt build its conversation context without blowing model context limits or leaking unrelated chatter? → A (Recommended): Port `admission-context.ts` bounded window: extract the first 5 messages of the thread (root issue description / initial brief) + up to 5 messages immediately preceding and following the trigger event, bounded to at most 4,000 tokens total.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deterministic Gate Matrix & Two-Stage Signal Admission (Priority: P1)

An engineering team wants incoming webhooks (GitHub issues, comments, mentions, Slack signals) to pass through a zero-token deterministic gate first so that noisy bots, tickets assigned to human teammates (e.g. "Mohamed"), and forbidden labels are instantly dropped without invoking any LLMs, while ambiguous or inferred requests pass to a bounded LiteLLM Assessor (Gate 5) that evaluates them against natural-language rules with strict JSON schema outputs.

**Why this priority**: Directly implements the Attention Scarcity Rule. Benchmarks demonstrate that a two-stage filter reduces unnecessary LLM calls by >85% and cuts decision latency under high load from 6.4s down to 1.6s via batching.

**Independent Test**: Can be independently tested by sending simulated webhooks (explicit human @mentions, bot messages, tickets assigned to ignored assignees, and ambiguous comments) and verifying that deterministic rules drop forbidden items with zero LLM tokens, while valid ambiguous items trigger a single bounded LiteLLM assessment.

**Acceptance Scenarios**:

1. **Given** an active signal policy with `ignored_assignees: ["mohamed"]` and `excluded_labels: ["needs-human"]`, **When** a GitHub issue webhook arrives assigned to "mohamed" or carrying label "needs-human", **Then** the deterministic gate drops the trigger immediately with `disposition: 'dropped'` and `reason_code: 'ignored_assignee'` without making any LLM call.
2. **Given** an incoming comment on an unlisted thread where the agent is not tagged but a bug is described (`strength: 'inferred'`), **When** evaluated by the Attention Firewall in `mode: 'observe'`, **Then** the system builds a bounded context window (first 5 root messages + ±5 around trigger), invokes the LiteLLM Assessor, and records a `Decision` with `verdict: 'ignore'`, `reason_code: 'observed'`, and a populated `proposal` object.
3. **Given** 4 rapid comment triggers arriving on the same GitHub issue within 3 seconds while the thread is `evaluating`, **When** the intake pipeline runs, **Then** all 4 triggers coalesce into `thread.pending` and are evaluated in a single batched `Evaluation` record, linking the batched trigger IDs.

---

### User Story 2 - Cryptographically Versioned Policy Engine, Task Mandates & Live Diffing (Priority: P1)

A team lead wants every accepted task to carry an immutable, cryptographically verifiable `Mandate` (`policyVersion`, `basis`, `actor`, `scope`, `maxBudgetUsd`), wants all policy updates to compute a deterministic SHA-256 version hash, and wants the orchestrator to automatically compute `policyEffects()` when a policy changes, notifying or pausing live tasks whose authorization was altered.

**Why this priority**: Guarantees clear authority and blast-radius boundaries. If an agent begins running code, an auditor can trace the exact policy snapshot and human actor that authorized the run.

**Independent Test**: Can be independently tested by creating a policy, modifying its rules (generating a new SHA-256 hash), verifying that accepted tasks store an immutable `mandate` JSONB object, and testing that `policyEffects()` detects invalidated running tasks and dispatches `task.inject` notices.

**Acceptance Scenarios**:

1. **Given** an accepted candidate trigger evaluated under policy hash `e3b0c44...`, **When** the task is created in PostgreSQL `tasks`, **Then** `tasks.mandate` contains an immutable JSONB structure including `mandateId`, `policyVersion: 'e3b0c44...'`, `strength`, `scope`, and `basis`.
2. **Given** a policy update that disables a rule previously granting autonomous bug fixes, **When** the new policy is saved, **Then** `policyEffects(oldPolicy, newPolicy, activeTasks)` identifies active tasks authorized under that rule and issues a `task.inject` warning message to the active agent containers.
3. **Given** an active task resuming execution after a human comment, **When** `revalidate(mandate)` is called, **Then** the engine checks whether the current policy still permits execution for that mandate basis, rejecting resumption if the actor was revoked.

---

### User Story 3 - "Needs You" Proposal Triage Dashboard & Control Plane REST APIs (Priority: P2)

A developer wants to view an overview of signal traffic, inspect observed proposals in a "Needs You" dashboard card, and promote an observed proposal into a real executing task with one click (or dismiss it with feedback), as well as temporarily pause signal intake when the squad is over capacity.

**Why this priority**: Closes the loop on "Observe" mode. Developers can audit the agent's intent proposals without letting the agent touch code until trust is established.

**Independent Test**: Can be independently tested by calling `GET /api/v1/projects/:id/admission/overview`, listing observed decisions via `GET /api/v1/projects/:id/admission/decisions?kind=observed`, promoting one via `POST .../promote` (verifying task creation), and triggering `POST .../pause` (verifying deadline extension).

**Acceptance Scenarios**:

1. **Given** 3 observed proposals stored in `signal_decisions`, **When** the frontend queries `GET /api/v1/projects/:id/admission/decisions?kind=observed`, **Then** the API returns the list of proposals with their suggested title, scope, intent evidence quote, and confidence scores.
2. **Given** an observed proposal with ID `dec_123`, **When** the user calls `POST /api/v1/projects/:id/admission/decisions/dec_123/promote`, **Then** the system creates a new task in `tasks` with an explicit mandate (`basis.via = 'manual'`), marks the decision promoted, and returns the created `taskId`.
3. **Given** incoming triggers during an active pause window initiated via `POST /api/v1/projects/:id/admission/pause` (`duration_ms: 60000`), **When** new triggers arrive, **Then** evaluations are held and all running evaluation deadlines are shifted by 60,000ms.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST implement a Stage 1 Deterministic Gate checking actor allowlists, ignored assignees, required labels, excluded labels, and admission matrix classifications (`listedUnaddressed`, `unlistedAddressed`, `unlistedUnaddressed`) with 0 token consumption.
- **FR-002**: The system MUST implement a Stage 2 LiteLLM Assessor (Gate 5) using a bounded context window (first 5 root messages + ±5 messages around the trigger, max 4,000 tokens) with strict JSON schema validation for `AdmissionDirectionSchema`, `RuleAssessmentSchema`, and `IntentEvidenceSchema`.
- **FR-003**: The system MUST coalesce rapid triggers arriving on the same thread into `thread.pending` and evaluate them in a single batched `Evaluation` run.
- **FR-004**: The system MUST handle Assessor timeouts (15s deadline) by requeuing triggers up to 2 times, recording `verdict: 'unavailable'` on the 3rd failure without crashing intake.
- **FR-005**: The system MUST support three admission policy modes: `off` (reject all inferred triggers), `observe` (record `Decision{kind:'ignore', reason:'observed', proposal}`), and `auto` (issue `Mandate` and create task).
- **FR-006**: The system MUST compute a deterministic SHA-256 hash for every policy revision and store immutable `mandate` JSONB metadata on created tasks.
- **FR-007**: The system MUST provide `policyEffects()` diffing that identifies running tasks affected by policy revisions and dispatches `task.inject` notifications.
- **FR-008**: The system MUST expose Fastify REST APIs for policy management, overview metrics, decision triage (`promote`, `dismiss`), and soft pause control with PostgreSQL Row-Level Security (RLS) enforcement.

---

## Success Criteria

- **SC-001**: 100% of deterministic gate rules (actor allowlists, assignees, labels) execute in `< 5ms` with zero external network or LLM token overhead.
- **SC-002**: Coalescing multi-trigger threads reduces LLM evaluation calls by $\ge 60\%$ during simulated webhook bursts (10 triggers across 2 threads resulting in $\le 2$ evaluation calls).
- **SC-003**: All accepted tasks contain valid, schema-compliant `mandate` objects verifiable against the authoring policy's SHA-256 hash.
- **SC-004**: Zero phantom tasks or unrequested container launches occur when policy is set to `mode: 'observe'`.

---

## Assumptions & Dependencies

- **Database**: PostgreSQL 16 with Row-Level Security (`project_id = current_setting('app.current_project_id')::uuid`).
- **LLM Gateway**: LiteLLM proxy configured with router model alias for Gate 5 structured assessment.
- **Framework Cleanliness**: Core admission domain in `packages/agent-runtime/src/admission/` MUST depend only on `node:crypto` and standard TypeScript / Zod schemas; zero Cordis runtime dependencies.


# Implementation Plan: End-to-End Browser QA Engine (`@playwright/test`) & Parallel Bug Bash Sprint

**Branch**: `015-e2e-playwright-and-bug-bash` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/015-e2e-playwright-and-bug-bash/spec.md`

## Summary

Implement Phase 13 of the Graywolf Squad master plan (`docs/implementation-plan-detailed.md` Tasks 13.1–13.4):
1. **Semantic Locator Authoring Guard & Hybrid Intent Runtime (`src/orchestrator/e2e/authoring-guard.ts`, `src/orchestrator/e2e/intent-runtime.ts`, Task 13.1)**:
   - `evaluateE2eAuthoringGuard` enforcing semantic Playwright locators (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByTestId`) and rejecting brittle CSS/XPath selectors in Dev-Level-3 test diffs.
   - Multi-signal financial/billing/tax scope detection with fail-closed Anti-Self-Grading rule (deterministic `expect(...)` required on financial scope tasks).
   - `IntentRuntime` routing `agent.act`, `agent.assert`, `agent.waitFor`, `agent.extract` strictly through internal `LiteLLMClient`, enforcing preview-origin lock-on and `<untrusted_browser_observation>` tagging per ADR-077 / ADR-038.
2. **Zero-Token Deterministic Cache-Replay Engine (`src/orchestrator/e2e/cache-replay.ts`, Task 13.2)**:
   - `E2eCacheReplayEngine` storing cached `agent.act` steps in `.agents/tasks/<TASK_ID>/e2e-cache/`, using `stepKey = SHA-256(normalizedRoute + '|' + action + '|' + sanitize(intent))`, replaying matching steps with `0` LLM tokens, falling back to live `IntentRuntime` turn on DOM drift without mutating `.agents/cache/e2e/`, and promoting entries to the project baseline on task `MERGED`.
3. **Visual Review Packets & `e2e explore` Smoke Gate (`src/orchestrator/e2e/visual-packet.ts`, `src/orchestrator/e2e/explore-smoke.ts`, Task 13.3)**:
   - `buildVisualReviewPacket` capturing HTML reports, console error logs, masked `pixelmatch` screenshot diffs (≥0.1% mismatched pixel ratio is a regression), and WebM video traces under `.agents/tasks/<TASK_ID>/review/` with `cached | live` provenance.
   - `runExploreSmokeGate` executing the bounded 4th-pass smoke gate for `ui`, `api-surface`, and `mandatory-e2e` tasks (`maxTurns: 6`, `timeoutMs: 180_000`, `spendLimitUSD: $0.50`), recording `browser-test` evidence, and enforcing "No Repro, No Bug" attribution (stack trace ∩ `changes.patch`).
4. **Parallel Bug Bash Sprint (`src/orchestrator/delivery/bug-bash.ts`, Task 13.4)**:
   - `planBugBashSprint` fanning out `qa-explore-<area>` children (`maxExplorers: 8` Standard/Enterprise, `1` Constrained), with `effectiveExplorers * $0.50` aggregate budget governor and PageRank/risk-sorted priority for excess combinations.
   - `confirmBugBashFinding` classifying findings (`CANDIDATE` → `qa-repro-<issue>` → `CONFIRMED` (+ `fix:<issue>` backlog task) | `UNCONFIRMED` (P2 advisory)) with budget-cap event emission and remaining-explorer cancellation.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+  
**Primary Dependencies**: `@playwright/test`, `@sinclair/typebox`, `pixelmatch`, `SHA-256 (node:crypto)`, `LiteLLMClient` (Phase 8 LiteLLM proxy), `EvidenceLedger` (Phase 10), `pagerank.ts` (Phase 9), `wrapUntrustedBrowserObservation` (Phase 9)  
**Storage**: Filesystem (`.agents/tasks/<TASK_ID>/e2e-cache/`, `.agents/cache/e2e/`, `.agents/tasks/<TASK_ID>/review/`); PostgreSQL `decision_gate` table (read-only consumer of Gate 3 / Gate 4 decisions, optional)  
**Testing**: Vitest (`tests/unit/e2e-authoring-guard.test.ts`, `tests/unit/e2e-cache-replay.test.ts`, `tests/unit/e2e-explore.test.ts`, `tests/unit/bug-bash.test.ts`)  
**Target Platform**: Fastify Control Plane API (`src/orchestrator/*`); browser engine run inside containerized Chromium (per ADR-077 session isolation)  
**Project Type**: Backend orchestrator QA subsystems (e2e authoring guard, cache-replay, visual review packet, explore smoke gate, bug bash sprint)  
**Performance Goals**: Cache hit `< 50ms` step replay; explore smoke gate `<= 180s` wall-clock per task; visual pixel diff diff computation `< 500ms` per page; Conformant to constant-time challenge: `stepKey` sharded by route-normalized hash for O(1) lookup.  
**Constraints**: ADR-027 zero external SaaS sync (no `@tester-army/cli`); ADR-075 Anti-Self-Grading on financial scope; ADR-076 budget caps (`6 / 180s / $0.50`); ADR-078 budget governor; ADR-038 prompt-injection safeguard on all browser observations  
**Scale/Scope**: 5 source modules (`authoring-guard.ts`, `intent-runtime.ts`, `cache-replay.ts`, `visual-packet.ts`, `explore-smoke.ts`, `delivery/bug-bash.ts`) + 4 comprehensive test suites; integrates with Phase 8 (LiteLLM), Phase 9 (PageRank, untrusted tag), Phase 10 (EvidenceLedger), Phase 11 (review packet Section 6), Phase 12 (BrowserTab)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: PASS — Bug Bash Sprint auto-creates only `fix:<issue>` backlog tasks (subject to human approval before execution) and never merges or pushes autonomously; "No Repro, No Bug" attribution makes strike attribution strictly evidence-based.
- **Principle 2 (Zero Runtime Lock-In & Permissive Licensing)**: PASS — Playwright (Apache-2.0), `pixelmatch` (MIT), `tester-army/e2e` (Apache-2.0 spike); zero `@tester-army/cli` SaaS dependency; Spike-First ADR-067 plugin isolation allows forward-compatible fallback to native pattern extraction if pre-1.0 instability emerges.
- **Principle 3 (Single ACID Relational & Vector Baseline)**: PASS — All cache files live in the existing Postgres-backed `<worktree>/.agent_evidence.db` ledger; no new persistent store introduced.
- **Principle 4 (Headless Execution & Observability)**: PASS — Every cache hit/miss/fallback, explore turn, and budget cap event is recorded as a `browser-test` / structured log event; OTel GenAI conventions preserved via LiteLLMClient invocation.
- **Principle 5 (Dual Operational Mode: Greenfield & Brownfield)**: PASS — Anti-Self-Grading rule unconditionally enforces deterministic assertions on financial scope regardless of mode.
- **Principle 6 (Virtual Developer Tier Handoff Protocol)**: PASS — `e2e explore` is strictly additive 4th-pass after Dev-Level-2 3-pass debate (ADR-056); explore findings never bypass mandatory adversarial review on Strike 2.
- **Principle 7 (Chat as Active Control Plane — Cockpit Rule)**: PASS — Bug Bash questions (`"what did the bug bash find in checkout?"`) are queryable via the Chat Agent tool-calling interface per ADR-004; results return a tool-call card.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: PASS — AuthoringGuard respects the project `writable`/`readonly`/`forbidden` blast-radius taxonomy through the `constitution-loader` (Phase 9) when reporting violations.
- **Principle 9 (Zero-Cost Open Source Foundation)**: PASS — 100% MIT/Apache-2.0 stack; Topology A Constrained Profile (`maxExplorers: 1`) enables offline operation; Explore smoke caps guarantee ≤$0.50/task; cache hits cost zero.

## Project Structure

### Documentation (this feature)

```text
specs/015-e2e-playwright-and-bug-bash/
├── spec.md              # Feature specification (FR-001..FR-006, SC-001..SC-004)
├── plan.md              # This technical implementation plan
├── research.md          # Technical decisions for authoring guard, cache-replay, visual packet, explore smoke, bug bash
├── data-model.md        # Domain models (E2eAuthoringGuardResult, CachedIntentStep, VisualReviewPacket, ExploreFinding, NoReproAttributionResult, BugBashSprintPlan, BugBashIssueResolution)
├── quickstart.md        # Verification commands and test scenarios
├── checklists/
│   └── requirements.md  # Specification quality checklist (16/16 pass — already converged)
└── contracts/
    └── e2e-and-bug-bash.md # API and component contracts
```

### Source Code (repository root)

```text
src/orchestrator/e2e/
├── authoring-guard.ts          # Task 13.1a: Semantic locator + Anti-Self-Grading (FR-001)
├── intent-runtime.ts           # Task 13.1b: agent.act/assert/waitFor/extract via LiteLLM (FR-002)
├── cache-replay.ts             # Task 13.2:  Zero-token deterministic cache-replay engine (FR-003)
├── visual-packet.ts            # Task 13.3a: HTML reports + pixelmatch + WebM (FR-004)
└── explore-smoke.ts            # Task 13.3b: Bounded 4th pass "No Repro, No Bug" (FR-005)

src/orchestrator/delivery/
└── bug-bash.ts                 # Task 13.4: Parallel `qa-explore-<area>` fan-out & confirmation (FR-006)

tests/unit/
├── e2e-authoring-guard.test.ts # Task T002: AuthoringGuard unit tests
├── e2e-cache-replay.test.ts    # Task T004: Cache-replay unit tests (cache miss/hit/dom-drift/merge promotion)
├── e2e-explore.test.ts         # Task T007: Visual packet + bounded explore smoke tests
└── bug-bash.test.ts            # Task T010: Bug bash sprint tests (8 vs 1 profile, repro confirmation)
```

**Structure Decision**: Matches the exact file paths specified in `docs/implementation-plan-detailed.md` §2 Canonical Repository Target Layout and Phase 13 Tasks 13.1–13.4.

## Complexity Tracking

No Constitution violations or complexity exceptions required.

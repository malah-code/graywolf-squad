# Requirements Quality Checklist: LiteLLM Gateway, Circuit Breaker & Token Spend Governance

**Purpose**: Reviewer-owned requirements-quality audit of Phase P8 (`specs/010-litellm-gateway-and-spend/`) — independent of the auto-generated `requirements.md` (Step 6 lifecycle) and focused on **Completeness, Clarity, Consistency, Coverage, Edge Cases, NFRs, Dependencies/Assumptions, Ambiguities** rather than implementation behavior.
**Created**: 2026-10-25
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/gateway-and-spend.md](../contracts/gateway-and-spend.md)
**Review Ownership**: Reviewer-owned artifact. Mark `[x]` only when the reviewer confirms the requirement-quality criterion is satisfied. Items do **not** indicate implementation completeness.
**Marker Semantics**: Each item ends with one of `[Spec §X]` / `[Gap]` / `[Ambiguity]` / `[Conflict]` / `[Consistency]` / `[Measurability]` / `[Traceability]` / `[Dependency]` / `[Assumption]` / `[Coverage]` / `[NFR]` / `[Edge Case]` / `[Completeness]` / `[Clarity]`. ≥80% of items must retain a traceability reference (per `/speckit-checklist` policy).

---

## Requirement Completeness

- [ ] CHK001 — Are timeout / network-error classifications (connect timeout, read timeout, ECONNREFUSED, DNS failure) explicitly enumerated as transient or non-transient so the circuit breaker has an unambiguous policy? [Completeness, Gap, Spec §FR-002, Contracts §1]
- [ ] CHK002 — Is the daily-spend cap scope explicitly assigned to one of workspace / project / organization (the spec says "project or organization" — ambiguous)? [Completeness, Gap, Spec §FR-005 / §Story 2 §5]
- [ ] CHK003 — Is the retry policy for the gateway client specified (auto-retry vs single-shot, max attempts, backoff)? [Completeness, Gap, Spec §FR-001 / §FR-002]
- [ ] CHK004 — Are non-context-window 4xx errors (401 unauthorized, 408 timeout, 413 payload, 422 validation) explicitly classified as transient / non-transient / silent? [Completeness, Gap, Spec §FR-003]
- [ ] CHK005 — Is the list "local providers" (`ollama` / `vllm` / `llamacpp`) defined as a closed enum or open allow-list — and where is the allow-list maintained? [Completeness, Spec §FR-004, Data-model §1.1]
- [ ] CHK006 — Is the behavior on ledger-write failure (DB error, transaction rollback) specified — does the upstream call succeed but ledger fail, or both fail with one canonical error? [Completeness, Gap, Spec §FR-004, Contracts §4]
- [ ] CHK007 — Is behavior when primary AND fallback both fail simultaneously enumerated (error code per attempt, retry/circuit side-effects)? [Completeness, Spec §FR-002, Contracts §2 step 5]
- [ ] CHK008 — Is the de-duplication semantic of `budget.warning` after spend temporarily drops below 80% (refund / correction) and recrosses specified? [Completeness, Edge Case, Spec §FR-005 / §SC-003]
- [ ] CHK009 — Are observability / OTel spans + metrics for circuit-breaker state transitions and budget warning / exceeded events specified end-to-end (export endpoint, sample rate, label cardinality)? [Completeness, Gap, Constitution Principle 4, Plan §Constitution Check missing P4]
- [ ] CHK010 — Is the behavior when the ARP server's `c2e` callback delivery itself fails / times-out / rejects specified (drop vs buffer vs retry)? [Completeness, Assumption, Spec §Assumption 2, Spec §Edge Cases last bullet]
- [ ] CHK011 — Is the secret-management requirement for CLI subscription credentials specified (env var, OS keyring, encrypted local file, scope)? [Completeness, NFR-Security, Gap, Spec §FR-006, Contracts §3 `credentialKey`]
- [ ] CHK012 — Is the topology-detection configuration source (env var name, runtime flag, config-file field, default `solo`) explicitly documented at plan.md / env schema level? [Completeness, Assumption, Gap, Spec §Assumption 3, Plan §Technical Context silent]
- [ ] CHK013 — Are streaming-completion requirements (SSE / chunked transfer) and how token counts / latency / cost are accounted across partial chunks specified? [Completeness, Gap, Spec §FR-001 / §FR-004]
- [ ] CHK014 — Is the behavior when `spendLimitUSD = 0` (Data-model §1.2 says "no per-task USD limit") and when `spendLimitUSD = NULL` / absent explicitly the same or different? [Completeness, Edge Case, Data-model §1.2, Spec §FR-005]

## Requirement Clarity

- [ ] CHK015 — Is "transient upstream failure" enumerated as a closed set (status codes + named network errors) rather than described generally? [Clarity, Spec §FR-002, Contracts §1 Error Classification Invariants]
- [ ] CHK016 — Is "wall-clock duration" disambiguated as per-task-total vs per-turn vs per-call across spec, plan, contracts, and data-model? [Ambiguity, Spec §Story 3 §1–2, Data-model §2.4, Contracts §3]
- [ ] CHK017 — Is "healthy provider" defined with measurable criteria (e.g. error-rate < X%, success-count > N, latency P95 < Y ms) so a provider is promoted / demoted deterministically? [Ambiguity, Spec §Story 1 §2]
- [ ] CHK018 — Is the canonical ADR-042 error envelope referenced with identical keys / types / status across spec, contracts, and plan (no synonym drift like `LLM_RATE_LIMITED` vs `LLM_PROVIDER_RATE_LIMITED`)? [Clarity, Consistency, Spec §FR-003, Contracts §2 step 5, Plan §Summary]
- [ ] CHK019 — Is "halt" at 100% spend defined concretely as immediate rejection / grace-period / signal-and-continue rather than a single word? [Ambiguity, Spec §FR-005 / §SC-003]
- [ ] CHK020 — Is the `dailySpendCapUSD` boundary operator (`>=` vs `>`) consistent and explicit in every place it's referenced (Story 2 §5, §SC-003, FR-005, plan §Performance)? [Clarity, Consistency, Spec §Story 2 §5 vs §SC-003]
- [ ] CHK021 — Is "exactly `$0.000000`" (SC-002) testable against a stated rounding rule so floating-point drift accumulates to zero rather than a non-zero value? [Clarity, Measurability, Spec §SC-002, Data-model §1.1 `NUMERIC(10,6)`]
- [ ] CHK022 — Is the default `failureThreshold = 3` and `cooldownMs = 30_000` (Tasks §T001, Data-model §2.2) traceable to a stated user or operational requirement (not just chosen arbitrarily)? [Traceability, Tasks §T001, Data-model §2.2]

## Requirement Consistency

- [ ] CHK023 — Does the error-code selection logic match between Spec §FR-002 ("3rd consecutive failure ⇒ `LLM_PROVIDER_RATE_LIMITED` or `LLM_CIRCUIT_BREAKER_TRIPPED`") and Contracts §2 step 5 (throws one of the two depending on circuit state)? [Consistency, Spec §FR-002 vs Contracts §2 step 5]
- [ ] CHK024 — Are Spec §Edge Cases "Local runtime unreachable" and Contracts §1 invariant "Local model connection refused / unreachable" the same scenario mapped to the same `LLM_LOCAL_MODEL_OFFLINE` code with consistent HTTP 503 + `retryable: true` semantics? [Consistency, Spec §Edge Cases vs Contracts §1 Error Classification]
- [ ] CHK025 — Is FR-006's "silently ignore `cliSubscriptionAuth`" in Topologies B/C consistent in every place it is restated (Spec §Story 3 §3, Plan §Summary, Tasks §T004, Data-model §2.4)? [Consistency, all four files]
- [ ] CHK026 — Does the `usedFallback: boolean` field in Contracts §2 `LiteLLMCompletionResponse` trace back to a stated spec requirement (caller visibility, ledger tagging, observability) — or is it an unstated invention? [Traceability, Contracts §2]
- [ ] CHK027 — Is the `provider` enum value list (`openai`, `anthropic`, `openrouter`, `ollama`, `vllm`, `llamacpp`, `cli-subscription-{provider}`) consistent between Data-model §1.1 and Contracts §2? [Consistency, Data-model §1.1 vs Contracts §2]
- [ ] CHK028 — Is `SpendValveResult.valveStatus` 3-value enum (`ok`, `warning_80_percent`, `exceeded_100_percent`, Contracts §4) aligned with Spec §FR-005 "80% warning" / "100% halt" / "<80% no signal" — no fourth implicit state (`daily_limit_exceeded` is missing from the enum)? [Consistency, Contracts §4, Spec §FR-005]

## Acceptance Criteria Quality

- [ ] CHK029 — Is SC-001 (`< 2,000ms` 100%-of-cases fallback latency) testable with a stated test environment (mocked fetch, real LiteLLM, real Ollama), load level, and concurrency assumption? [Measurability, Spec §SC-001, Plan §Performance Goals — only "single-transaction" mentioned]
- [ ] CHK030 — Is SC-002's "exactly `$0.000000` for local + CLI-subscription runs" measurable against a concrete rounding rule and cost-matrix zero-default policy (LiteLLM Proxy response vs internal override)? [Measurability, Spec §SC-002]
- [ ] CHK031 — Is SC-003's "exactly once per threshold crossing" defined so a refund / correction / hot-reload scenario cannot accidentally fire twice (and a re-cross after legitimate drop still fires once)? [Measurability, Spec §SC-003, Spec §Edge Cases 1]
- [ ] CHK032 — Is SC-004's "100% silently ignore in B/C" defined with concrete deployment scenarios (mocked config in B and C, assertion of zero side-effects on `cliSubscriptionAuth` field)? [Measurability, Spec §SC-004, Tasks §T004]

## Scenario Coverage

- [ ] CHK033 — Are scenarios where the LiteLLM Proxy itself (not the upstream provider behind it) is unreachable covered with a distinct error code (separate from `LLM_PROVIDER_RATE_LIMITED` / `LLM_LOCAL_MODEL_OFFLINE`)? [Coverage, Gap, Spec §FR-003]
- [ ] CHK034 — Is the scenario where multiple parallel alias calls for one task cross 80% / 100% simultaneously explicitly covered (atomic counter increment, single warning emission)? [Coverage, Spec §Edge Cases 1, §SC-003]
- [ ] CHK035 — Is the scenario where `dailySpendCapUSD` is reduced while a workspace has already spent more covered (does it block immediately, queue payment blocking, or allow until task boundary)? [Coverage, Gap]
- [ ] CHK036 — Is the scenario where a task is canceled or terminated mid-flight while the upstream LLM call is in progress covered (ledger entry status, rollback semantics)? [Coverage, Gap, Spec §FR-004]
- [ ] CHK037 — Is the scenario where the fallback alias also trips its own circuit breaker (chain of two open circuits) covered with the exact error contract? [Coverage, Spec §Story 1 §3, Contracts §2 step 5 silent on chain]
- [ ] CHK038 — Is the scenario where token streaming completes but the final chunk (or tool-call response) fails covered (status enum, cost recording, retry semantics)? [Coverage, Gap, Spec §FR-004]
- [ ] CHK039 — Is the scenario where multiple workspaces within one org share / conflict on `dailySpendCapUSD` definitions covered (which scope wins, sum vs max, override path)? [Coverage, Gap, Spec §Story 2 §5 "project or organization"]

## Edge Case Coverage

- [ ] CHK040 — Are boundary values `spendLimitUSD = 0` (no per-task USD ceiling per Data-model §1.2), `spendLimitUSD = NULL` (absent), and `dailySpendCapUSD = 0` (no daily ceiling) uniformly defined — fail-open (unlimited) vs fail-closed (block)? [Edge Case, Spec §FR-005, Data-model §1.2]
- [ ] CHK041 — Are negative or refund-style `cost_usd` values allowed by the `NUMERIC(10, 6)` schema path and the atomic increment logic (does `current_spend_usd - $1` work safely)? [Edge Case, Gap, Data-model §1.1]
- [ ] CHK042 — Are explicit timeout values for the gateway HTTP fetch (connect / read / overall) specified, and are they counted toward circuit-breaker failure semantics? [Edge Case, Gap, Spec §FR-002]
- [ ] CHK043 — Is the case where the configured `cooldownMs` elapses while another failure-request is concurrently in flight covered (probe serialization)? [Edge Case, Gap, Spec §Story 1 §4]
- [ ] CHK044 — Are error-cases on the budget-event delivery path (ARP `c2e` reject / drop) covered so the agent can still see the warning via alternate channel (event log, ledger row, telemetry)? [Edge Case, Spec §Edge Cases "Zero-spend local", Assumption 2]

## Non-Functional Requirements

- [ ] CHK045 — Are normal-path (non-failover) latency targets specified (P50 / P95 / P99) so SC-001's `< 2,000ms` is not compared against an undefined baseline? [NFR, Gap, Spec §Performance Goals "single-transaction ACID"]
- [ ] CHK046 — Are throughput targets (calls / second per gateway instance, concurrent LLM calls per alias) specified to bound back-pressure sizing? [NFR, Gap]
- [ ] CHK047 — Is the lifetime management of the `CircuitBreakerRegistry` bounded (LRU eviction, idle TTL, max keys) so deployments cannot leak memory across tenants / projects? [NFR, Gap, Contracts §1]
- [ ] CHK048 — Is the connection-pool sizing for `withTenantContext` under high ledger-write load specified (max concurrent `INSERT llm_calls`)? [NFR, Gap, Spec §FR-004]
- [ ] CHK049 — Are PII redaction rules for OpenTelemetry span attributes (prompt / completion content, user PII in chat messages) specified (Constitution Principle 4)? [NFR, Gap, Plan §Constitution Check missing P4]
- [ ] CHK050 — Is spend-ledger retention / archival / GDPR-erasure policy specified (optional columns, time-to-erase, backup timeline)? [NFR, Gap, Data-model §1.1]

## Dependencies & Assumptions

- [ ] CHK051 — Is the dependency on the upstream provider cost matrix (per 1K-token pricing, cache discount) source-of-truth specified — LiteLLM Proxy response payload vs project-config JSON vs env var tables? [Dependency, Gap, Spec §FR-004 / §SC-002]
- [ ] CHK052 — Is Spec §Assumption 2 (ARP Server exposes `c2e` message dispatch) validated by inspection of Phase 7 deliverable (`specs/009-arp-and-relay-harness` / Contracts §`c2e`), or is it assumed without cross-check? [Assumption, Spec §Assumption 2, Inter-Phase Risk]
- [ ] CHK053 — Is the dependency on `env.LITELLM_URL` (used by `litellm-client.ts`) explicitly documented in the project's env schema (`docs/env-schema.md` if it exists, or `.env.example`) — and is it required to be present at boot? [Dependency, Gap, Plan §Technical Context, Contracts §2]
- [ ] CHK054 — Is the dependency on `better-auth` persona / user-store resolution for the `LiteLLMCompletionRequest.persona` field traceable to Phase 2 contract, or is it an Phase 8 invention? [Dependency, Traceability, Contracts §2]
- [ ] CHK055 — Is the OTel export endpoint configuration responsibility assigned (per-orchestrator instance vs per-tenant override) and aligned with Constitution Principle 4 + plan §Constitution Check missing P4? [Dependency, Gap, Constitution Principle 4]

## Ambiguities & Conflicts

- [ ] CHK056 — Are spec §Story 1 §2 "within 2 seconds" and plan §Technical Context "`< 2,000ms`" identical numerical commitments (no calculator / unit drift), with the same measurement methodology? [Conflict, Spec §Story 1 §2, Plan §Technical Context, Plan §Performance Goals]
- [ ] CHK057 — Are spec §FR-005 "emits `budget.warning`" event semantics consistent with Contracts §4 `BudgetSignalNotifier.onBudgetWarning` payload fields (taskId / workspaceId / currentSpendUSD / spendLimitUSD / percentUsed / message) — same fields, same types, same ordering? [Conflict, Spec §FR-005 vs Contracts §4]
- [ ] CHK058 — Does spec §Edge Cases "`cost_usd = 0` **regardless of token volume**" for local runtimes conflict with Data-model §1.1's `cost_usd NUMERIC(10, 6) NOT NULL` — if a local call's raw cost is non-zero before normalization, is internal override versus upstream-response-passthrough documented? [Conflict, Spec §Edge Cases vs Data-model §1.1]
- [ ] CHK059 — Does `provider = 'cli-subscription-{provider}'` (templated) conflict with `VARCHAR(64)` length when `{provider}` is unbounded (e.g. a long CLI provider tag overflowing 64 - 16 = 48 characters)? [Conflict, Spec §FR-006 / §Story 3 §1, Data-model §1.1]
- [ ] CHK060 — Is the `dailySpendCapUSD` ownership ambiguity ("project or organization" in spec) resolved to one canonical assignment rule (topology-specific precedence) so FR-005 is unambiguous? [Ambiguity, Spec §Story 2 §5 / §FR-005]
- [ ] CHK061 — Is the `persona` enum (4 values `planner / implementer / reviewer / arbiter`) consistent across spec's Key Entity, Data-model §2.3, and Contracts §2 `LiteLLMCompletionRequest.persona` — and do they match the Phase 7 / Phase 9 ARP tier names exactly? [Consistency, Spec §Key Entities + §FR-004, Data-model §2.3, Contracts §2]

---

## Notes

- This checklist is **independent** of `requirements.md` (the Step-6 lifecycle checklist maintained by `/speckit-specify` and `/speckit-clarify`). Mark `[x]` only after reviewer raises satisfied.
- The auto-generated `requirements.md` (16/16 marked complete) is at the level of "is the spec well-formed?", not "are the requirements detailed enough to build against?". This checklist focuses on the second axis — adversarial requirement-quality audit suitable for Step 7 Human Approval gate.
- Items CHK001–CHK014 are completeness gaps likely to surface during Step 8 `/speckit-implement` as blocking clarifications; recommend pre-implementation resolution.
- Items CHK056–CHK059 are explicit cross-document inconsistencies — the highest priority to resolve before approval; even one unchecked conflict blocks clean implementation.
- `/speckit-implement` MUST NOT modify any checkbox state in this file (per template policy).

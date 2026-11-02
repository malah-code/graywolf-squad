# Tasks: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Input**: Design documents from `/specs/013-review-packet-and-vcs-delivery/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/review-packet-and-vcs.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 11 (`tests/unit/repo-sdk.test.ts`, `tests/unit/mandatory-gates.test.ts`, `tests/unit/review-packet.test.ts`, and `tests/integration/webhook-feedback.test.ts`).

**Organization**: Tasks are grouped by user story and mapped directly to Phase 11 Tasks 11.1–11.4 in the master plan.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Provider-Agnostic VCS Delivery via `repo-sdk` (Priority: P1) 🎯 MVP

**Goal**: Implement `RepoSdkClient` (`src/orchestrator/delivery/repo-sdk.ts`) supporting `'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'` for `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook`, mapping 401/403 remote errors to `GraywolfAppError('GIT_REMOTE_AUTH_FAILED')`.

**Independent Test**: Run `pnpm vitest run tests/unit/repo-sdk.test.ts` to verify all 6 operations across all 5 VCS providers with provider mocks.

### Implementation & Tests for User Story 1 (Master Plan Task 11.1)

- [X] T001 [P] [US1] Implement `RepoSdkClient` and `VcsProviderAdapter` in `src/orchestrator/delivery/repo-sdk.ts` supporting `'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'` for `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook`, mapping 401/403 authentication errors to `GraywolfAppError('GIT_REMOTE_AUTH_FAILED')`
- [X] T002 [US1] Create unit test suite in `tests/unit/repo-sdk.test.ts` testing `RepoSdkClient` operations (`cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, `registerWebhook`) across all 5 VCS providers (`github`, `gitlab`, `bitbucket`, `azure`, `gitea`) and `GIT_REMOTE_AUTH_FAILED` error handling

**Checkpoint**: User Story 1 (Task 11.1) is complete and independently verified via `tests/unit/repo-sdk.test.ts`.

---

## Phase 2: User Story 2 - 6 Non-Negotiable Mandatory Human Gates, `ai-pm` Persona & Solo `Auto-Merge-if-Green` (Priority: P1)

**Goal**: Implement `evaluateMandatoryHumanGates` and `evaluateAiPmReviewer` (`src/orchestrator/delivery/mandatory-gates.ts`) enforcing the 6 Non-Negotiable Mandatory Human Gates (PRD §8.4), configurable gate policies (`auto` / `ai-pm` / `human` / `mandatory-human`), `ai-pm` reviewer escalation (`canEscalateToHuman`), and Solo Dev `Auto-Merge-if-Green` (§12.2).

**Independent Test**: Run `pnpm vitest run tests/unit/mandatory-gates.test.ts` to verify all 6 mandatory human gates, `ai-pm` reviewer decisions, and Solo Dev `Auto-Merge-if-Green`.

### Implementation & Tests for User Story 2 (Master Plan Task 11.2)

- [X] T003 [P] [US2] Implement `evaluateMandatoryHumanGates` and `evaluateAiPmReviewer` in `src/orchestrator/delivery/mandatory-gates.ts` checking all 6 non-negotiable gates (`'blast_radius_escape'`, `'destructive_ddl'`, `'security_or_license_exposure'`, `'protected_branch_target'`, `'task_spend_ceiling_exceeded'`, `'two_strike_review_rejection'`), forcing `effectiveGatePolicy = 'mandatory-human'` when any gate triggers, evaluating `ai-pm` reviewer persona (`autoApproveThreshold`, `canEscalateToHuman`), and computing `canAutoMerge` for Solo Dev `Auto-Merge-if-Green`
- [X] T004 [US2] Create unit test suite in `tests/unit/mandatory-gates.test.ts` testing each of the 6 non-negotiable human gates individually and in combination, `byTaskTag` / `default` gate policy precedence, `ai-pm` approval vs human escalation, and Solo Dev `Auto-Merge-if-Green` blocking when any gate triggers or any guard fails

**Checkpoint**: User Story 2 (Task 11.2) is complete and independently verified via `tests/unit/mandatory-gates.test.ts`.

---

## Phase 3: User Story 3 - 7-Section 60-Second Executive Review Packet & Per-Model Confidence Calibration (Priority: P1)

**Goal**: Implement `ConfidenceCalibrator` (`src/orchestrator/delivery/confidence-calibration.ts`) with `n >= 30` sample gate, `±0.15` cap, and 90-day half-life backed by PostgreSQL `confidence_calibration`, and `buildExecutiveReviewPacket` (`src/orchestrator/delivery/review-packet.ts`) rendering all 7 canonical sections of the 60-Second Executive Review Packet.

**Independent Test**: Run `pnpm vitest run tests/unit/review-packet.test.ts` to verify the 7-section PR body, residency/risk badges, and confidence calibration math (`n < 30` vs `n >= 30`, `±0.15` clamp, 90-day half-life).

### Implementation & Tests for User Story 3 (Master Plan Task 11.3)

- [X] T005 [P] [US3] Implement `computeCalibratedConfidence` and `ConfidenceCalibrator` in `src/orchestrator/delivery/confidence-calibration.ts` persisting and querying `confidence_calibration` (`task_id VARCHAR(64) NOT NULL`, `workspace_id UUID NOT NULL`, `user_id UUID`, `model_id VARCHAR(64) NOT NULL`, `model_version VARCHAR(32) NOT NULL`, `file_path TEXT NOT NULL`, `file_language VARCHAR(32)`, `file_type VARCHAR(32)`, `confidence_score NUMERIC(3, 2) NOT NULL`, `justification TEXT`) inside `withTenantContext` and enforcing `minSamples = 30`, `maxDelta = 0.15`, and `halfLifeDays = 90`
- [X] T006 [P] [US3] Implement `resolveDataResidencyTier` and `buildExecutiveReviewPacket` in `src/orchestrator/delivery/review-packet.ts` rendering all 7 canonical sections (10-Second Executive Summary + DecisionGate risk badge + Model Data Residency Badge Tier 1/2/3 + Calibrated Confidence score, Quality Gate Compliance Table, Dual-Axis Review Matrix Standards vs Spec, Docs-Guard AST Symbol Verification Badge, Browser Smoke Test Findings Table, Visual Proof Artifacts with `cached` vs `live` indicator, and Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown)
- [X] T007 [US3] Create unit test suite in `tests/unit/review-packet.test.ts` verifying all 7 review packet sections, Tier 1/2/3 data residency badge derivation, `n < 30` unadjusted confidence vs `n >= 30` 90-day half-life calibrated confidence clamped to `±0.15`, and `confidence_calibration` DB persistence via `withTenantContext`

**Checkpoint**: User Story 3 (Task 11.3) is complete and independently verified via `tests/unit/review-packet.test.ts`.

---

## Phase 4: User Story 4 - Inbound PR Review Comment Webhook Loop & Bidirectional External PM Sync (Priority: P2)

**Goal**: Implement `VcsWebhookDebouncer` and Fastify webhook route (`src/orchestrator/routes/webhooks-vcs.ts`) to debounce inbound PR review comments via `webhookDebounceMs`, awaken the sandbox with ARP `review.feedback`, re-run guards, and push an updated commit to the PR branch, alongside `PmSyncService` (`src/orchestrator/delivery/pm-sync.ts`) where Graywolf owns execution state and external PM tools own `labels` and `assignees`.

**Independent Test**: Run `pnpm vitest run tests/integration/webhook-feedback.test.ts` to verify debounced webhook coalescing, ARP `review.feedback` -> guard re-run -> branch push pipeline, and bidirectional PM state/label/assignee ownership.

### Implementation & Tests for User Story 4 (Master Plan Task 11.4)

- [X] T008 [P] [US4] Implement `PmSyncService` in `src/orchestrator/delivery/pm-sync.ts` supporting `'github' | 'gitlab' | 'jira' | 'linear'` where Graywolf is authoritative for execution state (`TaskStatus`) and the external PM tool is authoritative for `labels` and `assignees`
- [X] T009 [US4] Implement `VcsWebhookDebouncer`, `handleInboundPrReviewFeedback`, and Fastify route `POST /api/v1/webhooks/vcs/:provider` in `src/orchestrator/routes/webhooks-vcs.ts` (and register in `src/orchestrator/app.ts`) debouncing inbound PR review comments by `webhookDebounceMs`, dispatching ARP `review.feedback`, re-running reactive quality guards, and pushing the updated commit via `RepoSdkClient`
- [X] T010 [US4] Create integration test suite in `tests/integration/webhook-feedback.test.ts` verifying `webhookDebounceMs` comment coalescing, end-to-end ARP `review.feedback` wakeup -> guard re-run -> `RepoSdkClient.pushTaskBranch`, and `PmSyncService` bidirectional ownership rules

**Checkpoint**: User Story 4 (Task 11.4) is complete and independently verified via `tests/integration/webhook-feedback.test.ts`.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [X] T011 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 11.1, 11.2, 11.3, and 11.4 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T002`, US1 `repo-sdk.ts`)**: No dependencies — starts immediately.
- **Phase 2 (`T003`–`T004`, US2 `mandatory-gates.ts`)**: Independent — can run in parallel with Phase 1.
- **Phase 3 (`T005`–`T007`, US3 `confidence-calibration.ts` & `review-packet.ts`)**: Independent — can run in parallel with Phases 1 & 2.
- **Phase 4 (`T008`–`T010`, US4 `pm-sync.ts` & `webhooks-vcs.ts`)**: `T008` is independent; `T009` uses `RepoSdkClient` from `T001`.
- **Phase 5 (`T011`)**: Depends on `T001`–`T010`.

### Parallel Opportunities

- `T001` (`repo-sdk.ts`), `T003` (`mandatory-gates.ts`), `T005` (`confidence-calibration.ts`), `T006` (`review-packet.ts`), and `T008` (`pm-sync.ts`) touch completely separate files and can be developed in parallel.

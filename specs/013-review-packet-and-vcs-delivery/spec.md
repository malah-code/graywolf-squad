# Feature Specification: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Feature Branch**: `013-review-packet-and-vcs-delivery`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Phase 11 Configurable Gate Policy, 60-Second Review Packet & repo-sdk PR Delivery: Deliver verified patches as native Pull/Merge Requests via repo-sdk with the 7-part 60-Second Executive Review Packet, AI PM reviewer persona, 6 Non-Negotiable Human Gates, Confidence Calibration (Gap 9), and PR comment webhook loop (PRD §8, §10.1)."

## Clarifications

### Session 2026-10-25
- Q: Which actor commits and pushes the verified `changes.patch` to the task branch before opening a Pull/Merge Request? → A: Per Constitution Principle 1 (Human Sovereignty & Non-Committing Relay Contract), in-container agents NEVER run `git commit` or `git push`. Only the **host Orchestrator** (`repo-sdk.ts`) applies the guard-verified `changes.patch` to the isolated task branch (`worktree-task-<ID>`) and opens/updates the Pull/Merge Request against the target branch, keeping `main` / `release/*` untouched until explicit gate approval.
- Q: Can `auto` gate policy, Solo Dev `Auto-Merge-if-Green`, or the `ai-pm` reviewer persona ever bypass any of the 6 Non-Negotiable Mandatory Human Gates? → A: Never. If any of the 6 Non-Negotiable Mandatory Human Gates trigger ((1) blast-radius scope escape, (2) destructive DDL `DROP TABLE` / `TRUNCATE`, (3) security/secret/copyleft exposure, (4) merging into protected branches `main` / `release/*`, (5) per-task spend ceiling exceeded, or (6) two-strike internal review rejection), `mandatory-gates.ts` unconditionally overrides the effective gate policy to `'mandatory-human'` and blocks auto-merge.
- Q: How does Per-Model Confidence Calibration (`confidence-calibration.ts`) adjust raw model confidence scores when sample count `n < 30` vs. `n >= 30`? → A: Calibration is grouped by `(file_type, model_id, model_version)` with a 90-day exponential decay half-life (`weight = 0.5 ^ (ageDays / 90)`). When historical sample count `n < 30`, the adjustment delta is `0.00` (raw confidence is returned unadjusted). When `n >= 30`, the empirical calibration delta (`empiricalPassRate - meanReportedConfidence`) is clamped to `[-0.15, +0.15]` and added to the raw confidence score (clamped to `[0.00, 1.00]`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provider-Agnostic VCS Delivery via `repo-sdk` (Priority: P1)

As a platform operator using GitHub, GitLab, Bitbucket Cloud, Azure DevOps, or Gitea, I need a unified provider-agnostic VCS abstraction (`src/orchestrator/delivery/repo-sdk.ts`) so the host orchestrator can clone repositories, push verified task branches, create/update Pull or Merge Requests, post review comments, merge approved PRs, and register webhooks without vendor lock-in.

**Why this priority**: Native Pull/Merge Request delivery across all 5 enterprise VCS providers is the core output channel of the autonomous squad.

**Independent Test**: Can be fully tested using provider adapter mocks across GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea for `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook`, plus verifying `GIT_REMOTE_AUTH_FAILED` error mapping.

**Acceptance Scenarios**:

1. **Given** a project configured with `sourceControl.provider` (`'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'`), **When** the orchestrator delivers a verified task patch, **Then** `RepoSdkClient` pushes the task branch and creates or updates a Pull/Merge Request returning a normalized `PullRequestRecord` (`prNumber`, `url`, `provider`, `sourceBranch`, `targetBranch`, `status`).
2. **Given** an invalid or expired VCS credential, **When** any remote VCS operation fails with HTTP 401/403, **Then** `RepoSdkClient` throws canonical `GraywolfAppError('GIT_REMOTE_AUTH_FAILED')`.

---

### User Story 2 - 6 Non-Negotiable Mandatory Human Gates, `ai-pm` Persona & Solo `Auto-Merge-if-Green` (Priority: P1)

As a human engineering lead, I need the orchestrator (`src/orchestrator/delivery/mandatory-gates.ts`) to evaluate the 6 Non-Negotiable Mandatory Human Gates before any merge decision, support the configurable `ai-pm` reviewer persona (`aiReviewer` config) when no mandatory gate is triggered, and allow Solo Dev `Auto-Merge-if-Green` only when all tests/guards pass and zero mandatory human gates fire.

**Why this priority**: Enforces Constitution Principle 1 (Human Sovereignty) and PRD §8.4 safety boundaries so high-risk changes never auto-merge.

**Independent Test**: Can be tested by evaluating all 6 mandatory human gate conditions individually and in combination, testing `ai-pm` auto-approval vs. escalation (`canEscalateToHuman`), and verifying Solo Dev `Auto-Merge-if-Green` eligibility.

**Acceptance Scenarios**:

1. **Given** a task ready for delivery, **When** any of the 6 non-negotiable triggers occur — (1) blast-radius scope escape, (2) destructive DDL (`DROP TABLE`, `TRUNCATE`), (3) security/secret/CVE/copyleft exposure (`gitleaks`, `osv-scanner`), (4) target branch is protected (`main`, `release/*`) without explicit override policy, (5) per-task spend ceiling exceeded, or (6) two-strike internal review rejection — **Then** `evaluateMandatoryHumanGates` returns `triggered: true` with the list of triggered gate IDs and forces `effectiveGatePolicy = 'mandatory-human'`.
2. **Given** zero mandatory human gates triggered and `effectiveGatePolicy === 'ai-pm'`, **When** `evaluateAiPmReview` runs with `calibratedConfidence >= autoApproveThreshold` (default `0.85`) and green guards, **Then** the `ai-pm` persona approves the gate and records an audit entry; if confidence is below threshold and `canEscalateToHuman` is true, it escalates to `'human'`.
3. **Given** a Solo Mode (`topology === 'solo'`) deployment with `autoMergeIfGreen: true`, **When** all tests and guards pass (`overallVerdict === 'PASS'`) and zero mandatory human gates trigger, **Then** `canAutoMergeIfGreen` returns `true`.

---

### User Story 3 - 7-Section 60-Second Executive Review Packet & Per-Model Confidence Calibration (Priority: P1)

As a busy tech lead reviewing an agent-authored PR, I need a structured 7-section **60-Second Executive Review Packet** (`src/orchestrator/delivery/review-packet.ts`) paired with empirical per-model confidence calibration (`src/orchestrator/delivery/confidence-calibration.ts`) so I can assess risk, data residency, guard compliance, dual-axis findings, AST symbol verification, browser smoke tests, visual proof, and semantic diffs in under 60 seconds.

**Why this priority**: Prevents reviewer fatigue and eliminates uncalibrated model overconfidence (`n >= 30` sample gate, `±0.15` cap, 90-day half-life).

**Independent Test**: Can be tested by building the 7-section PR markdown packet from structured task inputs and verifying all 7 required sections, badges (DecisionGate risk badge, Model Data Residency Tier 1/2/3 badge, Calibrated Confidence score), and testing `ConfidenceCalibrator` with `< 30` samples (no adjustment) vs. `>= 30` samples (clamped `±0.15` adjustment with 90-day half-life decay) persisted to `confidence_calibration`.

**Acceptance Scenarios**:

1. **Given** confidence calibration records in `confidence_calibration` for `(file_type, model_id, model_version)`, **When** `computeCalibratedConfidence` is called with `< 30` samples, **Then** it returns the raw confidence score with `delta = 0` and `sampleCount < 30`; when called with `>= 30` samples, it applies 90-day half-life weighting and clamps the adjustment delta to `[-0.15, +0.15]`.
2. **Given** a completed task's guard report, review matrix, and diff metrics, **When** `buildExecutiveReviewPacket` generates the PR description, **Then** the markdown output contains all 7 canonical sections in order:
   1) 10-Second Executive Summary (with DecisionGate risk badge, Model Data Residency Badge Tier 1/2/3, and Calibrated Confidence score)
   2) Quality Gate Compliance Table
   3) Dual-Axis Review Matrix (**Standards Axis** vs **Spec Axis**, ADR-083)
   4) Docs-Guard AST Symbol Verification Badge
   5) Browser Smoke Test Findings Table (`e2e explore`)
   6) Visual Proof Artifacts (Playwright screenshots/WebM + `cached` vs `live` indicator)
   7) Deterministic AST Semantic Diff Summary & Scoped File Diff Breakdown.

---

### User Story 4 - Inbound PR Review Comment Webhook Loop & Bidirectional External PM Sync (Priority: P2)

As a developer leaving review feedback on a GitHub/GitLab Pull Request or tracking issues in Jira/Linear/GitHub/GitLab, I need inbound PR review comments (`src/orchestrator/routes/webhooks-vcs.ts`) debounced via `webhookDebounceMs` to awaken the task sandbox with ARP `review.feedback`, apply fixes, re-run guards, and push an updated commit, while `src/orchestrator/delivery/pm-sync.ts` synchronizes task state vs. external labels/assignees.

**Why this priority**: Closes the human-in-the-loop PR review cycle and keeps external issue trackers synchronized without manual copy-pasting.

**Independent Test**: Can be tested by posting simulated PR comment webhooks within the debounce window (`webhookDebounceMs`), verifying coalesced single sandbox wakeup + ARP `review.feedback` payload + guard re-verification + branch update, and testing `PmSyncService` state-vs-label/assignee ownership rules.

**Acceptance Scenarios**:

1. **Given** multiple inbound PR review comment webhooks for the same task arriving within `webhookDebounceMs`, **When** the debounce window elapses, **Then** the webhook handler coalesces the comments into a single ARP `review.feedback` dispatch, re-runs quality guards on the updated patch, and pushes the updated commit to the PR branch.
2. **Given** an external PM integration (`github`, `gitlab`, `jira`, `linear`), **When** `PmSyncService` syncs a task, **Then** Graywolf is authoritative for execution state (`QUEUED`, `IN_PROGRESS`, `HUMAN_REVIEW_GATE`, `MERGED`) while the external PM tool is authoritative for issue `labels` and `assignees`.

---

### Edge Cases

- **Mandatory human gate triggered when `gatePolicy.default === 'auto'`**: The mandatory gate unconditionally overrides `'auto'` to `'mandatory-human'`.
- **Confidence calibration with extreme model overconfidence (`raw = 0.95`, empirical pass rate = `0.50`, `n = 50`)**: Adjustment delta is capped at `-0.15`, yielding `calibratedConfidence = 0.80` (never shifting by more than `±0.15`).
- **Rapid burst of 5 PR review comments in 500ms (`webhookDebounceMs = 2000`)**: Coalesced into 1 sandbox wakeup containing all 5 comments after the debounce window settles.
- **Unlinked external webhook actor**: If a webhook or PM event originates from an unmapped external user in restricted mode, emit or flag `ADDON_UNLINKED_EXTERNAL_USER` / ignore unauthorized merge triggers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Provider-Agnostic `repo-sdk` Delivery — Task 11.1)**: System MUST implement `src/orchestrator/delivery/repo-sdk.ts` supporting `'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'` for `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook`, mapping remote auth failures to `GIT_REMOTE_AUTH_FAILED`.
- **FR-002 (6 Non-Negotiable Mandatory Human Gates & Gate Policy Resolution — Task 11.2)**: System MUST implement `src/orchestrator/delivery/mandatory-gates.ts` evaluating all 6 mandatory human gate triggers ((1) blast-radius escape, (2) destructive DDL `DROP TABLE`/`TRUNCATE`, (3) secret/CVE/copyleft exposure, (4) protected branch `main`/`release/*` target, (5) task spend ceiling exceeded, (6) 2-strike internal review failure), supporting the `ai-pm` reviewer persona (`aiReviewer` config with `canEscalateToHuman`), and enforcing Solo Dev `Auto-Merge-if-Green` only when all tests/guards pass and zero mandatory human gates fire.
- **FR-003 (7-Section 60-Second Executive Review Packet — Task 11.3a)**: System MUST implement `src/orchestrator/delivery/review-packet.ts` generating the 7-section PR markdown body containing (1) 10-Second Executive Summary + DecisionGate risk badge + Model Data Residency Badge (`Tier 1: Local-Only`, `Tier 2: Zero-Retention Enterprise Cloud`, `Tier 3: Standard Commercial API`) + Calibrated Confidence score, (2) Quality Gate Compliance Table, (3) Dual-Axis Review Matrix (Standards vs. Spec), (4) Docs-Guard AST Symbol Verification Badge, (5) Browser Smoke Test Findings Table, (6) Visual Proof Artifacts (`cached` vs. `live` indicator), and (7) Deterministic AST Semantic Diff summary & Scoped File Diff Breakdown.
- **FR-004 (Per-Model Confidence Calibration — Task 11.3b)**: System MUST implement `src/orchestrator/delivery/confidence-calibration.ts` persisting calibration samples to PostgreSQL `confidence_calibration` (`task_id`, `workspace_id`, `user_id`, `model_id`, `model_version`, `file_path`, `file_language`, `file_type`, `confidence_score`, `justification`) inside `withTenantContext`, enforcing the `n >= 30` sample gate per `(file_type, model_id, model_version)`, 90-day exponential decay half-life, and `±0.15` maximum adjustment cap.
- **FR-005 (Inbound VCS Webhook Feedback Loop — Task 11.4a)**: System MUST implement `src/orchestrator/routes/webhooks-vcs.ts` (`POST /api/v1/webhooks/vcs/:provider`) debouncing inbound PR review comments via `webhookDebounceMs`, awakening/dispatching ARP `review.feedback` to the task sandbox, re-running reactive quality guards, and pushing the updated commit to the PR branch.
- **FR-006 (Bidirectional External PM Sync — Task 11.4b)**: System MUST implement `src/orchestrator/delivery/pm-sync.ts` supporting `'github' | 'gitlab' | 'jira' | 'linear'` where Graywolf owns execution status (`TaskStatus`) and the external PM system owns `labels` and `assignees`.

### Key Entities

- **Pull Request Record (`PullRequestRecord`)**: Normalized VCS Pull/Merge Request metadata (`prNumber`, `url`, `provider`, `sourceBranch`, `targetBranch`, `title`, `bodyMarkdown`, `status`: `'open' | 'merged' | 'closed'`).
- **Mandatory Gate Evaluation (`MandatoryGateEvaluation`)**: Result of checking the 6 non-negotiable human gates (`triggered: boolean`, `triggeredGates: MandatoryGateId[]`, `effectiveGatePolicy: GateType`, `canAutoMerge: boolean`).
- **Confidence Calibration Result (`CalibrationResult`)**: Computed confidence adjustment (`rawConfidence`, `calibratedConfidence`, `delta`, `sampleCount`, `isCalibrated: boolean`).
- **Executive Review Packet (`ExecutiveReviewPacket`)**: Structured 7-section PR summary and rendered Markdown string.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Multi-Provider VCS Delivery)**: 100% of simulated PR delivery operations across all 5 VCS providers (`github`, `gitlab`, `bitbucket`, `azure`, `gitea`) normalize into `PullRequestRecord` and map auth errors to `GIT_REMOTE_AUTH_FAILED`.
- **SC-002 (Mandatory Human Gate Enforcement)**: 100% of tasks triggering any of the 6 non-negotiable gates force `effectiveGatePolicy = 'mandatory-human'` and block `Auto-Merge-if-Green` and `ai-pm` auto-approval.
- **SC-003 (Review Packet & Calibration Precision)**: 100% of generated review packets include all 7 required sections and badges, and `ConfidenceCalibrator` applies `0.00` delta when `n < 30` and clamps delta within `[-0.15, +0.15]` with 90-day half-life when `n >= 30`.
- **SC-004 (Debounced Webhook & PM Ownership)**: Rapid PR review comments within `webhookDebounceMs` coalesce into a single `review.feedback` cycle per task, and `PmSyncService` preserves external `labels`/`assignees` while syncing Graywolf execution state.

## Assumptions

- PostgreSQL table `confidence_calibration` (Table #19 in `migrations/1789444040216_create-tasks-table.js`) and `withTenantContext` are already migrated and available.
- `ProjectConfigSchema` (`sourceControl`, `gatePolicy`, `aiReviewer`, `limits.webhookDebounceMs`) from Phase 1 (`src/orchestrator/schemas/project-config.ts`) is available.

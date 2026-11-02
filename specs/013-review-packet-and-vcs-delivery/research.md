# Technical Research: Configurable Gate Policy, 60-Second Review Packet & `repo-sdk` PR Delivery

**Feature**: `013-review-packet-and-vcs-delivery`  
**Phase**: Phase 11

## 1. Provider-Agnostic `RepoSdkClient` Architecture (Task 11.1)

- **Decision**: Implement `RepoSdkClient` in `src/orchestrator/delivery/repo-sdk.ts` with a clean `VcsProviderAdapter` interface and built-in normalized drivers for `'github'`, `'gitlab'`, `'bitbucket'`, `'azure'`, and `'gitea'` (supporting injectable HTTP/SDK transport for deterministic unit testing). Any transport error with status `401` or `403` (or message matching unauthorized/bad credentials) throws `new GraywolfAppError('GIT_REMOTE_AUTH_FAILED', ...)`.
- **Rationale**: Allows identical orchestrator delivery code to operate across GitHub (`octokit`), GitLab (`@gitbeaker/rest`), Bitbucket Cloud, Azure DevOps, and self-hosted Gitea without coupling core business logic to a single VCS vendor.
- **Alternatives Considered**: Hardcoding GitHub REST calls directly in task routes (rejected: violates brownfield GitLab/Bitbucket/Gitea support in PRD §10.1).

## 2. 6 Non-Negotiable Mandatory Human Gates & `ai-pm` Reviewer (Task 11.2)

- **Decision**:
  - Define the 6 canonical gate IDs:
    1. `'blast_radius_escape'` (`hasBlastRadiusEscape === true`)
    2. `'destructive_ddl'` (`/\\b(DROP\\s+TABLE|TRUNCATE\\s+TABLE|TRUNCATE\\b)/i.test(patchContent)` or `hasDestructiveDdl === true`)
    3. `'security_or_license_exposure'` (`gitleaksSecretsFound > 0 || criticalCvesFound > 0 || copyleftLicenseDetected === true`)
    4. `'protected_branch_target'` (`^(main|master|release\\/.+)$/.test(targetBranch)` when merging directly into protected branch)
    5. `'task_spend_ceiling_exceeded'` (`taskSpendExceeded === true` or `currentSpendUSD >= spendLimitUSD` when `spendLimitUSD > 0`)
    6. `'two_strike_review_rejection'` (`consecutiveReviewStrikes >= 2`)
  - Precedence: If `triggeredGates.length > 0`, `effectiveGatePolicy` is forced to `'mandatory-human'` and `canAutoMerge` is `false` regardless of `gatePolicy.default`, `byTaskTag`, `ai-pm`, or `autoMergeIfGreen`.
  - When `triggeredGates.length === 0`: resolve policy from `gatePolicy.byTaskTag[tag] ?? gatePolicy.default ?? 'human'`. If `'ai-pm'`, approve automatically when `allGuardsPassed && calibratedConfidence >= (aiReviewer.autoApproveThreshold ?? 0.85)`; otherwise escalate to `'human'` if `aiReviewer.canEscalateToHuman !== false`.
- **Rationale**: Guarantees 100% deterministic enforcement of PRD §8.4 and §12.2.
- **Alternatives Considered**: Allowing `ai-pm` to override protected branch or destructive DDL checks (rejected: violates Constitution Principle 1).

## 3. Per-Model Confidence Calibration Formula (Task 11.3b, Gap 9)

- **Decision**:
  - Store calibration samples in PostgreSQL `confidence_calibration` (`task_id`, `workspace_id`, `user_id`, `model_id`, `model_version`, `file_path`, `file_language`, `file_type`, `confidence_score`, `justification`).
  - When computing calibrated confidence for `(fileType, modelId, modelVersion)` with `rawConfidence`:
    - If sample count `n < 30`: return `{ rawConfidence, calibratedConfidence: rawConfidence, delta: 0, sampleCount: n, isCalibrated: false }`.
    - If `n >= 30`: weight each historical sample $i$ by 90-day exponential decay $w_i = 0.5^{\text{ageDays}_i / 90}$. Compute weighted empirical accuracy $\bar{a} = \frac{\sum w_i \cdot \text{outcome}_i}{\sum w_i}$ and weighted reported confidence $\bar{c} = \frac{\sum w_i \cdot c_i}{\sum w_i}$. Raw delta $\Delta = \bar{a} - \bar{c}$ is clamped to $[-0.15, +0.15]$, and $\text{calibratedConfidence} = \text{clamp}(\text{rawConfidence} + \Delta_{\text{clamped}}, 0, 1)$.
- **Rationale**: Prevents cold-start noise (`n < 30`), bounds maximum adjustment to `±0.15`, and discounts stale model behavior via the 90-day half-life.
- **Alternatives Considered**: Unbounded linear scaling on small sample sizes (rejected: 2 early failures would zero out confidence).

## 4. Debounced PR Comment Webhook Loop & External PM Sync (Task 11.4)

- **Decision**:
  - `VcsWebhookDebouncer` + Fastify route `POST /api/v1/webhooks/vcs/:provider`: buffers inbound PR review comments per `taskId` for `webhookDebounceMs` (default `2000ms`, configurable per call/test). When the timer fires, it invokes the feedback handler once with all coalesced comments: awakens the sandbox, sends ARP `review.feedback`, applies fixes, re-runs the reactive guard suite, and pushes the updated commit to the PR branch via `RepoSdkClient`.
  - `PmSyncService`: synchronizes task state to external issue trackers (`github`, `gitlab`, `jira`, `linear`) while preserving external `labels` and `assignees` as authoritative from the external PM tool.
- **Rationale**: Prevents container thrashing when a human reviewer submits a multi-comment PR review batch.
- **Alternatives Considered**: Spawning a container restart on every individual webhook HTTP request without debouncing (rejected: causes lock contention and wasted tokens on multi-comment reviews).

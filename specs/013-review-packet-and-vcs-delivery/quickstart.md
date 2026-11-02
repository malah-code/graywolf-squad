# Quickstart & Verification Guide: Phase 11 Review Packet & VCS Delivery

**Feature**: `013-review-packet-and-vcs-delivery`  
**Phase**: Phase 11

## 1. Prerequisites

- Node.js 20+ and `pnpm` installed
- Phase 0–10 modules compiled and passing (`pnpm typecheck`)

## 2. Running the Phase 11 Verification Suites

1. **Task 11.1 — Provider-Agnostic Git Abstraction (`repo-sdk`)**:
   ```bash
   pnpm vitest run tests/unit/repo-sdk.test.ts
   ```
   Verifies `cloneRepo`, `pushTaskBranch`, `createOrUpdatePullRequest`, `postPullRequestComment`, `mergePullRequest`, and `registerWebhook` across GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea, plus `GIT_REMOTE_AUTH_FAILED` error mapping.

2. **Task 11.2 — 6 Non-Negotiable Mandatory Human Gates & Gate Policy**:
   ```bash
   pnpm vitest run tests/unit/mandatory-gates.test.ts
   ```
   Verifies all 6 mandatory human gates, `ai-pm` reviewer persona (`canEscalateToHuman`), and Solo Dev `Auto-Merge-if-Green`.

3. **Task 11.3 — 60-Second Executive Review Packet & Per-Model Confidence Calibration**:
   ```bash
   pnpm vitest run tests/unit/review-packet.test.ts
   ```
   Verifies all 7 PR review packet sections, DecisionGate risk badge, Model Data Residency Badge (`Tier 1/2/3`), and `ConfidenceCalibrator` (`n >= 30` sample gate, `±0.15` cap, 90-day half-life).

4. **Task 11.4 — PR Review Comment Webhook Feedback Loop & External PM Sync**:
   ```bash
   pnpm vitest run tests/integration/webhook-feedback.test.ts
   ```
   Verifies debounced inbound PR comments (`webhookDebounceMs`), ARP `review.feedback` wakeup, guard re-verification, PR branch update push, and bidirectional PM sync (`PmSyncService`).

# Quickstart & Verification Guide: Attention Firewall & Two-Stage Signal Admission (`021-attention-firewall`)

**Date**: 2026-11-05  
**Spec Reference**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/021-attention-firewall/spec.md)  
**Implementation Plan**: [plan.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/021-attention-firewall/plan.md)

---

## 1. Prerequisites & Environment Setup

1. **Active Database**: PostgreSQL 16 running locally or via Docker Compose.
2. **Environment Variables**:
   ```bash
   export DATABASE_URL="postgres://graywolf:graywolf_dev@localhost:5432/graywolf_squad"
   export LITELLM_BASE_URL="http://localhost:4000"
   export LITELLM_MASTER_KEY="sk-litellm-master-key"
   ```
3. **Database Migration**:
   ```bash
   pnpm migrate:up
   ```

---

## 2. Automated Test Verification Suites

Run the four dedicated test suites covering Phase 20:

```bash
# 1. Verify core purity: zero illegal external imports in src/orchestrator/admission/core/
pnpm test tests/unit/admission-core-purity.test.ts

# 2. Verify pure domain matrix, gating, mandates, and policy effects
pnpm test tests/unit/admission-core.test.ts

# 3. Verify per-thread burst coalescing, timeout requeue, and deadline shifting
pnpm test tests/unit/admission-evals.test.ts

# 4. Verify context window builder and LiteLLM Assessor structured outputs
pnpm test tests/unit/admission-context-and-assessor.test.ts

# 5. Verify PostgreSQL RLS, RBAC, and Fastify REST API endpoints
pnpm test tests/integration/attention-firewall-api.test.ts
```

---

## 3. End-to-End Walkthrough Scenarios

### Scenario 1: Zero-Token Deterministic Filter (Human Assignee Exclusion)

- **Given**: Policy has `ignoredAssignees: ["mohamed"]`.
- **Action**: Ingest a webhook for an issue assigned to `mohamed`:
  ```bash
  curl -X POST http://localhost:3000/api/v1/webhooks/vcs/github/issues \
    -H "Content-Type: application/json" \
    -d '{"action": "opened", "issue": {"title": "Button misalignment", "assignee": {"login": "mohamed"}}}'
  ```
- **Expected Outcome**:
  - Response `202 Accepted` from webhook receiver.
  - Trigger disposition recorded as `dropped`, `reason_code: 'ignored_assignee'`.
  - Zero calls made to LiteLLM (0 tokens consumed).

---

### Scenario 2: Inferred Request in Observe Mode ("Needs You" Proposal)

- **Given**: Policy `mode: 'observe'` with enabled rule `visual`.
- **Action**: Ingest an unaddressed issue comment describing a visual bug:
  ```bash
  curl -X POST http://localhost:3000/api/v1/webhooks/vcs/github/issue_comments \
    -H "Content-Type: application/json" \
    -d '{"action": "created", "comment": {"body": "The sign-in button is overlapping with text on mobile."}}'
  ```
- **Expected Outcome**:
  - Deterministic gate classifies trigger as `strength: 'inferred'`.
  - LiteLLM Assessor evaluates bounded window (root issue + comment) and confirms match with rule `visual`.
  - System records a `Decision` with:
    - `verdict: 'ignore'`
    - `reason_code: 'observed'`
    - `proposal: { "title": "Fix sign-in button mobile overlap", "scope": "..." }`
  - Zero tasks created in `tasks` table (no phantom container runs).

---

### Scenario 3: Human Promotion of Observed Proposal

- **Action**: Human operator reviews proposals via `GET /api/v1/projects/:id/admission/decisions?kind=observed` and promotes proposal `dec_123`:
  ```bash
  curl -X POST http://localhost:3000/api/v1/projects/$PROJECT_ID/admission/decisions/dec_123/promote \
    -H "Authorization: Bearer $TGT_TOKEN"
  ```
- **Expected Outcome**:
  - Status `201 Created`.
  - New task created in `tasks` with `status: 'QUEUED'`.
  - `tasks.mandate` contains:
    - `mandateId`: UUID
    - `policyVersion`: '<64-char SHA256 hash>'
    - `basis.via`: `'manual'`
    - `authorizedBy`: User ID of promoting developer.

---

### Scenario 4: Live Policy Modification & `policyEffects()` Notification

- **Given**: An active running task `TASK-101` created under rule `copy`.
- **Action**: Operator updates policy via `PUT .../admission/policy` disabling rule `copy`.
- **Expected Outcome**:
  - `policyEffects()` detects that `TASK-101` was authorized under a rule that is now disabled.
  - Orchestrator injects an advisory message (`task.inject`) to the running container notifying it of the policy change.
  - System logs an audit record linking old and new policy version hashes.


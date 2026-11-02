# Graywolf Squad — Deep-Dive Architecture: Review Gates, Guardrails & Human Autonomy

## 1. Executive Summary

Autonomous coding agents must balance **high internal autonomy** (so developers are not spammed with intermediate questions) with **absolute external safety** (so the agent cannot unilaterally alter critical architecture or break production).

Graywolf Squad enforces a strict principle:
> **"Unconstrained autonomy inside the task sandbox; rigorous, standard-based gating at the system boundaries."**

Instead of building a proprietary in-app code review interface, Graywolf Squad leverages **industry-standard Pull/Merge Requests (GitHub, GitLab, Bitbucket via `repo-sdk`)** as the primary review vehicle, paired with **Blocking Clarification Subtasks** on the Kanban board for mid-flight questions.

---

## 2. The Line of Autonomy: What Is Autonomous vs. What Is Gated

```
┌──────────────────────────────────────────────┐       ┌────────────────────────────────────────────────┐
│      FULLY AUTONOMOUS (Inside Sandbox)       │       │         MANDATORY HUMAN APPROVAL GATES         │
├──────────────────────────────────────────────┤       ├────────────────────────────────────────────────┤
│ • Code synthesis & refactoring               │       │ 1. Blast-Radius Boundary Escalation            │
│ • Local file creation within Writable scope  │       │ 2. Irreversible / Destructive DDL Operations   │
│ • Package installation inside sandbox test   │ ────► │ 3. Security Vulnerability / Secret Exposure     │
│ • Internal build, lint, and test iterations  │       │ 4. Final Upstream Merge to Protected Branches  │
│ • Playwright headless browser E2E runs       │       │ 5. Task Cost / Token Budget Threshold Exceeded │
│ • Reviewer persona automated sign-offs       │       │ 6. Two-Strike Internal Review Failure          │
└──────────────────────────────────────────────┘       └────────────────────────────────────────────────┘
```

### 2.1 The 6 Mandatory Human Approval Gates

**CRITICAL RULE: "Progressive Trust" (e.g., granting an agent Writable scope elevation for 2 hours) CANNOT bypass these six gates.** Trust elevation only expands the Writable domain scope. These six gates remain atomic, per-instance approvals regardless of trust elevation.

1. **Blast-Radius Scope Escape**:
   - If a brownfield task is restricted to `src/modules/billing/**`, but the agent determines it must modify `src/core/auth/jwt.ts` or `.github/workflows/ci.yml`.
   - **Action**: Hard halt. Emits `escalation-request.md` and generates a blocking subtask assigned to human.
2. **Destructive / Irreversible Operations**:
   - Any SQL containing `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, destructive migrations, or modifications to cloud infrastructure definitions.
3. **Security, Licensing & Secret Violations**:
   - Inclusion of hard-coded credentials/keys detected via static regex scanners.
   - Introduction of packages with copyleft licenses (GPL/AGPL in non-GPL repos) or Critical/High CVEs.
4. **Final Upstream Merge**:
   - The agent never pushes directly to `main` or `release/*`. All output is delivered via Pull/Merge Request.
5. **Token / Monetary Budget Exceeded**:
   - If a task exceeds its allocated spend cap (`spendLimitUSD`, e.g. $3.00), execution halts immediately.
6. **Two-Strike Review Rejection**:
   - If in-container Dev-Level-2 Reviewer rejects the implementation twice, the loop breaks and escalates to human review.

### 2.2 Dynamic Configuration (`project.config.json`)

```jsonc
{
  "blastRadius": {
    "forbidden": [
      ".github/**",
      "src/core/auth/**",
      "**/migrations/**",
      "package.json"
    ]
  },
  "taskTags": {
    "db-migration": { "requireHumanPlanApproval": true },
    "security": { "requireHumanPlanApproval": true }
  },
  "limits": {
    "dailySpendCapUSD": 20.00,
    "internalReviewMaxAttempts": 2,
    "maxAutonomousRevisionsPerTask": 5,
    "webhookDebounceMs": 180000
  }
}
```

---

## 3. The 60-Second Review Gate: Standard PRs + Executive Review Packet

### 3.1 Why Native Pull Requests (GitHub / GitLab)?
- **Zero UI Friction**: Developers already live in GitHub / GitLab PR interfaces with inline diff commenting, code owners, and mobile review apps.
- **CI/CD Alignment**: Native PRs automatically trigger external enterprise CI/CD checks (SonarQube, CircleCI, GitLab CI).
- **Universal Audit Trail**: Keeps the exact commit history and approvals in the customer's enterprise VCS.

### 3.2 The 60-Second "Executive Review Packet" (PR Body Schema)

When Graywolf finishes a task, the orchestrator opens a Draft PR via `repo-sdk` with an auto-generated description structured for rapid scanning:

```markdown
## 🐺 Graywolf Squad — Task Summary: [TASK-104] Add Egyptian VAT 14% Calculation

### ⚡ Executive Overview (10-Second Read)
- **Objective**: Implement 14% VAT computation for physical goods checkout flow.
- **Affected Domain**: Billing & Invoicing (`src/modules/billing/**`).
- **Blast-Radius Compliance**: ✅ 100% compliant. 3 files modified, 0 protected files touched.
- **Cost & Turns**: $0.42 LiteLLM spend | 3 virtual turns | 0 review strikes.

---

### 🛡️ Quality & Security Gates
| Gate | Status | Details |
| :--- | :--- | :--- |
| **Blast Radius** | 🟢 PASSED | All edits confined to `src/modules/billing/**` |
| **Unit Tests** | 🟢 PASSED | 14/14 passed (+4 new tests, 0 regressions) |
| **Playwright E2E** | 🟢 PASSED | 2/2 scenarios passed (Checkout Flow) |
| **Security / Secret Scan** | 🟢 PASSED | 0 secrets found, 0 high/critical CVEs |
| **License Check** | 🟢 PASSED | All dependencies MIT / Apache 2.0 |

---

### 📸 Visual Proof (Playwright Artifacts)
| Checkout Calculation State | VAT Breakdown Modal |
| :---: | :---: |
| ![Checkout Screenshot](https://raw.githubusercontent.com/.../screenshot_checkout.png) | ![Modal Screenshot](https://raw.githubusercontent.com/.../screenshot_modal.png) |

> 🎥 **[Click to View Automated Playwright Flow Recording (.webm)](https://...)**

---

### 📂 Blast-Radius, Files Changed & Confidence Scores
*Agent confidence scores (ADR-033) are surfaced per-file to explicitly highlight where human scrutiny is most needed, especially in polyglot repos where the human reviewer may not be an expert in the target language. Ambiguous patterns (e.g. unverified query builders without provably scoped ORM wrappers) automatically trigger confidence penalties.*

- `[NEW]` `src/modules/billing/vat-calculator.ts` (+82 lines) — 🟢 **High Confidence (98%)** (Deterministic types matched, robust tests)
- `[MOD]` `src/backend/go/checkout_worker.go` (+14 lines) — 🟡 **Medium Confidence (75%)** (Concurrency channels added, please review mutex placement)
- `[MOD]` `src/backend/repository/invoice_repo.go` (+28 lines) — 🔴 **Low Confidence (55%) — Human Review Urged** (Query modified without provably-scoped wrapper; check multi-tenant `org_id` predicate!)
- `[NEW]` `tests/modules/billing/vat-calculator.spec.ts` (+44 lines) — 🟢 **High Confidence (100%)**
```

### 3.3 The 60-Second Review Mental Model:
1. **0–15s**: Read Executive Overview & verify green Quality Gate badges.
2. **15–30s**: Inspect embedded Playwright UI screenshot to verify visual correctness.
3. **30–50s**: Review the scoped 3-file diff in GitHub/GitLab's native diff viewer.
4. **50–60s**: Click **"Approve & Merge"**.

---

## 4. Ambiguity Resolution: Blocking Clarification Subtasks

When the agent requires human input, it does not stop the entire project or spew questions into an unstructured terminal log.

### 4.1 The Subtask Pattern on the Kanban Board
1. **Parent Task State**: Transitions from `IN_PROGRESS` to `BLOCKED` (`AWAITING_CLARIFICATION`).
2. **Child Subtask Generation**: The orchestrator spawns a high-priority child subtask:
   - **ID**: `TASK-104.1`
   - **Title**: `[CLARIFICATION REQUIRED] VAT rate for professional services vs goods`
   - **Assignee**: Assigned directly to the human developer.
   - **Description**: Contains the exact concise questions (max 5) formulated by `Dev-Level-1 Planner` in `clarification-request.md`.
3. **Cockpit Alert**: Pushed immediately to the Chat Cockpit:
   > *"Task 104 is blocked: Waiting for your answer on VAT rate categorization in TASK-104.1."*

### 4.2 Resuming Execution
- The human answers via:
  - Natural language in the **Chat Cockpit** (*"Services are 10%, physical goods are 14%"*), OR
  - Marking `TASK-104.1` complete with comments on the Kanban card.
- The subtask is marked `RESOLVED`.
- The parent task unblocks, injects the user's answers into `plan.md`, and resumes sandbox execution without cold-booting.

### 4.3 Two-Strike Review Escalations: The Decision Memo (ADR-050)

When a task triggers a **Two-Strike Review Escalation** (Dev-Level-2 rejects Dev-Level-3 twice consecutively), the platform must NOT dump raw Git diffs or technical model debates onto operators who may not be experts in the target language.

#### Neutral Arbiter Authorship (N8):
To prevent structural conflicts of interest (e.g. if Dev-Level-1 was a party to the architectural disagreement or authored the rejected plan), the memo is synthesized by an independent **Neutral Arbiter Model Profile** (LiteLLM alias `agent-arbiter` / Orchestrator PM tier). The arbiter reads the task brief, the two strike rejection logs, and the patch diff, producing an objective, unbiased **Escalation Decision Memo** (`escalation-memo.md`):

```markdown
## ⚖️ Escalation Decision Memo: [TASK-112] Go Error Wrapping vs Custom Structs

### 📝 The Core Dispute in Plain English
Dev-Level-3 implemented error handling using a custom struct type `AppError`. Dev-Level-2 rejected this twice, arguing that standard library `fmt.Errorf("...: %w", err)` error wrapping is the established convention in `pkg/errors/errors.go` and is required for `errors.Is` to work in upstream handlers.

### 🔍 Trade-offs & Consequences
- **Option A (Dev-Level-2's Proposal — Recommended)**:
  - *Action*: Refactor to use `fmt.Errorf("...: %w", err)` with typed sentinel errors.
  - *Pro*: 100% consistent with the rest of your Go backend; preserves call-stack unwrapping.
  - *Risk*: Takes ~1 additional minute and $0.15 in tokens to adjust 3 call sites.
- **Option B (Dev-Level-3's Proposal)**:
  - *Action*: Keep `AppError` struct as written.
  - *Pro*: Immediately ready to merge.
  - *Risk*: Creates architectural drift; callers cannot easily inspect underlying network errors.

### 🎯 Architect Recommendation
**Option A**. It preserves long-term codebase consistency.

---
[ 🟢 Proceed with Option A (Recommended) ]  [ 🟡 Accept Option B ]  [ 💬 Discuss in Cockpit ]
```

#### Async Notification & Non-Blocking Pipeline:
1. **Async Push Dispatch**: Pushes an immediate notification via webhook (Slack, Discord, Email, Mobile Push) so overnight escalations never stall the developer until morning.
2. **Non-Blocking Execution**: While the parent task awaits human input on Option A/B, other non-dependent tasks in the project DAG continue executing in parallel; the squad does not deadlock.
3. **Explicit Decision Attribution in Audit Trail (N14)**: When an operator makes a selection (e.g. clicking "Proceed with Recommended Default"), the resulting Pull Request compliance table and task audit ledger record the exact election:
   `| Escalation Resolution | 🟢 RESOLVED | ESC-112 resolved via Operator Default-Proceed (Option A) by @tarek (Audit #op-91a-c4) |`
   This ensures complete auditability and eliminates the "decision with no decision-maker" blind spot.
4. **Historical Workspace Spend Estimator (N14)**: When configuring `orgSpendLimitHardCapUSD`, the settings dashboard analyzes historical project telemetry to recommend informed limits:
   > *"Based on your historical burn ($32.00/day across 61 tasks), recommended monthly workspace cap is $150.00–$250.00."*

---

## 5. The PR Review Feedback Loop (Iterative Revision via Comments)

If the human developer reviews the PR on GitHub/GitLab and requests changes:

```
[Human leaves PR Review comment on GitHub/GitLab]
                     │
                     ▼
[repo-sdk Webhook receives pull_request_review event]
                     │
                     ▼
[Orchestrator awakens Task Container in Worktree]
                     │
                     ▼
[Injects review comments into Dev-Level-1 / Dev-Level-3]
                     │
                     ▼
[Agent applies revisions + re-runs unit & Playwright tests]
                     │
                     ▼
[Pushes new commit to existing PR branch + updates PR summary & screenshots]
```

This makes Graywolf feel like a real junior-to-mid developer sitting in the team: you comment on their PR, they push updates to the branch, and they update the screenshots automatically.

### 5.1 Webhook Debounce & DoW Mitigation

To prevent **Denial of Wallet (DoW)** attacks or accidental budget exhaustion from rapid-fire PR comments:
- **Webhook Debounce**: The orchestrator enforces a configurable debounce period (`webhookDebounceMs`, default 3 minutes). It will aggregate all incoming PR comments into a single revision task dispatch rather than spinning up a new container for every individual comment.
- **Revision Count Ceiling**: The `maxAutonomousRevisionsPerTask` (default 5) puts a hard upper limit on how many times an agent will respond to external webhook comments. If this limit is exceeded, the orchestrator ignores further webhooks for that PR until a human lead explicitly unblocks it via the dashboard.

---

## 6. The "Panic Button" (Graceful Stop/Cancel)

A critical component of operator trust is the ability to immediately halt a runaway agent. If a user clicks "Cancel" on a task in the Cockpit, the orchestrator MUST perform a multi-layered teardown, rather than simply dropping the web socket connection.

### 6.1 Teardown Sequence
1. **Container Process Group Kill**: A `SIGTERM` (followed by `SIGKILL` if timeout) must be sent to the container's process group, ensuring child processes (e.g., `npm install`, Playwright dev servers) are destroyed, freeing bound ports and memory.
2. **LLM Abort**: Any pending outbound requests to the LiteLLM Proxy are aborted to prevent stranded token spend.
3. **Database Drop**: Any ephemeral PostgreSQL template databases (e.g., `task_{id}`) created for the sandbox are explicitly dropped (`DROP DATABASE task_{id}`).
4. **Worktree Revert**: Uncommitted file changes in the task's worktree are wiped (`git restore . && git clean -fd`).
5. **State Update**: The task is marked as `CANCELLED_BY_USER` in the orchestrator database.

---

## 7. Static Analysis & Architectural Guardrails

To prevent architectural drift and ensure production safety in a polyglot environment, Graywolf Squad enforces deterministic static analysis gates during the CI and Review phases. These guards operate independently of the agent's LLM reasoning and cannot be bypassed.

### 7.0 Systemic Diff-Scoping & Taxonomy (Brownfield Protection)
- **CRITICAL RULE**: Static analysis rules MUST be scoped to prevent red-walling existing brownfield codebases. The baseline is always **the task's base SHA** (the worktree checkout point).
- **Scoping Taxonomy**:
  1. **Line-Scoped**: Applies only to changed hunks (e.g., `ripgrep` or `ast-grep` catching a new `console.log`).
  2. **File-Scoped**: Whole-file rules for new or modified files (e.g., migration safety).
  3. **Path-Scoped**: Structural bans (e.g., Gap 15) evaluated against new/moved files only.
- **Move-Attribution Quirk**: Tools like `golangci-lint --new-from-rev` re-attribute moved code as new. The platform MUST suppress move-attribution (or explicitly document it) to prevent drive-by refactors from triggering red-walls on unmodified legacy code.

### 7.1 Go Error Wrapping Guard (`ripgrep` + `errorlint`)
- **Gap Addressed**: Loss of error chains and `errors.Is`/`errors.As` support.
- **Implementation**: 
  - `ripgrep` acts as a **cheap high-recall pre-filter** to detect `%v` inside `fmt.Errorf`.
  - `errorlint` (via `golangci-lint`) acts as the **deterministic authority**. It performs proper SSA analysis to verify whether an actual `error` type is being wrapped with `%v` instead of `%w` (preventing false positives like `fmt.Errorf("user %v not found", userID)`).

### 7.2 Unbounded Goroutine Spawn Guard (`ast-grep`)
- **Gap Addressed**: Goroutine leaks from unbounded concurrency leading to task hang and orchestrator timeout.
- **Rule**: An `ast-grep` policy enforces that `go func()` spawns must be bound to a synchronization primitive (e.g., `errgroup.Group`) or explicitly pass a `context.Context` to handle cancellation.
- **Implementation**: The pipeline uses tree-sitter AST queries with relational rules (e.g., `inside` a function declaration with a `ctx` parameter) to reliably detect context passing, rejecting raw `go func() { ... }()` calls lacking bounded context logic.

### 7.3 Banned `context.Background()` Usage (`ast-grep`)
- **Gap Addressed**: Accidental breaks in trace propagation and timeout deadlines.
- **Rule**: Explicitly bans `context.Background()` inside any function that accepts a `ctx` parameter.
- **Implementation**: Handled via relational `ast-grep` rules.
- **Exception Scope**: Graceful shutdown and cleanup paths explicitly require a fresh `context.Background()`-derived timeout; these paths are exempted from the rule.

### 7.4 TypeScript Trust Boundary Assertions (`ast-grep`)
- **Gap Addressed**: Blanket type assertions hiding data shape drift.
- **Rule**: Bans `as Foo` assertions strictly at trust boundaries. **Configuration Requirement (F16)**: The specific trust-boundary anchor list (e.g., `response.json()`, `JSON.parse`, `localStorage`, `postMessage`, WebSocket frames) MUST be dynamically seeded by the recon pass as constitution variables, not hardcoded. Idiomatic usage like `event.target as HTMLInputElement` stays warn-level.

### 7.5 Path-Scoped Banning (e.g., Database Connections)
- **Gap Addressed**: Database logic leaking into arbitrary application layers.
- **Rule**: Forbids invoking connection pools like `sql.Open` outside of the sanctioned database module. **Configuration Requirement (F16)**: The sanctioned path (e.g., `internal/database/**`) MUST be seeded by the recon pass as a constitution variable. This allows the guard to adapt to any repo layout without fighting it.

### 7.6 Redis Namespacing (Gap 15 Pattern)
- **Gap Addressed**: Tenant collision vectors in shared KV stores.
- **Rule**: The literal-key lint (e.g. `redis.Set("shipment:123", ...)`) is bypassable by dynamic strings (e.g. `fmt.Sprintf`). Therefore, the primary deterministic enforcement relies on the **Gap 15 Pattern**: direct Redis client imports are **banned** outside of the sanctioned cache module (e.g., `internal/cache/**`, recon-seeded). The keybuilder encapsulating the workspace ID must live inside that module. The literal lint stays as a cheap auxiliary check.

### 7.7 Schema-Aware SQL Validator
- **Gap Addressed**: Drift between Go structs (or TS interfaces) and the actual database schema columns.
- **Rule**: An automated validation step intercepts inline SQL and query builders in the codebase. It statically cross-references projected/inserted columns against the canonical PostgreSQL schema defined in `data-model.md` or the live database schema definition.

### 7.8 Migration Safety Analyzer (ADR-047 Collision Resolution)
- **Gap Addressed**: Backward-incompatible database changes breaking live deployments.
- **Rule**: The migration pipeline intercepts all generated SQL migrations (triggered strictly by `**/migrations/**` path hits or migration-directory ledger hits).
- **Implementation**: 
  - **Syntactic**: Uses parsed AST (`pg_query_go`) to deterministically block destructive DDL operations like `DROP COLUMN` and `RENAME COLUMN`.
  - **Behavioral (Orchestrator Prepares, Sandbox Executes)**: 
    - The Orchestrator resolves the baseline ref (previous release tag) and materializes it via `git archive` into a read-only `/baseline` volume, mounted into the Sandbox.
    - The Sandbox applies the migration to the Tier 2 ephemeral DB and runs the `/baseline` test suite against it. Baseline tests failing proves backward incompatibility. Emits `backward_compat_results.json` as a mandatory artifact.
  - **Cost Control**: Scoped to integration/repository-layer tests only, utilizing `-short` flags, time-boxed via the idle-timeout machinery, and the budget estimator is informed.
  - **Concurrency Precedence**: Recon discovers runner mode (`transactionalMigrations: true|false`). If `true`, `CONCURRENTLY` is invalid (errors inside transactions). If `false`, plain `CREATE INDEX` warns with lock-table rationale. Each rule binds strictly to the runner mode.

### 7.9 Polyglot Contract Registry (Gap 4, N11b Integration)
- **Gap Addressed**: Silent contract drift across language boundaries for non-HTTP asynchronous payloads (e.g., BullMQ queue jobs, Redis Pub/Sub messages, WebSocket broadcast frames). Unlike HTTP endpoints (which are governed by OpenAPI contracts via ADR-049), asynchronous event envelopes traditionally lack cross-language compile-time safety between Go backend workers and TypeScript frontend/worker services.
- **Registry Specification**:
  - **Location & Format**: Language-agnostic canonical schemas are maintained in `.agents/contracts/` using JSON Schema (Draft 2020-12) or Protobuf (`.proto`).
  - **Type Derivation**: Neither Go nor TypeScript owns the source of truth. Types are generated via deterministic toolchains (`quicktype` for Go structs in `pkg/contracts/`, `json-schema-to-typescript` for TypeScript interfaces in `src/contracts/`).
- **Severity Classification (N11b Enforcement)**:
  - When a task touches messaging contracts, the orchestrator generates a diff against the baseline schema and assigns an explicit severity tier:
    1. **Breaking Contract Changes (Hard Red-Gate Block)**:
       - Deleting fields from an existing payload schema.
       - Changing primitive types (e.g., `string` to `number`).
       - Converting an optional property into a required field.
       - Renaming queue topic names, event discriminators, or WebSocket message types.
       - *Enforcement*: Hard failure in Tier 2 deterministic guard. Emits `.agents/tasks/{TASK_ID}/review/contract_violation.json`. Halts autonomous merging and requires human operator sign-off in the Executive Review Packet.
    2. **Additive Contract Changes (Green Informational Pass)**:
       - Adding new optional fields with backwards-compatible defaults.
       - Registering new event topics or message types that do not alter existing listener contracts.
       - *Enforcement*: Non-blocking green pass. Logged as `additive_schema_evolution` in the PR summary.
- **Diff-Scoping (F11)**:
  - Contract validation is strictly scoped to schemas modified or added within the task's patch relative to the base commit. Legacy brownfield payloads outside the active blast radius are never red-walled.

### 7.10 Sanctioned Suppression & Inverse Guard
- **Gap Addressed**: Without a front door, suppressions get improvised. 
- **Rule**: A standard suppression pattern is sanctioned: `// graywolf:ignore(<rule-id>) <reason> @ <YYYY-MM-DD>`. 
- **Mechanism**: Suppressions have a **90-day expiry**. Older suppressions will re-flag. All suppressions are surfaced explicitly in the Executive Review Packet.
- **Inverse Guard**: Naked suppressions (e.g., `//nolint`, `eslint-disable`, `# type: ignore`) in *new code* are explicitly targeted and banned by the guards.

### 7.11 Shadow Mode (Guardrail Incubation)
- **Gap Addressed**: Flawed new guards (false positives) train agents to route around the guard tier entirely.
- **Rule**: Every newly added deterministic guard runs in **report-only (shadow) mode** for its first 20 tasks, or until its measured false-positive rate falls below 10%. Only then does it flip to block severity.

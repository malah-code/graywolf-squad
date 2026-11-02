# Graywolf Squad — Deep-Dive Architecture: `relay.mjs` In-Container Harness Contract

## 1. Executive Summary & Security Criticality

`relay.mjs` is the **single most security-critical runtime component** in Graywolf Squad. It is the only executable that bridges the untrusted agent execution environment (where arbitrary LLM-generated code runs) with the trusted orchestrator infrastructure.

It enforces three absolute invariants:
1. **Non-Committing**: `relay.mjs` NEVER executes `git push`, `git commit` to upstream, or any operation that modifies the remote repository state. All work produces a `changes.patch` file.
2. **Blast-Radius Enforcement**: All file mutations by the agent are validated against the `writableScope` / `readonlyScope` / `forbiddenScope` boundaries BEFORE being written to disk.
3. **Spend Ceiling Enforcement**: Every LLM call cost is accumulated locally and compared against `spendLimitUSD`. The relay halts execution the moment the ceiling is breached.

---

## 2. Runtime Environment

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Ephemeral Runner Container (Docker / Podman)                                           │
│                                                                                        │
│  User: graywolf (UID 10001, GID 10001)                                                │
│  Rootfs: Read-Only (--read-only)                                                       │
│  Writable Mounts: /workspace (git worktree), /tmp (tmpfs, noexec)                     │
│  Security: --cap-drop=ALL, --security-opt=no-new-privileges:true                      │
│  Network: Restricted egress (sandbox-hardening-and-network-egress.md)                  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ relay.mjs (Entry Point — PID 1 in container)                                     │  │
│  │                                                                                  │  │
│  │  1. Connects to orchestrator WebSocket (relay-protocol.md)                       │  │
│  │  2. Receives task.dispatch → unpacks context bundle                              │  │
│  │  3. Orchestrates Dev-Level-1 → Dev-Level-3 → Dev-Level-2 cognitive handoff       │  │
│  │  4. Enforces blast-radius, spend ceiling, and non-commit invariants              │  │
│  │  5. Produces result.json + changes.patch → sends result.final                    │  │
│  │  6. Exits cleanly (code 0 = success, 1 = error, 137 = OOM)                      │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Environment Variables (Injected by Orchestrator at Container Spawn)

| Variable | Example Value | Purpose |
| :--- | :--- | :--- |
| `RELAY_AUTH_TOKEN` | `eyJhbGciOiJFUzI1NiI...` | Ephemeral JWT for WebSocket authentication (5-min TTL, auto-refreshed) |
| `RELAY_ORCHESTRATOR_URL` | `ws://orchestrator:3001/relay` | WebSocket endpoint |
| `RELAY_TASK_ID` | `TASK-104` | Current task identifier |
| `RELAY_WORKSPACE_ID` | `550e8400-e29b-41d4-...` | Workspace UUID for RLS scoping |
| `OPENAI_BASE_URL` | `http://litellm-proxy:4000` | LiteLLM proxy endpoint (all model calls route here) |
| `OPENAI_API_KEY` | `sk-graywolf-internal-proxy-token` | Internal proxy token (NOT a real provider key) |
| `RELAY_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

> **Security Note**: No real provider API keys, Git PATs, or third-party secrets exist in the container environment. All are proxied via the Secrets Broker Sidecar (ADR-018) and LiteLLM Proxy (ADR-005).

---

## 3. Lifecycle Phases

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: BOOT (< 2 seconds target)                                              │
│                                                                                 │
│  1. Parse environment variables                                                 │
│  2. Connect to orchestrator WebSocket                                           │
│  3. Authenticate with RELAY_AUTH_TOKEN                                           │
│  4. Receive task.dispatch message                                               │
│  5. Unpack context bundle:                                                      │
│     - brief.md (task specification)                                             │
│     - project.config.json (blast-radius, model routing, guardrails)             │
│     - constitution.md (architectural rules)                                     │
│     - repo-map.md (Layer 1 topological overview)                                │
│     - relevant_lessons[] (Layer 4 from continuous learning engine)               │
│  6. Initialize blast-radius guard (compile glob matchers)                       │
│  7. Initialize spend accumulator (currentSpendUsd = 0.0)                        │
│  8. Initialize file mutation ledger (empty set)                                 │
│  9. Run package installation: npm ci / pip install (Tier 1 cache, < 5s)         │
│ 10. Emit status.update: QUEUED → IN_PROGRESS                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 2: COGNITIVE HANDOFF (Virtual Developer Tiers)                             │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step A: Dev-Level-1 (Planner)                                             │  │
│  │  - Receives: brief.md + constitution + repo-map + lessons                 │  │
│  │  - Produces: plan.md (implementation strategy, file mutations, db tier)   │  │
│  │  - Validates: All planned file paths within writableScope                 │  │
│  │  - If scope violation: Emit escalation.emit → HALT                        │  │
│  └──────────────────────────────────┬────────────────────────────────────────┘  │
│                                     ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step B: Dev-Level-3 (Implementer)                                         │  │
│  │  - Receives: plan.md + full read access to /workspace                     │  │
│  │  - Executes: Code synthesis, file creation/modification, package install  │  │
│  │  - Every file write intercepted by blast-radius guard                     │  │
│  │  - Produces: Modified files in git worktree + unit tests                  │  │
│  └──────────────────────────────────┬────────────────────────────────────────┘  │
│                                     ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Step C: Dev-Level-2 (Reviewer)                                            │  │
│  │  - Phase C.1: Deterministic pre-filter (ast-grep, ripgrep, osv-scanner)  │  │
│  │    └── If violation: Instant reject (0 tokens) → back to Step B          │  │
│  │  - Phase C.2: LLM-powered semantic review                                │  │
│  │  - Phase C.3: Execute test suite (npm test / pytest)                      │  │
│  │  - Phase C.4: Execute Playwright E2E (if ui-change tagged)               │  │
│  │  - Produces: review-signoff.md (approved | rejected)                      │  │
│  │  - If rejected: Increment internalReviewAttempts                          │  │
│  │    └── If attempts ≥ 2: Two-strike escalation → HUMAN_REVIEW_GATE        │  │
│  │  - If approved: Proceed to Phase 3                                        │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Phase 3: ARTIFACT COLLECTION & TEARDOWN                                         │
│                                                                                 │
│  1. Generate changes.patch: git add -A && git diff --binary --full-index HEAD > changes.patch │
│  2. Collect artifacts into .agents/tasks/{TASK_ID}/review/:                     │
│     ├── changes.patch                                                           │
│     ├── result.json                                                             │
│     ├── plan.md                                                                 │
│     ├── review-signoff.md                                                       │
│     ├── playwright-report/ (if applicable)                                      │
│     └── screenshots/ (if applicable)                                            │
│  3. Send artifact.ready for each artifact                                       │
│  4. Send result.final with complete RelayResult                                 │
│  5. Receive close frame acknowledgment from orchestrator                        │
│  6. Close WebSocket, write result.json to disk                                  │
│  7. Exit with code 0                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Blast-Radius Guard (File Mutation Interceptor)

The blast-radius guard is a synchronous interceptor on every file system write operation within `/workspace`:

```typescript
export interface BlastRadiusGuard {
  writableGlobs: string[];   // e.g. ['src/modules/billing/**', 'tests/modules/billing/**']
  readonlyGlobs: string[];   // e.g. ['src/database/models/**', 'src/shared/**']
  forbiddenGlobs: string[];  // e.g. ['src/core/auth/**', '.github/workflows/**']
  
  /**
   * Evaluates a proposed file path mutation.
   * @returns 'allow' | 'escalate'
   * @throws BlastRadiusViolation if path matches forbidden or is outside writable scope
   */
  evaluate(filePath: string, operation: 'create' | 'modify' | 'delete'): 'allow' | 'escalate';
}
```

### 4.1 Evaluation Priority

1. **Forbidden check** (highest priority): If path matches any `forbiddenGlobs` → **HARD HALT**. Emit `escalation.emit`, transition to `ESCALATED`.
2. **Writable check**: If path matches any `writableGlobs` → **ALLOW**. Log `file.mutation` event.
3. **Read-only check**: If path matches `readonlyGlobs` → **ESCALATE** with explanation.
4. **Default deny**: If path matches nothing → **ESCALATE** (fail-closed).

### 4.2 Protected System Files (Always Forbidden)

Regardless of `project.config.json` settings, the following are **always forbidden** for agent modification:

| Pattern | Rationale |
| :--- | :--- |
| `.git/**` | Direct Git internals manipulation |
| `.agents/project.config.json` | Self-modification of own configuration |
| `.agents/constitution.md` | Self-modification of own guardrails |
| `relay.mjs` | Self-modification of own runtime |

---

## 5. Spend Ceiling Enforcement

```typescript
export class SpendAccumulator {
  private currentSpendUsd: number = 0;
  private readonly limitUsd: number;  // from brief.md spendLimitUSD
  private readonly warningThreshold = 0.80; // 80%
  
  /**
   * Called after every LLM API call with the cost reported by LiteLLM.
   * @throws SpendCeilingExceeded if limit is breached
   */
  record(callCostUsd: number): void {
    this.currentSpendUsd += callCostUsd;
    
    // Emit cost.delta to orchestrator for real-time dashboard
    this.relay.send({
      type: 'cost.delta',
      payload: { costUsd: callCostUsd, totalUsd: this.currentSpendUsd }
    });
    
    // Warning at 80% — Actively steer the agent into wrap-up mode
    if (this.currentSpendUsd >= this.limitUsd * this.warningThreshold && !this.warningEmitted) {
      this.warningEmitted = true;
      this.relay.send({
        type: 'budget.warning',
        payload: {
          currentSpendUsd: this.currentSpendUsd,
          limitUsd: this.limitUsd,
          threshold: this.warningThreshold
        }
      });
      // Injects high-priority steering prompt into agent loop
      this.relay.injectSystemMessage(
        `[BUDGET_WARNING] 80% of spend limit reached ($${this.currentSpendUsd.toFixed(2)} / $${this.limitUsd.toFixed(2)}). ` +
        `Immediately switch to WRAP-UP MODE: complete your in-flight file edits, ensure your tests pass, ` +
        `and prepare the final patch diff.`
      );
    }
    
    // Hard ceiling (100%) — Flush checkpoint & salvage work instead of discarding
    if (this.currentSpendUsd >= this.limitUsd) {
      // 1. Stage ALL tracked and untracked files into the isolated scratch object store, then diff
      const patchSaved = this.relay.flushEmergencyPatch(); 
      // executes:
      //   git add -A
      //   git diff --binary --full-index HEAD > changes.patch
      const checkpoint = this.relay.writeCheckpoint({
        reason: 'budget_exceeded',
        spendUsd: this.currentSpendUsd,
        limitUsd: this.limitUsd,
        resumable: true
      });

      this.relay.send({ type: 'result.final', payload: {
        status: 'budget_exceeded',
        currentSpendUsd: this.currentSpendUsd,
        limitUsd: this.limitUsd,
        checkpointAvailable: true,
        patchSaved,
        checkpointPath: checkpoint.path
      }});
      process.exit(0); // Clean exit with state preserved for one-click resumption
    }
  }
}
```

### 5.1 Asynchronous Host-Streaming & Hard-Kill (OOM/137, SIGKILL) Recovery (N10)

Process-level exit handlers (like `process.exit(0)` or SIGTERM interceptors) cannot run when a container is killed uncatchably by the Linux kernel OOM killer (`exit code 137`) or immediate `SIGKILL`. To ensure zero work is lost even under catastrophic container termination:

1. **Continuous Real-Time Mutation Streaming**:
   - Every file write intercepted by the Blast-Radius Guard emits an asynchronous WebSocket event `file.mutation` to the Fastify orchestrator.
   - For files $< 256\text{ KB}$, the payload includes base64-encoded file contents and target path.
   - The orchestrator appends these writes to `.agents/tasks/{TASK_ID}/ledger/mutation_stream.log` and flushes them to host disk.
2. **Crash Reconstruction on Disconnect / Exit 137**:
   - If the container abruptly disconnects or terminates with exit code 137, the orchestrator detects the abnormal termination before `result.final` is received.
   - The orchestrator synthesizes `changes.patch.reconstructed` directly on the host from the mutation log, marking the task status as `CRASHED_RECOVERABLE` (`provenance: 'reconstructed'`).
   - The operator receives a Cockpit notification: *"Container halted unexpectedly (OOM/kill). 100% of in-flight file mutations were captured from the host stream. Click 'Resume' to continue in a fresh container."*

### 5.2 Resumable Budget Continuations & Multi-Layer Authorization (ADR-048, N15)
When a task halts at `budget_exceeded` or crashes:
1. The patch artifact (`changes.patch` or `changes.patch.reconstructed`) and `checkpoint.json` are retained on host disk with a **7-Day Retention TTL**.
2. The UI cockpit displays an **"Increase Budget & Resume"** button alongside historical spend benchmarks.
3. **Shipped Resumption Lifecycle**: Invoking `POST /api/v1/tasks/{id}/resume` with `{ additionalSpendLimitUSD: 5.00 }` provisions a **fresh container** with a clean base image, checks out the base branch, applies the preserved patch via `git apply --3way --binary`, and resumes `plan.md` execution.
   - If upstream `main` drifted during task execution, 3-way merge conflict detection flags it, invoking the Neutral Arbiter to synthesize an Escalation Decision Memo.

#### Security & Governor Guards on Resumption (N4):
To guarantee an agent container cannot call the resume endpoint to grant itself an infinite budget loop:
- **Network Segmentation (Topology A/B)**: Under ADR-040, Port 3000 (management API) listens on `control-net`/`edge-net`. Ephemeral task containers sit on `runner-net` and have **no network route to Port 3000**.
- **Server-Side Token-Class Verification (Topology C & Defense-in-Depth)**: The `POST /api/v1/tasks/{id}/resume` endpoint requires an authenticated **`OPERATOR_SESSION_TOKEN`** (human admin JWT/cookie). The handler strictly inspects the token claims and **rejects `RELAY_AUTH_TOKEN` with HTTP 403 Forbidden**.
- **Governor Hard Caps**:
  - `maxResumesPerTask`: Hard ceiling of **2 resumes** per task. Further budget increases require manual task re-creation.
  - `orgSpendLimitHardCapUSD`: Global workspace hard cap; no task resume can exceed the monthly workspace budget ceiling.

---

## 6. Non-Committing Git Operations

### 6.1 Allowed Git Commands

| Command | Purpose | Allowed? | Notes |
| :--- | :--- | :---: | :--- |
| `git status` | Inspect worktree state | ✅ | Reads index on tmpfs + worktree |
| `git diff` | Inspect unstaged work | ✅ | Worktree vs tmpfs index |
| `git diff --cached` | Inspect staged work | ✅ | tmpfs index vs read-only HEAD |
| `git diff --binary HEAD` | Generate full patch | ✅ | Captures ALL staged + unstaged changes including binaries |
| `git add` | Stage changes for patch generation | ✅ | Writes loose objects to scratch disk; updates tmpfs index |
| `git log` | Read commit history for context | ✅ | Reads read-only `.git/objects` and `HEAD` |
| `git blame` | Attribution analysis | ✅ | Read-only context query |
| `git checkout -- <file>` | Revert local changes during retry | ✅ | Restores from tmpfs index or read-only HEAD |

### 6.2 Blocked Git Commands (Hard-Blocked at Kernel and Wrapper Layers)

| Command | Reason | Enforcement |
| :--- | :--- | :--- |
| `git commit` | Non-committing invariant | Prohibited: cannot update `refs/heads/` (read-only filesystem) |
| `git push` | Non-committing invariant | Prohibited: network egress blocked + shell interceptor |
| `git merge` | Could corrupt worktree state | Prohibited: requires commit / ref update |
| `git rebase` | Could corrupt worktree state | Prohibited: requires commit / ref update |
| `git stash` | Modifies `refs/stash` and creates commits | Prohibited: use `relay_stash` tool (§6.4) |
| `git remote add/set-url` | Prevent exfiltration to rogue remote | Prohibited: wrapper interceptor + read-only `.git/config` |

### 6.3 Enforcement Mechanism: Triple-Layer Defense (ADR-047, N9)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: OS-LEVEL FILESYSTEM IMMUTABILITY (Kernel Invariant)               │
│ - /workspace/.git is mounted READ-ONLY (chmod -R 555 / :ro bind mount)    │
│ - Kernel denies writing to .git/refs/ or .git/HEAD with EROFS              │
│ - Physical impossibility: NO binary can commit, regardless of UID          │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: ISOLATED INDEX (TMPFS) & OBJECT STORE (SCRATCH DISK VOLUME)       │
│ - Container exports:                                                       │
│     GIT_INDEX_FILE=/tmp/graywolf/git/index          (tmpfs, RAM fast)      │
│     GIT_OBJECT_DIRECTORY=/scratch/git/objects       (scratch disk volume)  │
│     GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/.git/objects               │
│ - Staging writes loose objects to disk volume, preventing RAM-backed OOM   │
│ - Pre-flight size guard: Staging payloads > 256MB are blocked & escalated  │
│ - Auto deny-globs: dist/**, build/**, node_modules/**, vendor/**, *.node   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: HARDENED ARGUMENT & EXECUTION GUARD (/usr/local/bin/git)          │
│ - Strips global flags (-c, --git-dir, -C, etc.) to extract real subcommand│
│ - Catches and politely rejects blocked commands (exit code 128)            │
│ - Note: Setuid helpers are NOT used (disabled by no-new-privileges:true    │
│   and --cap-drop=ALL); security rests unconditionally on Layer 1 & Layer 2 │
└────────────────────────────────────────────────────────────────────────────┘
```

#### The Disk-Backed Scratch Object Store (N9):
Storing Git loose objects in memory-backed tmpfs created a critical failure mode: staging large build outputs or assets consumed container RAM, causing Playwright or compiler OOM kills (`exit 137`). Graywolf cleanly separates index and object storage:
1. `GIT_INDEX_FILE=/tmp/graywolf/git/index`: Keeps the index binary tree in RAM for sub-millisecond status checks.
2. `GIT_OBJECT_DIRECTORY=/scratch/git/objects`: Relocates loose object storage to an isolated, disk-backed scratch volume mounted with `noexec,nodev`. Sized to 10GB per container, completely uncoupling staging size from the container's 4GB RAM ceiling.
3. `GIT_ALTERNATE_OBJECT_DIRECTORIES=/workspace/.git/objects`: Reads historical commits from the read-only mount.
4. **Staging Pre-Flight Guard**: If an agent attempts `git add -A` and the proposed blob size exceeds **256 MB**, the wrapper blocks execution:
   `[GRAYWOLF RELAY] STAGING_SIZE_EXCEEDED: Staging payload would write 850MB of objects. Ensure build outputs (dist/, build/) are in .gitignore.`

### 6.4 Dedicated Stash Tool: `relay_stash` (N13)

Because `git stash` is strictly blocked by ADR-047 (read-only `.git` kernel mount prevents writing `refs/stash`), agents attempting to set aside unverified work or test alternative hypotheses require a dedicated, kernel-compliant stashing primitive. Under deterministic guard pressure (F12 suppressions, static AST gates), agents without a sanctioned stash mechanism inevitably improvise unsafe workarounds (e.g. copying files into temp directories or abandoning half-finished diffs).

The in-container relay exposes the tool `relay_stash`:

```typescript
export interface RelayStashOptions {
  action: 'save' | 'pop' | 'list' | 'drop';
  id?: string;               // Required for drop, optional for pop (defaults to latest)
  message?: string;          // Human-readable stash description for 'save'
  includeUntracked?: boolean;// Stash untracked files as well as modified (default: true)
}

export interface StashEntry {
  id: string;                // e.g. 'stash_1726531200_a1f9'
  message: string;           // e.g. 'WIP: Refactoring auth middleware'
  timestamp: string;         // ISO 8601
  fileCount: number;         // Total files captured
  files: string[];           // Relative file paths
  tarballPath: string;       // '/scratch/stash/stash_1726531200_a1f9.tar.gz'
}
```

#### Behavioral Invariants:
1. **`action: 'save'`**:
   - Queries dirty files via `git status --porcelain` (capturing unstaged, staged in tmpfs index, and untracked files if enabled).
   - Generates a unique stash identifier: `stash_${Date.now()}_${randomHex(4)}`.
   - Packages all target files into `/scratch/stash/{id}.tar.gz` on the disk-backed scratch volume (never in RAM-backed tmpfs).
   - Records metadata in `/scratch/stash/stash_index.json`.
   - Reverts the worktree to clean HEAD state: runs `git checkout -- .`, unlinks stashed untracked files, and clears the tmpfs Git index (`rm -f /tmp/graywolf/git/index`).
2. **`action: 'pop'`**:
   - Resolves target stash (latest if unspecified).
   - Verifies the current worktree is clean or contains no overlapping modifications with the archive. If collisions exist, halts with error `STASH_CONFLICT: Uncommitted changes conflict with stash contents`.
   - Extracts the tarball directly into `/workspace`.
   - Purges the tarball and removes the entry from `stash_index.json`.
3. **`action: 'list'`**:
   - Reads `/scratch/stash/stash_index.json` and returns all shelved entries with timestamps, file tallies, and descriptions.
4. **`action: 'drop'`**:
   - Deletes `/scratch/stash/{id}.tar.gz` and removes the entry from `stash_index.json`.
5. **Isolation Guarantee**: Stashes are strictly scoped to the container's ephemeral `/scratch` disk volume and are destroyed on container teardown. Stashes never leak across tasks or workspaces.

---

### 6.5 Manifest Write Lock Client (F14 Prerequisite)

When package manifests (`package.json`, `package-lock.json`, `go.mod`, `go.sum`, `Cargo.toml`) are in writable scope, concurrent agent tasks could clobber dependencies or create split-brain lockfile conflicts. `relay.mjs` enforces serialization:

1. **Automatic Package Manager Interception**:
   - `relay.mjs` wraps all package manager command invocations (`npm install`, `pnpm add`, `yarn add`, `go get`, `go mod tidy`, `cargo add`).
   - Prior to executing the child process, the relay dispatches an ARP request to the Orchestrator:
     ```json
     {
       "type": "manifest.lock.acquire",
       "payload": {
         "manifestPath": "package.json",
         "timeoutMs": 120000
       }
     }
     ```
2. **Lock Acquisition & Heartbeat**:
   - The relay blocks command execution until `manifest.lock.granted` is received from the Orchestrator with an assigned `lockToken` and a 60-second lease TTL.
   - During long installations, `relay.mjs` emits a 15-second heartbeat to refresh the Redis lease.
   - If the lock request times out after 120 seconds, `relay.mjs` aborts the command with exit code 126 and outputs:
     `[GRAYWOLF RELAY] MANIFEST_LOCK_TIMEOUT: Dependency manifest locked by another active task. Retrying or declare manifest in writableScope at dispatch.`
3. **Integrity Validation & Atomic Release**:
   - Once the installation finishes, `relay.mjs` executes a language-specific integrity check (`go mod verify` or `npm ls`).
   - The relay dispatches `manifest.lock.release` with `{ manifestPath, lockToken, success: true }`.
   - Records the updated manifest and lockfile in the task's `file.mutation` ledger for diff-scoping and review packet compilation.

---

## 7. Output Artifacts & `result.json` Contract

### 7.1 Output Directory Structure

```
.agents/tasks/{TASK_ID}/review/
├── changes.patch              # git diff of all modifications
├── result.json                # Machine-readable execution summary
├── plan.md                    # Dev-Level-1 implementation plan
├── review-signoff.md          # Dev-Level-2 review verdict
├── escalation-request.md      # (If escalated) Human decision request
├── playwright-report/         # (If UI tests ran)
│   └── index.html
├── test-results/              # (If E2E ran)
│   └── *.webm                 # Video recordings
└── screenshots/               # (If UI changes)
    ├── feature_happy_path.png
    └── edge_case_validation.png
```

### 7.2 `result.json` Schema

```typescript
export interface RelayResult {
  $schema: 'https://graywolfsquad.dev/schemas/delegate-relay.result.v1.json';
  version: 'delegate-relay.result.v1';
  taskId: string;
  status: 'completed' | 'failed' | 'escalated' | 'budget_exceeded' | 'cancelled' | 'disconnected';
  exitCode: number;            // 0 = success, 1 = agent error, 137 = OOM
  signal: string | null;       // 'SIGKILL' for OOM, null otherwise
  
  metrics: {
    durationMs: number;
    peakMemoryBytes: number;
    llmCallCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    cacheHitRate: number;      // 0.0 - 1.0
    internalReviewAttempts: number;
  };
  
  touchedFiles: string[];      // Paths modified relative to repo root
  
  blastRadius: {
    compliant: boolean;
    violations: string[];      // Empty if compliant
  };
  
  testResults: {
    unitTests: { passed: number; failed: number; skipped: number } | null;
    e2eTests: { passed: number; failed: number; skipped: number } | null;
    coverageDelta: number; // Percentage points change. MUST NOT BE NULL. Relay guarantees execution of `go test -cover` or `npm test -- --coverage` during flush.
  };
  
  agentReport: {
    summary: string;           // Human-readable narrative
    divergenceNotes: string;   // Deviations from plan.md
  };
}
```

---

## 8. Error Handling & Exit Codes

| Exit Code | Meaning | Orchestrator Response |
| :---: | :--- | :--- |
| `0` | Clean completion (check `result.json` for task-level status) | Process `result.json`, transition task state |
| `1` | Unrecoverable relay error (WebSocket failure, config parse error) | Mark task `ESCALATED`, notify human |
| `2` | Blast-radius violation (relay self-halted) | Mark task `ESCALATED`, create escalation subtask |
| `137` | OOM killed by kernel (Docker `--memory` limit exceeded) | Mark task `VERIFICATION_FAILED`, suggest splitting task |
| `143` | SIGTERM received (container being killed by orchestrator) | Mark task as `CANCELLED` |

---

## 9. Open-Source Foundation

| Responsibility | Library | License |
| :--- | :--- | :--- |
| Glob pattern matching (blast-radius) | `picomatch` | MIT |
| Git operations | Native `git` CLI (shell exec) | GPL-2.0 (CLI tool, not linked) |
| File watching (mutation tracking) | `chokidar` | MIT |
| Process management | Native Node.js `child_process` | MIT (Node.js) |
| Patch generation | Native `git diff` | GPL-2.0 (CLI tool, not linked) |
| WebSocket client | `ws` | MIT |

---

## 10. Dev-Level-3 Agent-Computer Interface (ACI) Schema

To achieve state-of-the-art developer ergonomics without importing complex, volatile external meta-frameworks, `relay.mjs` extracts battle-tested tool schemas from reference agent harnesses (DeepSeek Harness, OpenHands, SWE-bench).

To prevent scope creep during the initial proof-of-concept, the ACI is explicitly divided into **v1 (Thin Vertical Slice)** and **v2 (Full Platform Foundation)**.

### 10.1 V1 ACI (Thin Vertical Slice Requirements)

The initial slice requires robust primitives to prevent the agent from hanging on interactive prompts or butchering files:

```typescript
export interface V1AgentToolDefinitions {
  // PTY-Wrapped Sandboxed Shell Execution
  bash_execute: {
    parameters: {
      command: string;
      timeoutIdleMs?: number; // Idle timeout (no new stdout), NOT hard total execution timeout
    };
    execute: (args: { command: string; timeoutIdleMs?: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    // V1 Enforcement Rules:
    // 1. MUST wrap in a PTY.
    // 2. MUST automatically inject non-interactive baseline: 
    //    `CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 npm config set yes true`
    // 3. MUST auto-truncate output over ~1,000 lines (keeping head and tail).
    // 4. MUST respect network egress allowlists (ADR-028/030).
  };

  // Precise Search/Replace Modification
  edit_file: {
    parameters: {
      filePath: string;
      oldStr: string; // The exact contiguous block to replace
      newStr: string; // The replacement block
    };
    execute: (args: { filePath: string; oldStr: string; newStr: string }) => Promise<{ success: boolean; modifiedLines: number }>;
    // V1 Enforcement Rules:
    // 1. Exact match is the primary path (fails loudly and cheaply if model mis-transcribed whitespace).
    // 2. Fallback to narrow whitespace-normalization if exact match fails.
    // 3. HARD REJECT if `oldStr` matches more than one location in the file. NEVER silently pick the first match.
  };

  // Line-bounded file inspection
  view_file: {
    parameters: { filePath: string; startLine?: number; endLine?: number };
  };

  // Write new file or complete rewrite
  write_file: {
    parameters: { filePath: string; content: string };
  };
}
```

### 10.2 V2 ACI (Deferred to Full Orchestrator)

The following tools and mechanisms are deferred to v2 to keep the vertical slice minimal, but are critical for long-horizon tasks and complex multi-file refactors:

1. **`multi_edit` (Batched Atomicity)**: A tool accepting an array of `{file, search, replace}` operations applied as a single atomic batch, preventing the agent from running broken intermediate test suites during cross-file refactoring.
2. **Synchronous Fast-Path Linter Feedback**: Instead of a heavy `tsserver` LSP daemon, `relay.mjs` uses the project's configured `lintCommand` (`tsc --noEmit`, `eslint`, `ruff`) to run deterministically after edits. The output is fed synchronously back to Dev-Level-3 to catch typos quickly, and doubles as an incremental updater for the Layer 2 symbol index (avoiding full Tree-sitter re-indexes).
3. **Orchestrator-Enforced Scratchpad & Compaction**: 
   - A structural checkpoint forced by the harness every N turns (e.g., 8-10 calls) requiring the agent to summarize state, preventing context drift without relying on the LLM to optionally call a `write_scratchpad` tool.
   - A tool-call history compaction strategy that drops or summarizes older tool outputs as the session progresses, preventing the context window from suffocating on stale bash history.

### 10.3 Structured Trajectory Telemetry

Rather than emitting unstructured text dumps, the in-container runner emits typed trajectory events streamable over WebSocket via `e2c:output` (`payload.stream = 'trajectory'`) and serialized in `execution.log`:

```typescript
export type TrajectoryEvent = 
  | { type: 'thought'; content: string; timestamp: number }
  | { type: 'action'; tool: string; input: Record<string, unknown>; timestamp: number }
  | { type: 'observation'; output: string; durationMs: number; timestamp: number }
  | { type: 'reflection'; verdict: 'continue' | 'retry' | 'complete'; notes?: string; timestamp: number };
```

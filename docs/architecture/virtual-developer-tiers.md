# Graywolf Squad — Deep-Dive Architecture: Virtual Developer Tiers & Cognitive Handoff

## 1. Executive Summary & Problem Statement

Autonomous multi-agent platforms that execute code typically suffer from two architectural extremes:
1. **The Heavy Multi-Container Antipattern**: Spawning separate Docker containers for each persona (one container for the architect, one for the developer, one for the QA engineer). This introduces massive host RAM overhead, network latency, volume-locking deadlocks, and slow task execution loops.
2. **The Monolithic Prompt Trap**: Asking a single generic LLM to plan, write, test, and critique its own code in one continuous conversation. Models exhibit strong self-confirmation bias—they rarely catch their own subtle syntax mistakes, logical regressions, or architectural boundary escapes.

Graywolf Squad solves this through **Cognitive Virtual Developer Tiering inside a Single Ephemeral Container**. Rather than moving containers around, the task execution container runs a sequential, typed handoff between specialized virtual developer personas, each paired with an optimal model caliber.

---

## 2. Tier Definitions & Model Caliber Routing

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Task Container (Single Ephemeral Docker Sandbox)                                       │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-1: Lead Architect / Planner                                            │  │
│  │ • Caliber: Frontier Reasoning (Claude 3.5 Sonnet, Gemini 1.5 Pro, Qwen-2.5-72B)   │  │
│  │ • Input: Task brief, Topological Repo Map, Constitution, Past Lessons            │  │
│  │ • Emits: plan.md, designated implementer/reviewer tiers, requiredDbTier          │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ handoff.json (Phase 1 -> Phase 2)        │
│                                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-3: Senior Software Engineer / Implementer                              │  │
│  │ • Caliber: Fast, High-Throughput Code Synthesis (DeepSeek-V3, Haiku, Qwen-Coder) │  │
│  │ • Input: plan.md, surgical file slices, symbol definitions                       │  │
│  │ • Emits: edits, unit tests, candidate patch diff                                 │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ handoff.json (Phase 2 -> Phase 3)        │
│                                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Dev-Level-2: Rigorous Code Reviewer / Quality Gate                               │  │
│  │ • Caliber: High-Precision Analytical (Claude 3.5 Sonnet, GPT-4o, DeepSeek-V3)    │  │
│  │ • Input: plan.md, git patch diff, test execution suite                          │  │
│  │ • Executes: Unit tests, Playwright E2E suites, AST lint checks                   │  │
│  │ • Emits: review-signoff.md OR rejection notes (max 2 strikes)                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cognitive Handoff Protocol (`handoff.json`)

To prevent context bloat and token-spend explosion, personas **do not pass raw conversational history** to each other. Instead, each persona transition is mediated by a typed, compact `handoff.json` contract managed by the in-container harness (`relay.mjs`).

### 3.1 Handoff Contract Schema

```typescript
export interface CognitiveHandoff {
  version: "graywolf.handoff.v1";
  taskId: string;
  timestamp: string;
  fromTier: "dev-level-1" | "dev-level-2" | "dev-level-3";
  toTier: "dev-level-1" | "dev-level-2" | "dev-level-3" | "orchestrator";
  phase: "planning" | "implementation" | "review" | "revision";
  artifacts: {
    briefPath: string;           // .agents/tasks/<id>/brief.md
    planPath: string;            // .agents/tasks/<id>/plan.md
    patchPath?: string;          // .agents/tasks/<id>/candidate.patch
    signoffPath?: string;        // .agents/tasks/<id>/review-signoff.md
  };
  iterationContext: {
    strikeCount: number;         // 0, 1, or 2 (escalates at 2)
    rejectionReason?: "test_failure" | "boundary_violation" | "plan_deviation" | "syntax_error";
    reviewerNotes?: string;      // Targeted delta feedback from Dev-Level-2
    failedTestOutput?: string;   // Extracted failure message (last 50 lines)
  };
}
```

---

## 4. The Two-Strike Rejection & Revision Loop

When Dev-Level-2 (Reviewer) rejects an implementation, it does not restart the task from scratch or re-run the Planner. It initiates a targeted revision pass:

```
                  ┌──────────────────────────────────────────────┐
                  │ Dev-Level-3 (Implementer) writes code        │
                  └──────────────────────┬───────────────────────┘
                                         │ Emits candidate.patch
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ Dev-Level-2 (Reviewer) runs test suite       │
                  └──────────────────────┬───────────────────────┘
                                         │
                        Tests Fail / Deviates from Plan
                                         │
                                         ▼
                             Strike Count Check (< 2?)
                            /                         \
                     YES (Strike 1)              NO (Strike 2)
                           /                             \
                          ▼                               ▼
      ┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
      │ Construct Revision handoff.json      │  │ Task State:                       │
      │ • strikeCount: 1                     │  │ INTERNAL_REVIEW_FAILED            │
      │ • reviewerNotes: targeted fix        │  │ • Halt execution immediately      │
      │ • failedTestOutput: sanitized errors │  │ • Save worktree snapshot          │
      └──────────────────┬───────────────────┘  │ • Alert Human via Cockpit & Kanban│
                         │                      └───────────────────────────────────┘
                         ▼
      ┌──────────────────────────────────────┐
      │ Dev-Level-3 receives revision packet │
      │ Reads ONLY: plan.md + reviewerNotes  │
      │ Applies surgical fix & re-submits    │
      └──────────────────────────────────────┘
```

### 4.1 Why Token Replay Is Banned
In naive agent loops, retrying an implementation passes the entire previous conversational turn history back into the LLM. By turn 4, the input prompt reaches 80,000+ tokens, costing $0.50–$1.50 per attempt and causing the model to get confused by its own past discarded code.

Under Graywolf's protocol:
- Dev-Level-3 on Strike 1 receives **only**:
  1. The original `plan.md`.
  2. The current `candidate.patch`.
  3. The `reviewerNotes` and the exact failed test output slice.
- Working context remains locked at **~12,000–18,000 tokens**, keeping revision costs negligible and focus pin-sharp.

---

## 5. Specialist Personas (Extension Tiers)

Beyond the core triad (Dev-Level-1, Dev-Level-3, Dev-Level-2), the planner can designate specialized personas for high-risk domains:

| Tier | Role | Trigger / Tag | Specialized Capabilities |
| :--- | :--- | :--- | :--- |
| **Dev-Level-4: QA Specialist** | Automated testing scenarios | `qa-intensive` | Adversarial Playwright, accessibility audits, visual regression diffs |
| **Dev-Level-5: Security Auditor** | Security & Secret Scan | `security`, `auth`, `crypto` | AST taint analysis, secret detection, CVE remediation |
| **Dev-Level-6: DB Architect** | Database Migration Specialist | `db-migration`, `schema-change` | Backward compatibility checks, non-blocking DDL indices, rollback script authoring |
| **Dev-Level-7: Performance Engineer** | Profiler & Optimizer | `performance`, `heavy-query` | EXPLAIN ANALYZE interpretation, memory leak profiling, benchmark assertions |

---

## 6. Execution Lifecycle Paths

1. **Standard Feature Path**:
   `Dev-Level-1 (Plan)` $\rightarrow$ `Dev-Level-3 (Implement)` $\rightarrow$ `Dev-Level-2 (Review)` $\rightarrow$ Quality Guards $\rightarrow$ PR Review Gate.
2. **Fast Bugfix Path (`skipPlanning: true`)**:
   Tasks tagged `simplebugs` or `css-fix` bypass Dev-Level-1 entirely. `Dev-Level-3` directly inspects the error trace and generates a fix, verified by `Dev-Level-2`.
3. **Mandatory Human Plan Gate (`requireHumanPlanApproval: true`)**:
   For database schema migrations or core architectural shifts, execution pauses after Dev-Level-1 generates `plan.md`. The plan is presented in the Chat Cockpit for human sign-off before any code is written.

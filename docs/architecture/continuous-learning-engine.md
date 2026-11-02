# Graywolf Squad — Deep-Dive Architecture: Continuous Learning Engine & Memory Scaling

## 1. Executive Summary & Vision

An autonomous engineering platform that resets its knowledge on every task is doomed to repeat the same subtle mistakes, violate team conventions, and require repetitive human corrections. Conversely, an agent system that naively saves every thought into a vector database rapidly suffers from **retrieval poisoning**: noisy, stale, or conflicting memories degrade prompt context and cause hallucinations.

Inspired by the **Hermes Agent** closed-loop learning framework (Nous Research), Graywolf Squad implements an autonomous three-tier learning engine engineered for long-term scalability, self-pruning, and strict provenance tracking.

---

## 2. Three-Tier Learning Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Continuous Learning Engine (Closed-Loop Autonomous Improvement)                        │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 1: Project Memory (PostgreSQL 16 + pgvector)                                │  │
│  │ • Scope: Coding conventions, framework quirks, resolved edge cases, PR feedback  │  │
│  │ • Format: Structured JSONB with vector embeddings (nomic-embed-text / HNSW)     │  │
│  │ • Lifecycle: Automated recency decay, similarity deduplication, confidence decay│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2: Reusable Skill Library (.agents/skills/*.md)                             │  │
│  │ • Scope: Procedural, multi-step workflows (e.g. "Add New Fastify Route")         │  │
│  │ • Format: Markdown with YAML frontmatter conforming to agentskills.io standard    │  │
│  │ • Lifecycle: Auto-generated when task patterns succeed 2+ times; versioned in git│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Tier 3: Anti-Pattern Registry                                                    │  │
│  │ • Scope: Hard negative constraints ("Never import X", "Never use DROP without...")│  │
│  │ • Format: Exact regex matchers + semantic rules injected as negative prompt guards│  │
│  │ • Lifecycle: Extracted from QA guard failures, test regressions, and human PR veto│  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Provenance & Confidence Scoring Model

Not all lessons are created equal. A rule extracted from an explicit human PR rejection is far higher signal than a correlation inferred by an agent.

Every learned lesson carries an explicit provenance record:

```sql
CREATE TABLE project_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
    provenance VARCHAR(32) NOT NULL, 
      -- 'human_correction' | 'qa_guard_failure' | 'auto_inferred' | 'postmortem'
    confidence_score NUMERIC(3, 2) NOT NULL, -- 0.10 to 1.00
    category VARCHAR(32) NOT NULL,          -- 'convention' | 'bugfix' | 'anti_pattern' | 'perf'
    trigger_scope TEXT[] NOT NULL,          -- e.g. ['src/modules/billing/**', '*.ts']
    summary TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    embedding vector(768),                  -- nomic-embed-text embedding
    times_applied INT DEFAULT 0,
    times_rejected INT DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active' | 'quarantined' | 'archived'
    last_applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.1 Provenance Hierarchy

| Provenance Type | Initial Confidence | Promotion / Demotion Rules |
| :--- | :---: | :--- |
| **`human_correction`** | **1.00** | Extracted from the delta between agent patch and merged human PR. Permanent to prevent convention thrashing, but subject to **Periodic Re-Confirmation** (§4.4) to catch mistaken approvals. |
| **`postmortem`** | **0.95** | Injected from production incident or reverted PR. Immediately promotes to Anti-Pattern Registry. |
| **`qa_guard_failure`** | **0.80** | Extracted after Clean-Code or Test Guard rejects a candidate patch. Demoted if subsequent human review overrides the guard. |
| **`auto_inferred`** | **0.50** | Synthesized after 2 successful tasks sharing similar file patterns across **distinct task briefs**. Quarantined until tested on 2 subsequent tasks without failure. |

---

## 4. Vector Scaling, Decay & Pruning Policy

As a project completes hundreds of tasks, `project_lessons` could grow to thousands of records. Without pruning, vector search matches obsolete rules (e.g. instructions for a deprecated ORM), polluting the prompt.

Graywolf enforces a **Four-Part Pruning & Validation Engine**:

### 4.1 Recency-Weighted Scoring (Time-Decay RRF)
When Dev-Level-1 (Planner) retrieves lessons for a new task, candidate lessons are ranked by combining semantic similarity with an exponential half-life decay:

$$Score = Similarity \times e^{-\lambda \Delta t} \times \left(1 + \frac{Applied}{Applied + Rejected + 1}\right)$$

Where $\Delta t$ is days since last successful application, and $\lambda = 0.01$ (90-day half-life). Recent and frequently validated lessons naturally surface above old, unused ones. Note that `human_correction` lessons maintain their high baseline weight to protect established standards from decaying away.

### 4.2 Semantic Deduplication & Consolidation (Nightly & On-Demand)
A background worker runs nightly (and on-demand) clustering lessons with cosine similarity $> 0.88$. It invokes an analytical model to synthesize near-duplicates into a single, unified, high-confidence lesson, archiving redundant records to keep retrieval sharp.

### 4.3 Quarantining on Incident / Rollback with LLM-Assisted Triage
If a merged task is marked as causing a regression or is reverted via a git revert PR:
- The orchestrator traces the `source_task_id`.
- All lessons born from that task are instantly updated to `status = 'quarantined'`.
- Quarantined lessons are blocked from retrieval until reviewed.
- **LLM-Assisted Triage Digest**: Instead of forcing non-expert operators to inspect raw AST diffs, Dev-Level-1 generates a plain-English triage summary for each quarantined lesson:
  > *"Lesson 'Always wrap errors with AppError' was quarantined because PR #42 was reverted due to broken error unwrapping. Recommended action: Archive and delete."*

### 4.4 Periodic Re-Confirmation Protocol (The Fallible Human Safeguard)
Because human operators may occasionally approve sub-optimal patterns under pressure, `human_correction` lessons are not left unchecked forever:
- **Trigger**: When a `human_correction` lesson is applied $\ge 5$ times, or when 30 days elapse.
- **Action**: The lesson appears in the weekly project health digest: *"This human convention has steered 5 tasks. Is this still your intended standard?"*
- Clicking **"Confirm"** resets the counter; clicking **"Revoke"** archives the lesson and purges it from prompt injection.

---

## 5. Autonomous Skill Self-Creation (`agentskills.io`)

When a developer asks Graywolf to perform a complex workflow (e.g., *"Set up a new TypeORM migration and entity for customer invoices"*), Dev-Level-1 follows general reasoning. 

However, once that task pattern succeeds twice:
1. **Distinct-Brief Requirement**: The 2 successes MUST come from **distinct task briefs** across different tasks (not successive retry turns or subtasks within the same brief) to prevent overfitting.
2. **Extraction & Synthesis**: It authors a reusable markdown document in `.agents/skills/<skill-name>/SKILL.md` conforming to the open `agentskills.io` standard.
3. **Operator Sign-Off Gate**: The newly generated skill is held in draft state until the human operator signs off on the plain-language summary in the Cockpit or via PR. Once approved, it is committed to version control.
   ```markdown
   ---
   name: add-typeorm-migration
   description: Standard procedure for creating TypeORM migrations in this repository
   triggers:
     - "**/migrations/**"
     - "src/database/models/**"
   provenance: auto-inferred
   confidence: 0.85
   ---

   # Workflow: TypeORM Migration Procedure
   1. Create entity in `src/database/models/<name>.entity.ts`
   2. Run `npm run typeorm:generate -- -n <MigrationName>`
   3. Verify non-blocking lock clauses for production safety...
   ```
3. **Commit**: The skill is committed to the local project repository under version control, making team knowledge transparent, editable, and shareable across Git remotes.

---

## 6. Organization-Level Memory Tier (Cross-Workspace Intelligence — ADR-051)

When an operator manages multiple repositories (e.g. backend services, frontend portals, background workers) or provisions a second project, requiring the agent squad to re-learn organizational conventions from scratch wastes time and risks re-committing previously solved mistakes.

Graywolf establishes a **Hierarchical Two-Tier Memory Architecture**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ORGANIZATION MEMORY TIER (Scoped to org_id)                            │
│ - Shared organizational conventions, approved library choices,         │
│   and company-wide anti-patterns (e.g., standard error wrapping,        │
│   approved auth patterns, mandatory audit logging).                    │
│ - Curated via explicit operator promotion from project lessons.        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ inherited on bootstrap
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PROJECT MEMORY TIER (Scoped to project_id)                             │
│ - Highly localized module topology, specific database schema quirks,   │
│   and repo-specific test harnesses.                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Promotion & Bootstrapping Mechanics
1. **Explicit Scoping Required for Promotion (Fail-Closed on Empty Scope)**:
   - In the project memory view, high-confidence lessons can be promoted to Organization Scope (`is_org_wide = true`).
   - **Fail-Closed Gate**: Blast radius is fail-closed by philosophy; memory follows the exact same standard. An empty or missing `trigger_scope` (`trigger_scope = []` or `null`) **strictly blocks promotion**.
   - The UI surfaces an interactive prompt: *"Specify target path glob or language pattern before promoting to org scope (e.g. `cmd/**, *.go` or `web/**, *.tsx`). Universal blanket injection is prohibited."*
2. **Precedence on Collision (Project Intent Outranks Org Defaults)**:
   - When an organization-level convention collides with a project-level decision (e.g., an org lesson specifies `chi`, but the project's `.agents/constitution.md` or a local `human_correction` mandates standard library `net/http` mux):
   - **Normative Precedence Rule**: **Project-Level Decision Strictly Wins**. Local human operator intent always outranks organization-level inherited defaults. The orchestrator silences the org lesson and injects only the project-level rule into the agent's context bundle.
3. **Multi-Stack Monorepos (Per-Path Brief Conditioned Matching)**:
   - In polyglot monorepos containing multiple languages and stacks (e.g., Go backend in `cmd/**` + React frontend in `web/**`), org lessons are NOT evaluated at the whole-repo level.
   - Matching is dynamically evaluated **per task brief against the target file paths and recon manifest**:
     - A task brief touching `cmd/api/server.go` receives the Go error-wrapping lesson.
     - A task brief touching `web/src/components/Header.tsx` within the *same workspace* completely excludes the Go lesson from its context bundle.
4. **Cross-Project Skill Library**: High-performing skills can be shared in the organizational skill registry (`.agents/org-skills/`), allowing mature workflows to be invoked across projects with zero duplication.


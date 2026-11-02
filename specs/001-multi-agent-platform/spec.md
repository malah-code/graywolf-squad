# Feature Specification: Autonomous Multi-Agent Software Engineering Platform

**Feature Branch**: `001-multi-agent-platform`

**Created**: 2026-09-09

**Status**: Active Specification (Analysis Phase — No Implementation Yet)

**Last Updated**: 2026-09-10

**Input**: User description: "Autonomous multi-agent software engineering platform operating as an autonomous software house (greenfield mode) and as an embedded external squad on existing team codebases (brownfield mode), with virtual developer tiers, dynamic DAG task orchestration, conversational control plane, and sovereign developer review gates."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Non-Committing Task Delegation & Sandbox Execution (Priority: P1)

As a software engineer, I want to delegate a complex coding task to an autonomous agent executing in an isolated Docker container with a dedicated Git worktree, so that the agent can install dependencies, run test harnesses, and generate code without polluting my working branch or making unapproved Git commits.

**Why this priority**: Foundational safety contract. Without sandbox and Git isolation, autonomous agents risk breaking dependencies, colliding on ports, or making destructive, untracked repository changes.

**Independent Test**: Can be verified by assigning a task to an agent in a sandbox, confirming that the agent executes bash commands, edits files within its worktree, and produces a `changes.patch` and `result.json` conforming to `delegate-relay.result.v1` without creating any git commit on the host repository.

**Acceptance Scenarios**:
1. **Given** a new task defined in `.agents/tasks/TASK-001/brief.md`, **When** the orchestrator triggers execution, **Then** a dedicated Git worktree is provisioned with relative `.git` pointer paths and mounted into an ephemeral Docker container.
2. **Given** an agent running inside the execution container, **When** the agent completes its coding objective, **Then** `relay.mjs` captures touched files, resource metrics, exit code, and emits `result.json` without executing `git commit`.
3. **Given** an agent process encountering an unhandled crash or timeout, **When** the relay exits, **Then** the failure signal, duration, and partial logs are recorded, and the host workspace remains untouched.

---

### User Story 2 - Reactive Quality Assurance Gates & Diff Verification (Priority: P2)

As a developer, I want the platform to automatically evaluate generated code against Clean-Code, Test, and Documentation Guards before alerting me for review, so that hallucinated dependencies, bypassed test assertions, and silent error catches are caught and remediated autonomously.

**Why this priority**: Eliminates synthetic code quality defects (AI code smells) before human review, saving developer attention for high-level design validation.

**Independent Test**: Can be verified by feeding a synthetic diff containing an empty catch block or a mocked domain entity into the pipeline, and asserting that the Guard halts progression and triggers an automated QA Fixer pass.

**Acceptance Scenarios**:
1. **Given** an agent-generated `changes.patch`, **When** the Clean-Code Guard detects empty catch blocks or hallucinated imports, **Then** the task state transitions to `QA_FIXING` with diagnostic logs attached to `verification.md`.
2. **Given** modified test files, **When** the Test Guard evaluates mocking boundaries, **Then** mocks applied to internal domain entities are rejected while external network/database boundaries are approved.
3. **Given** a patch that passes all three guards and runs containerized tests with exit code 0, **When** the verification completes, **Then** the task transitions to `HUMAN_REVIEW_GATE` with a unified diff presented in the UI.

---

### User Story 3 - Filesystem-Centric State Sync & Dual Interface (Priority: P3)

As a lead engineer, I want task states, execution logs, and architecture plans persisted as structured Markdown files on disk and synced in real-time to a visual Kanban UI, so that I can switch between visual workflow tracking and manual file editing transparently.

**Why this priority**: Prevents vendor lock-in to opaque agent databases and empowers developers to inspect, audit, or tweak agent prompts directly via standard text editors.

**Independent Test**: Can be verified by editing a task's frontmatter in `.agents/tasks/TASK-001/brief.md` via text editor, and confirming that the UI Kanban board updates immediately via WebSocket without server restart.

**Acceptance Scenarios**:
1. **Given** the visual Kanban dashboard, **When** an agent updates its execution status or emits logs, **Then** the UI reflects card movements and terminal feeds in real time via WebSockets.
2. **Given** a developer making direct modifications to a task markdown brief on disk, **When** the file is saved, **Then** the filesystem watcher detects the change, acquires atomic directory lock (`proper-lockfile`), validates frontmatter schema, and propagates updates to the active agent session.

---

### User Story 4 - LiteLLM Gateway & Budget Circuit Breaking (Priority: P4)

As an engineering manager, I want to route agent tasks through a centralized model gateway with virtual roles, rate limits, and spend caps, so that no rogue execution loop can exhaust monthly API budgets.

**Why this priority**: Protects team infrastructure costs and handles multi-provider API failovers seamlessly.

**Independent Test**: Can be verified by configuring a $2.00 USD task spend cap, simulating repeated agent reasoning loops, and verifying that the circuit breaker trips, halting agent execution with a notification.

**Acceptance Scenarios**:
1. **Given** an Architect agent requesting high-level planning, **When** making LLM calls, **Then** LiteLLM routes requests to high-reasoning models (Claude 3.5 Sonnet / Gemini 1.5 Pro) under the `agent-architect` virtual alias.
2. **Given** a Coder agent generating bulk implementations, **When** making LLM calls, **Then** LiteLLM routes requests to high-throughput models (DeepSeek-V3 / Haiku).
3. **Given** an upstream provider returning consecutive HTTP 429 rate-limit errors, **When** the threshold of 3 errors is reached, **Then** the proxy circuit breaker automatically routes requests to designated fallback models.
4. **Given** a task exceeding the configured spend limit, **When** the threshold is crossed, **Then** the orchestrator trips the stuck-detector heuristic and halts the container.

---

### User Story 5 - Brownfield Embedded Squad: Repo Ingestion & Boundary Enforcement (Priority: P2)

As an engineering lead at an IT company building an accounting app (hosted on GitLab), I want to onboard Graywolf as an external squad responsible for one major feature (e.g. tax reporting module), so that Graywolf can plan, implement, and test that feature without touching the rest of the codebase that my team owns.

**Why this priority**: Enterprise brownfield adoption requires strict blast-radius control — a rogue agent modifying authentication, payment flows, or CI/CD pipelines in a live project would be catastrophic.

**Independent Test**: Connect Graywolf to a sample GitLab repo, define writable and forbidden scopes, trigger an agent that encounters a boundary violation, and verify it emits an Escalation Request instead of modifying the forbidden file.

**Acceptance Scenarios**:
1. **Given** an existing GitLab/GitHub repository URL and credentials, **When** a new Graywolf project is created in brownfield mode, **Then** the system runs a Reconnaissance Pass that maps directory structure, dependency manifests, coding conventions, and architectural layers into a `recon-report.md`.
2. **Given** a defined Writable Scope (`src/modules/tax/**`) and Forbidden Scope (`src/core/auth/**`, `.gitlab-ci.yml`), **When** an agent determines it must modify a file outside its Writable Scope, **Then** the system MUST halt agent execution and emit an `escalation-request.md` to the human review queue instead of proceeding.
3. **Given** a Read-Only Scope (`src/database/models/**`), **When** an agent needs to understand an existing schema, **Then** the agent can read the file but the relay contract blocks any write operation to that path.
4. **Given** the reconnaissance is complete, **When** the Lead Architect agent plans the feature, **Then** it generates an implementation plan respecting the declared blast-radius boundaries.

---

### User Story 6 - Virtual Developer Tier Handoff Inside the Task Container (Priority: P1)

As a platform operator, I want each task container to run a structured multi-tier virtual developer handoff (Planner → Implementer → In-Container Reviewer) using different model tiers, so that expensive frontier reasoning is only consumed for planning and sign-off, while bulk code synthesis uses fast, cost-efficient models.

**Why this priority**: This directly controls cost, code quality, and iteration speed — it is the core cognitive architecture of the squad.

**Independent Test**: Trigger a task, verify that `plan.md` is authored by Dev-Level-1 (frontier model), `implementation-summary.md` is authored by Dev-Level-3 (fast model), and `review-signoff.md` is authored by Dev-Level-2 (reasoning model), all before `result.json` is emitted.

**Acceptance Scenarios**:
1. **Given** a task brief assigned to a container, **When** execution begins, **Then** Dev-Level-1 (configurable frontier model) reads the brief and codebase context, and writes `plan.md` that designates which implementer tier and reviewer tier to use.
2. **Given** `plan.md` is written and designates Dev-Level-3 as implementer, **When** the implementer agent runs, **Then** it writes code changes to the workspace and produces `implementation-summary.md` listing touched files and rationale.
3. **Given** `implementation-summary.md` is complete, **When** Dev-Level-2 (reasoning/review model) runs, **Then** it diffs the changes against `plan.md`, runs the test suite inside the container, and either signs off in `review-signoff.md` or sends specific revision requests back to the implementer.
4. **Given** the human operator has configured `"simplebugs.skipPlanning": true`, **When** a task is tagged as a simple bugfix, **Then** Dev-Level-1 planning is skipped and execution goes directly to Dev-Level-3.
5. **Given** a task tagged as a database schema change, **When** Dev-Level-1 writes `plan.md`, **Then** the system emits a mandatory human gate requesting plan approval before any implementer runs.

---

### User Story 7 - Conversational Control Plane (Chat as Active Cockpit) (Priority: P2)

As a developer testing the app and noticing a bug, I want to describe it in natural language to the platform's chat interface, so that the platform creates the bug ticket, assigns proper priority, establishes task dependencies (blocking other tasks if needed), and queues it for agent execution — without me touching the Kanban board manually.

**Why this priority**: Chat is the highest-leverage human interface — it dramatically reduces friction for creating, reprioritizing, and cancelling work while the developer stays in their testing flow.

**Independent Test**: Via chat, type: "I found a CSV encoding bug with Arabic characters. Create a bug ticket, block the tax calculation task on it, and start it now." Verify the system creates the ticket, sets `tax_calc.blockedBy = [csv_bug]`, reorders the queue, and begins agent execution.

**Acceptance Scenarios**:
1. **Given** a developer types a natural language description in chat, **When** the Chat Agent processes it, **Then** it creates a structured task ticket with inferred priority, scope, and blockers.
2. **Given** a chat command like "pause the authentication task and re-queue it for tomorrow", **When** processed, **Then** the orchestrator pauses the active container and updates the task's scheduled start time.
3. **Given** a chat command like "what is the current status of the billing feature?", **When** processed, **Then** the Chat Agent queries live task state and returns a human-readable summary with links to logs and diffs.
4. **Given** a chat command that requests an action beyond the current user's permission level (e.g. a read-only user requesting `cancel_all_tasks`), **When** processed, **Then** the system MUST reject the action with an explanation and not execute it.
5. **Given** a brainstorming conversation with the Chat Agent about a new feature, **When** the developer confirms intent, **Then** the agent synthesizes the conversation into a task brief and requests final confirmation before queuing.

---

### User Story 8 - Dynamic DAG Dependency Sorting & Mid-Flight Task Changes (Priority: P2)

As a project manager, I want the platform to automatically resolve task dependencies, sort the execution queue topologically, and respond correctly when I modify a task while an agent is already working on it.

**Why this priority**: Real projects have complex interdependencies. A static queue without dependency tracking causes integration failures and ordering bugs.

**Independent Test**: Create tasks A → B → C where B depends on A and C depends on B. Verify the orchestrator executes A first, starts B only after A merges, and C only after B. Then while B is running, edit its requirements — verify the orchestrator detects the change and handles it appropriately.

**Acceptance Scenarios**:
1. **Given** tasks with `blockedBy` declarations, **When** the orchestrator evaluates the queue, **Then** it performs topological sorting and only promotes tasks with zero unresolved blockers to `QUEUED / READY`.
2. **Given** non-overlapping unblocked tasks (different file scopes), **When** sandbox capacity allows, **Then** the orchestrator executes them in parallel across separate ephemeral containers.
3. **Given** a developer modifies the requirements of a task that is `QUEUED` but not yet started, **When** the change is saved, **Then** the system marks it as `UPDATED`, re-validates its dependency graph, and adjusts its priority if needed.
4. **Given** a developer modifies the requirements of a task that is `IN_PROGRESS` inside a container, **When** the change is a minor clarification, **Then** the orchestrator injects the update into the active agent's turn buffer.
5. **Given** a developer makes a major requirement pivot to an `IN_PROGRESS` task, **When** the change is saved, **Then** the orchestrator triggers a container restart, reverting to a clean worktree snapshot and re-running the full planning tier.

---

### User Story 9 - New Project Onboarding & Configuration Session (Priority: P2)

As a developer starting a brand-new application with a requirements document, I want to go through a structured onboarding session in Graywolf that configures the project's identity, source control connection, AI constitution, model routing, agent skill imports, work granularity, and human gate policy — before any agent starts working.

**Why this priority**: A misconfigured constitution or wrong model routing affects every single task the squad runs. Getting it right up-front prevents cascading failures.

**Independent Test**: Complete the full onboarding flow with a requirements document, verify that the platform produces a `project.config.json`, a validated `constitution.md`, a model routing table, and a skill import manifest before emitting the first task to the queue.

**Acceptance Scenarios**:
1. **Given** a developer uploads a requirements document (Markdown or PDF), **When** the onboarding session begins, **Then** the platform analyzes the document and asks targeted clarification questions it cannot infer automatically (max 5 questions).
2. **Given** the platform has received a source control URL (GitLab/GitHub), **When** credentials are verified, **Then** the platform clones or connects to the repo and confirms read/write access.
3. **Given** configuration inputs for model routing, **When** saved, **Then** the platform stores a `project.config.json` declaring: `plannerModel`, `coderModel`, `reviewerModel`, per-tier fallbacks, daily spend caps, and max concurrent containers.
4. **Given** a configured project, **When** the developer selects skill imports (e.g. BMAD personas, security audit skills), **Then** the platform installs them and references them in the agent context loaders.
5. **Given** a fully configured project, **When** the first work session begins, **Then** the platform sends clarification questions for any remaining ambiguities in the requirements document before queuing any execution tasks.

---

### User Story 10 - Bug Ticket Workflow (Priority: P3)

As a developer, I want to file a bug ticket with reproduction steps and optionally a screenshot or log snippet, so that Graywolf's squad can autonomously investigate, root-cause, fix, and verify the bug before presenting the fix for my review.

**Why this priority**: Bug fixing is the most frequent daily workflow and the highest-ROI use case for rapid autonomous action.

**Independent Test**: File a bug ticket with a failing test case reference, verify the agent reproduces it inside the container, authors a fix, runs the test suite to confirm green, and delivers the diff with a root-cause explanation to the review gate.

**Acceptance Scenarios**:
1. **Given** a bug ticket with a description and reproduction steps, **When** accepted by the orchestrator, **Then** the Dev-Level-1 agent classifies the bug severity, identifies candidate files, and writes a `bug-investigation.md` before the implementer acts.
2. **Given** the bug has a failing test case provided, **When** the implementer runs inside the sandbox, **Then** it must first verify the test fails before the fix, implement the fix, and verify the test passes after.
3. **Given** a bug fix is complete and tests pass, **When** the review gate is presented, **Then** the human sees the root-cause analysis, the diff, and the before/after test results in a single view.

---

### Edge Cases

- **Git Worktree Path Paradox**: When mounting a linked Git worktree into a Docker container, the `.git` pointer file references host paths that fail inside container namespaces. Must use relative pointer paths (`--relative-paths` or rewritten `gitdir: ../../`) and mount the parent `.git` directory read-only.
- **Concurrent File Collision**: Multiple agents operating simultaneously on disk risk partial writes or corrupted state. Must use atomic `mkdir` locking with stale-lock timeouts (30-second heartbeats).
- **Stuck-in-a-Loop Heuristics**: An agent repeatedly running the same failing command or generating zero-byte diffs must be detected (4 identical action-observation pairs or 3 identical diffs) and halted.
- **Host Resource Starvation**: Sandbox containers must enforce hard memory limits (e.g. 4GB) and CPU quotas to prevent runaway sub-processes from freezing the host machine.
- **Boundary Escape Attempt**: An agent that determines it cannot complete a task within its declared blast-radius MUST emit an escalation request, not silently fail or attempt workarounds outside scope.
- **Mid-Flight Major Pivot**: A task undergoing a major requirement change mid-execution must preserve the original worktree state as a snapshot before restarting, allowing rollback if the pivot was in error.
- **QA Remediation Loop**: If a QA Fixer agent fails to resolve guard violations within a configurable maximum retry count (default: 3), the task must escalate to human review with `VERIFICATION_FAILED` status rather than looping indefinitely.
- **Dev-Tier Disagreement**: If Dev-Level-2 (in-container reviewer) rejects the implementer's code twice in a row, the task escalates to human review rather than consuming more tokens on a third attempt.
- **Chat Permission Boundary**: The Chat Agent must validate every tool call against the authenticated user's permission level before executing any state-modifying action.
- **Orphan Container Cleanup**: On orchestrator restart, all dangling containers, worktrees, and stale lock files older than 60 seconds must be pruned automatically.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Core Sandbox & Safety (from US1)
- **FR-001**: System MUST provision an isolated Git worktree for every coding task, linked to the repository history without modifying the main branch.
- **FR-002**: System MUST run agent code synthesis and test runners inside ephemeral Docker containers with scoped bind mounts (`/workspace` read-write, `.agents/` read-only).
- **FR-003**: System MUST execute agents through a non-committing relay script (`relay.mjs`) that traps OS signals, tracks memory/duration metrics, and emits structured `delegate-relay.result.v1` JSON.
- **FR-004**: Agents MUST be structurally prohibited from executing `git commit`, `git push`, or modifying branch heads directly.

#### Quality Gates (from US2)
- **FR-005**: System MUST execute a 3-tier reactive quality gate (Clean-Code Guard, Test Guard, Documentation Guard) on generated patches before advancing to human review.
- **FR-016**: If a QA Fixer agent fails to resolve guard violations within a configurable retry limit (default: 3 attempts), the task MUST automatically escalate to `HUMAN_REVIEW_GATE` with status `VERIFICATION_FAILED`.

#### State Persistence & Sync (from US3)
- **FR-006**: System MUST persist all task states, briefs, execution logs, and patch diffs as human-readable Markdown and JSON files in `.agents/tasks/<TASK_ID>/`.
- **FR-007**: System MUST implement atomic filesystem directory locks (`mkdir` protocol via `proper-lockfile`) with automatic recovery for stale locks older than 30 seconds.
- **FR-012**: System MUST support bidirectional synchronization: edits made to markdown task files in local editors must be detected and reflected in the UI within 500ms.

#### LLM Gateway & Cost Control (from US4)
- **FR-008**: System MUST route all LLM requests through a LiteLLM Proxy reverse gateway with virtual model aliases (`agent-architect`, `agent-coder`, `agent-qa`, `agent-reviewer`).
- **FR-009**: System MUST enforce token spend limits and circuit-breaking failover across LLM providers on consecutive HTTP 429/500 responses.
- **FR-010**: System MUST detect stuck execution loops (4 consecutive identical action-observations or 3 identical diffs) and pause the container for developer intervention.

#### Brownfield Reconnaissance & Boundary Enforcement (from US5)
- **FR-017**: System MUST support a Brownfield Embedded Mode where it connects to an existing GitLab/GitHub repository and operates as an external squad restricted to a declared blast-radius scope.
- **FR-018**: Before any agent writes code in brownfield mode, the system MUST execute a Reconnaissance Pass that scans the directory tree, dependency manifests, coding conventions, and architectural layers, producing a `recon-report.md`.
- **FR-019**: System MUST enforce three scope tiers per project: **Writable** (agent can create/modify), **Read-Only** (agent can read but not write), and **Forbidden** (agent cannot access). Scope is declared in `project.config.json`.
- **FR-020**: If an agent determines it needs to modify a file outside its Writable Scope, it MUST halt execution and emit an `escalation-request.md` to the human review queue. The system MUST NOT allow the agent to proceed, workaround, or modify the forbidden file.

#### Virtual Developer Tier Handoff (from US6)
- **FR-021**: Each task container MUST execute a structured virtual developer handoff: Dev-Level-1 (Planner) → Dev-Level-N (Implementer) → Dev-Level-M (In-Container Reviewer), where N and M are designated by the planner's `plan.md`.
- **FR-022**: Dev-Level-1 (Planner) MUST write a `plan.md` inside the container before the Implementer writes any code. The plan MUST declare which implementer tier and reviewer tier to activate.
- **FR-023**: The In-Container Reviewer (Dev-Level-2 or equivalent) MUST run the test suite inside the container and either sign off via `review-signoff.md` or return specific revision requests to the Implementer.
- **FR-024**: If the In-Container Reviewer rejects the implementation twice consecutively, the task MUST escalate to the human review queue with status `INTERNAL_REVIEW_FAILED`.
- **FR-025**: Model tier assignments (Dev-Level-1, Dev-Level-2, Dev-Level-3, etc.) MUST be configurable per project and per task tag (e.g. `simplebugs.skipPlanning: true`, `schema-changes.requireHumanPlanApproval: true`).

#### Chat as Active Control Plane (from US7)
- **FR-026**: System MUST expose a conversational Chat Agent that has tool-calling authority over platform state: creating tasks, modifying tasks, cancelling tasks, querying codebase, and reordering the backlog.
- **FR-027**: The Chat Agent MUST validate every state-modifying tool call against the authenticated user's permission level before execution. Unauthorized requests MUST be rejected with an explanation.
- **FR-028**: The Chat Agent MUST be able to initiate a brainstorming session about a new feature and, upon developer confirmation, synthesize the conversation into a formal task brief.

#### Dynamic DAG & Task Dependencies (from US8)
- **FR-029**: Tasks MUST support a `blockedBy: [TASK_ID, ...]` dependency declaration in their frontmatter schema.
- **FR-030**: The orchestrator MUST perform topological sorting on the task queue and only promote tasks with zero unresolved blockers to `QUEUED / READY` status.
- **FR-031**: Non-overlapping unblocked tasks with no shared writable file scope MUST be eligible for parallel execution across separate containers.
- **FR-032**: When a `QUEUED` (not yet started) task's requirements are edited by a human, the system MUST mark it `UPDATED`, re-validate its dependency graph, and adjust priority.
- **FR-033**: When an `IN_PROGRESS` task's requirements receive a minor clarification, the system MUST inject the update into the active agent's turn buffer without restarting the container.
- **FR-034**: When an `IN_PROGRESS` task receives a major requirement pivot, the system MUST restart the container, preserve the original worktree state as a recoverable snapshot, and restart execution from the planning tier.

#### Project Onboarding & Configuration (from US9)
- **FR-035**: System MUST provide a guided onboarding session for new projects covering: source control connection, AI constitution, model routing table, dev tier assignments, skill imports, task granularity, human gate policy, and spend limits.
- **FR-036**: System MUST produce a validated `project.config.json` at the end of onboarding declaring all model routing, fallbacks, spend caps, concurrent container limits, and blast-radius scope.
- **FR-037**: If a requirements document is provided at onboarding, the system MUST analyze it and ask at most 5 targeted clarification questions for anything it cannot confidently infer.

#### Bug Ticket Workflow (from US10)
- **FR-038**: System MUST support a Bug Ticket entry type where the Dev-Level-1 agent first authors a `bug-investigation.md` (severity classification, candidate files, root cause hypothesis) before the Implementer acts.
- **FR-039**: For bugs with provided failing test cases, the Implementer MUST verify the test fails before applying any fix, and confirm it passes after the fix before emitting `result.json`.

#### Platform Infrastructure
- **FR-011**: System MUST provide a real-time UI dashboard with Kanban workflow lanes, DAG dependency viewer (React Flow), and live streaming terminal feeds over WebSockets.
- **FR-013**: System MUST use standard Docker Engine daemon via `/var/run/docker.sock` for container sandboxing, process isolation, and Git worktree bind mounts.
- **FR-014**: System MUST implement orchestrator backend using TypeScript / Node.js (v20+) with Fastify, `chokidar` for filesystem event monitoring, and `proper-lockfile` for atomic directory-level locking.
- **FR-015**: System MUST deliver the developer interface as a bespoke lightweight SPA built with React, Vite, Tailwind CSS, Shadcn UI, React Flow (DAG viewer), and Xterm.js for streaming terminal logs.
- **FR-040**: On orchestrator startup, the system MUST run an automatic garbage collection pass that prunes dangling Docker containers, untracked Git worktree directories, stale lock files older than 60 seconds, and orphaned named volumes.

---

### Key Entities

- **Task Specification (`brief.md`)**: Defines the scope, constraints, target files, acceptance criteria, `blockedBy` dependencies, and frontmatter metadata (`taskId`, `status`, `type` [feature/bug/refactor], `assignedTier`, `spendLimitUSD`, `writableScope`).
- **Project Configuration (`project.config.json`)**: Per-project settings declaring operational mode (greenfield/brownfield), blast-radius scope tiers, model routing table, dev tier assignments, human gate policies, skill imports, and concurrent container limits.
- **Reconnaissance Report (`recon-report.md`)**: Brownfield-mode artifact mapping the target repository's architecture, conventions, dependency tree, and suggested blast-radius boundaries.
- **Execution Relay Result (`result.json`)**: Conforms to `delegate-relay.result.v1`; records `exitCode`, `durationMs`, `peakMemoryBytes`, `touchedFiles`, `agentReport`, and `sessionRef`.
- **In-Container Plan (`plan.md`)**: Written by Dev-Level-1 Planner inside the task container; declares implementation approach, file scope, designated implementer tier, and designated reviewer tier.
- **Implementation Summary (`implementation-summary.md`)**: Written by the Implementer agent listing touched files, rationale, and any divergence notes.
- **Review Sign-Off (`review-signoff.md`)**: Written by the In-Container Reviewer confirming test passage and code quality, or listing specific revision requests.
- **Escalation Request (`escalation-request.md`)**: Emitted when an agent encounters a boundary violation or an irresolvable blocker requiring human decision.
- **Quality Guard Report (`verification.md`)**: Contains sequential outputs of Clean-Code Guard, Test Guard, and Documentation Guard, including pass/fail status and remediation recommendations.
- **Unified Patch (`changes.patch`)**: Standard Git diff representing all workspace mutations produced by an agent pass.
- **Virtual Model Routing Table (`project.config.json` → `modelRouting`)**: Configuration declaring dev tier to model alias routes, fallbacks, RPM limits, and daily token budgets.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of autonomous agent runs complete without creating unverified Git commits on the host repository.
- **SC-002**: Automated quality guards successfully intercept and reject 95%+ of synthetic AI defect patterns (empty catches, mocked internal domain objects, hallucinated packages) before human review.
- **SC-003**: Worktree and Docker sandbox provisioning completes in under 3.5 seconds per task.
- **SC-004**: Filesystem state synchronization across disk, orchestrator, and UI WebSocket displays changes in under 500 milliseconds.
- **SC-005**: LiteLLM proxy circuit breaker automatically reroutes failed upstream LLM queries to fallback providers within 2 seconds without terminating active agent sessions.
- **SC-006**: 0% file corruption or partial-read errors during concurrent multi-agent executions through atomic directory locking.
- **SC-007**: 100% of agent attempts to write outside declared blast-radius scope in brownfield mode are intercepted and result in an escalation request, never in a silent file write.
- **SC-008**: In-container virtual dev tier handoff (Plan → Implement → Review) completes without human intervention for tasks that pass all internal quality gates.
- **SC-009**: Chat Agent correctly handles natural-language task creation, dependency linking, and queue reordering within 3 LLM turns for 90%+ of common requests.
- **SC-010**: Project onboarding session (from requirements document to first queued task) completes in under 10 minutes for a well-documented input.

---

## Assumptions

- Developers have Docker or a compatible OCI container daemon running on their local Linux/WSL host.
- Git version 2.40+ is installed on the host to support worktree management and directory trust configurations (`safe.directory`).
- Node.js (v20+) or Python (3.11+) runtime is available on the host for executing the orchestrator daemon and filesystem watcher.
- LLM API keys (Anthropic, OpenAI, DeepSeek, Google) are managed as environment variables and passed securely to the LiteLLM proxy.
- Network access within execution sandbox containers can be restricted or monitored to prevent data exfiltration.
- In brownfield mode, the external repository (GitLab/GitHub) is accessible via credentials (SSH key or personal access token) stored in the orchestrator's secret store, not inside the container.
- Dev tier model assignments are user-configurable per project and optionally per task tag; the system ships with sensible defaults (Dev-Level-1 = best available frontier model, Dev-Level-3 = fastest high-throughput model).
- The Chat Agent has a stable authenticated session and does not share conversation context across different users' sessions.
- The maximum number of simultaneously running task containers defaults to 3 and is configurable in `project.config.json`.

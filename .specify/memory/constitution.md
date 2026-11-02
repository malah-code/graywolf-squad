# Graywolf Squad Constitution: Core Principles & Architectural Standards

## 1. Core Principles (Non-Negotiable)

1. **Human Sovereignty & Non-Committing Relay Contract**
   - Autonomous agents and AI assistants operate strictly within sandboxed runtimes or working trees.
   - Agents are structurally prohibited from issuing Git commits, force-pushing, or directly altering upstream branches without explicit verification and gate approval.
   - All agent code generation must conclude with a verifiable diff and diagnostic test report. Repository mutations remain sovereign to the developer.

2. **Zero Runtime Lock-In & Permissive / Source-Available Licensing First**
   - Core repository is licensed under **Elastic License 2.0 (ELv2)** (100% free for personal and internal commercial use; prohibits third-party managed SaaS hosting).
   - Dependencies strictly prefer MIT, Apache-2.0, BSD-3-Clause, or PostgreSQL-licensed components across all tiers.
   - Reject tools with aggressive copyleft (e.g. AGPLv3) or uncertain dual-licensing in core services that compromise commercial distribution.
   - Valkey (BSD-3-Clause) replaces Redis; SeaweedFS/Ceph replaces MinIO; Casbin/Ory Keto handles authorization.

3. **Single ACID Relational & Vector Baseline**
   - PostgreSQL + `pgvector` serves as the unified database engine for relational schemas, tenant isolation, and vector embeddings.
   - Avoid standalone vector databases (Pinecone, Milvus) unless single-table embeddings exceed 100M+ high-dimension vectors with distributed query requirements.

4. **Headless Execution & Observability**
   - Engineering tasks are decoupled into typed Actions and Observations backed by an append-only event stream.
   - Comprehensive telemetry via OpenTelemetry standard protocols (OTLP) with SigNoz/Grafana integration.

5. **Dual Operational Mode: Greenfield & Brownfield**
   - Graywolf operates in two modes: **Greenfield** (autonomous software house starting from scratch) and **Brownfield** (embedded external squad contributing to an existing team's codebase).
   - In Brownfield mode, every project declares three immutable scope tiers: **Writable** (agent may create/modify), **Read-Only** (agent may read, never write), and **Forbidden** (agent is structurally blocked from access).
   - Agents that encounter a boundary violation MUST halt and emit an `escalation-request.md`. There is NO exception, workaround, or override path at the agent level.

6. **Virtual Developer Tier Handoff Protocol**
   - Every task container runs a mandatory cognitive handoff pipeline: **Dev-Level-1 (Planner)** writes `plan.md` → **Dev-Level-N (Implementer)** writes code → **Dev-Level-M (In-Container Reviewer)** signs off or requests revision.
   - Model tier assignments (Dev-Level-1 = frontier reasoning, Dev-Level-3 = fast code synthesis) are configurable per project and per task tag. They map to LiteLLM virtual aliases, NOT to specific model providers.
   - If the In-Container Reviewer rejects implementation twice consecutively, the task automatically escalates to human review. The squad never spends tokens on a third auto-retry.
   - **No code reaches the external QA guards until the in-container reviewer has signed off** (`review-signoff.md` exists).

7. **Chat as Active Control Plane (Cockpit Rule)**
   - The conversational Chat Agent is a first-class orchestrator interface, not a wrapper around search. It has tool-calling authority to: create tasks, modify in-progress tasks, cancel containers, query codebase state, reorder backlogs, and initiate brainstorming sessions.
   - Every state-modifying tool call MUST be validated against the authenticated user's permission level BEFORE execution. Unauthorized requests are rejected with a human-readable explanation; they are never silently dropped or partially applied.
   - The Chat Agent may initiate brainstorming conversations and synthesize them into formal task briefs, but MUST obtain explicit developer confirmation before queuing any execution.

8. **Blast-Radius and Dependency Integrity**
   - All tasks declare a `blockedBy` dependency array. The orchestrator enforces topological sort; no task advances to `QUEUED / READY` with unresolved blockers.
   - Mid-flight minor changes (clarifications) are injected into the active agent turn buffer. Mid-flight major pivots trigger a container restart with a preserved worktree snapshot.
   - The platform ships a startup garbage-collection pass that prunes dangling containers, orphan worktrees, and stale locks (>60 seconds) on every orchestrator boot.

9. **Zero-Cost Open Source Foundation ($0 Platform License)**
   - All internal infrastructure, libraries, UI components, sandboxing tools, database engines, and orchestrator code inside Graywolf Squad MUST be 100% free and permissively open-source (MIT, Apache 2.0, BSD-3-Clause, PostgreSQL License).
   - Zero proprietary software licenses, subscriptions, or hidden platform fees are imposed on the user or installer.
   - The platform MUST be capable of running 100% offline and cost-free when connected to local open-source LLM runtimes (e.g. Ollama, vLLM, llama.cpp).
   - The only external monetary costs incurred in Graywolf are the direct token usage bills paid by the user to external commercial LLM providers (e.g. OpenAI, Anthropic, Gemini) if and when they choose to use them.

---

## 2. Standard Technology Stack Matrix

| Tier | Standard Selection | Governance & License |
| :--- | :--- | :--- |
| **Frontend Foundation** | React on Vite (Internal/SPA) or Next.js (Public/SSR) | MIT |
| **UI Components** | Tailwind CSS + Shadcn UI (Radix UI headless) | MIT (Source-copied, zero runtime lock-in) |
| **Backend API** | Fastify (TypeScript) or NestJS with tRPC / OpenAPI | MIT / Apache-2.0 |
| **Authentication** | Better-Auth (TS) or Supabase GoTrue | MIT / Apache-2.0 |
| **Authorization** | Casbin (In-memory ABAC/RBAC) or Ory Keto (Zanzibar) | Apache-2.0 |
| **Primary DB & Vector** | PostgreSQL 16+ with `pgvector` | PostgreSQL License |
| **Cache & In-Memory** | Valkey (BSD-3-Clause) | BSD-3-Clause (Linux Foundation) |
| **Queues & Workflows** | BullMQ (Valkey backend) / Temporal (Durable workflows) | MIT / Apache-2.0 |
| **Object Storage** | SeaweedFS / Ceph (S3-compatible API) | Apache-2.0 / LGPL-2.1 |
| **Search Engine** | Meilisearch or Typesense | MIT / Isolated network daemon |
| **Model Gateway** | LiteLLM Proxy + OpenRouter | MIT / Dynamic routing & cost controls |
| **Local Vector Embeddings** | `nomic-embed-text` (via Ollama) / ONNX | Apache-2.0 / $0 offline embeddings |
| **AST Linter & Static Guard** | `ast-grep` + `tree-sitter` | MIT / Millisecond deterministic checks |
| **Secret Scanning** | `gitleaks` | MIT / Pre-compiled runner binary |
| **Vulnerability & License Audit** | `osv-scanner` | Apache-2.0 / Google OSV database |
| **DAG / Graph UI** | React Flow | MIT |
| **Chat Cockpit UI** | `assistant-ui` + Vercel AI SDK (`ai`) | MIT / Apache-2.0 |
| **Terminal Streams** | Xterm.js | MIT |
| **E2E & UI Testing** | Playwright (`@playwright/test`) + tester.army/e2e pattern | Apache-2.0 (Local-only, zero SaaS lock-in) |
| **System-One Decision Layer** | `DecisionGate` (Fastify) + local OpenJev/SemIf/Laya (Ollama) / Jev | Apache-2.0 / Permissive open-weight local |

---

## 3. Spec-Driven Development (SDD) Lifecycle

Every feature or architectural module developed under Graywolf Squad must progress through the following phase gates:

1. **Constitution Alignment**: Check proposals against licensing, security, and stack rules.
2. **Specification (`spec.md`)**: Define user stories, functional boundaries, interfaces, and acceptance criteria.
3. **Clarification**: Expose missing edge cases, security assumptions, and concurrency bottlenecks.
4. **Technical Plan (`plan.md`)**: Concrete data models, API endpoints, schema migrations, and sequence diagrams.
5. **Task Decomposition (`tasks.md`)**: Micro-tasks ordered by dependency with measurable definition-of-done.
6. **Isolated Sandbox Execution**: Code generation in isolated worktrees / Docker containers.
7. **Quality Assurance & Convergence**: Automated test verification, lint checks, and human verification before merge.

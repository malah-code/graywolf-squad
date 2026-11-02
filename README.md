<p align="center">
  <img src="https://raw.githubusercontent.com/malah-code/graywolf-squad/main/docs/assets/graywolf-banner.png" alt="Graywolf Squad Banner" width="100%" onerror="this.style.display='none'"/>
</p>

<h1 align="center">🐺 Graywolf Squad</h1>

<p align="center">
  <strong>The Sovereign Multi-Tier AI Software Engineering Platform</strong><br>
  <em>Turn PRDs into verified code with tiered autonomous virtual developers, ephemeral sandbox isolation, and an active conversational cockpit.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Elastic--2.0-blue.svg?style=flat-square" alt="License: ELv2"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20+-68a063.svg?style=flat-square&logo=node.js" alt="Node.js 20+"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.8-3178c6.svg?style=flat-square&logo=typescript" alt="TypeScript 5.8"></a>
  <a href="https://fastify.dev"><img src="https://img.shields.io/badge/Fastify-5.x-000000.svg?style=flat-square&logo=fastify" alt="Fastify"></a>
  <a href="https://vitest.dev"><img src="https://img.shields.io/badge/Tests-516%20Passing-brightgreen.svg?style=flat-square&logo=vitest" alt="Tests"></a>
  <a href="https://docker.com"><img src="https://img.shields.io/badge/Docker-Multi--Arch-2496ed.svg?style=flat-square&logo=docker" alt="Docker"></a>
</p>

---

## ⚡ What is Graywolf Squad?

Most AI coding tools are **passive autocomplete widgets** or **unconstrained bash bots** that hallucinate, break your existing architecture, or corrupt your Git history. 

**Graywolf Squad is different.** It is an **autonomous software engineering platform** designed to act either as a full **Greenfield Software House** or as an **Embedded Brownfield Engineering Squad** that lives inside your enterprise codebase without blowing it up.

### Why Developers Love Graywolf:
- 🛡️ **Zero Git Commits from Agents**: Agents operate via isolated ephemeral sandboxes and a non-committing relay contract. All work terminates in a clean unified patch (`changes.patch`) and verified test report.
- 🎯 **Three-Tier Developer Hierarchy**: Stop burning expensive reasoning models on typo fixes. Graywolf uses **Planner (Dev-Level-1)** $\rightarrow$ **Implementer (Dev-Level-3)** $\rightarrow$ **Adversarial Reviewer (Dev-Level-2)** with a strict 2-strike escalation rule.
- 💬 **Chat as an Active Cockpit**: Natural language control plane with real tool-calling power over task dependencies (`blockedBy`), live spend caps, container lifecycles, and a one-click **Panic Button**.
- 🔒 **Blast-Radius Containment**: Algorithmic separation of code into **Writable**, **Read-Only**, and **Forbidden** scopes. Core auth and CI/CD pipelines are structurally untouchable.
- 🧪 **Deterministic + Intent Playwright QA**: Visual Review Packets, semantic locators, zero-token cache replay, and parallel bug-bash sprints.
- 🧠 **Continuous Learning & Trajectory Harvesting**: Offline System-One SLM evaluation and Hermes-style SFT dataset extraction (`OpenAI` / `ShareGPT` JSONL) with multi-layer privacy redaction.

---

## 🐺 The Cognitive Engine: Virtual Developer Tiers

Rather than running multiple heavy containers communicating over external networks, each task sandbox executes a disciplined, cost-optimized cognitive relay inside an isolated environment:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Task Container (Isolated Docker Sandbox & Ephemeral Postgres Clone)     │
│                                                                        │
│  [Dev-Level-1: Lead Architect / Planner] (Claude Sonnet / Gemini Pro)  │
│        │                                                               │
│        ▼ Generates plan.md & selects tools                             │
│  [Dev-Level-3: Core Implementer] (Fast Code Model / DeepSeek-V3)       │
│        │                                                               │
│        ▼ Authors changes.patch & Playwright tests                      │
│  [Dev-Level-2: Senior In-Container Reviewer] (Adversarial Debate)      │
│        │                                                               │
│        ├── Strike 1 ──► Targeted delta rework (no cold restart)        │
│        └── Strike 2 ──► Neutral Arbiter Escalation Memo                │
└────────────────────────────────────┬───────────────────────────────────┘
                                     ▼
         Fastify Control Plane Synchronous Quality Gates
            Clean-Code Guard ➔ Test Guard ➔ Doc Guard
                                     ▼
                      60-Second Executive Review Packet
          (Auto-Approve | AI PM Persona | Human Lead Approval)
```

---

## 🚀 Key Architectural Superpowers

### 1. Dual Operating Modes
* **Greenfield Mode**: Give it a high-level PRD or brainstorm idea. Graywolf initializes the repository structure, provisions databases, configures linting/CI, and builds the full-stack app. Supports both **Maker View** (simplified 5-column board for non-technical founders) and **Developer View**.
* **Brownfield Mode**: Connect an existing enterprise repository (GitHub, GitLab, Bitbucket, Azure DevOps). The **5-Phase Reconnaissance Pipeline** analyzes AST symbols, maps PageRank dependency centrality, and computes mathematical blast-radius boundaries before writing a single line of code.

### 2. Socratic Grilling Mode (`/grill-me`)
Before burning compute or spawning containers, enter Socratic brainstorming mode in chat. The agent actively challenges vague assumptions, checks boundary conditions, probes data models, and progressively synthesizes decisions into a structured `brief.md`—slashing mid-flight clarification halts by 70%.

### 3. Sub-2s Container Starts & Tiered Database Isolation
* **Tier 1 Package Cache**: Content-addressable volume cache absorbs `npm ci` and `pip install` taxes in 2–8 seconds with 100% build fidelity.
* **3-Tier DB Engine**: Mock (Tier 0), Schema-isolated shared dev DB (Tier 1), or copy-on-write Postgres database cloning in $<300\text{ms}$ (Tier 2) for zero-risk schema migration tests.

### 4. Enterprise Pluggability (`@graywolf/addon-sdk`)
Integrate your engineering lifecycle with official Tier 1 plugins or custom extensions:
* 💬 **Slack Cockpit**: Interactive Block Kit review packets & human-in-the-loop triage.
* 🎮 **Discord Signal**: Community bug/crash report ingestion with automated deduplication.
* 🏢 **MS Teams Cockpit**: Adaptive Cards v1.5 with verified organizational RBAC.
* 🚨 **Sentry & GitHub Issues**: Crash signal ingestion with `<untrusted_signal_payload>` sanitization.

---

## 🛠️ The Production Stack

| Component | Technology | Description |
|---|---|---|
| **Control Plane** | Fastify 5 + TypeScript | Dual-port architecture: Port 3000 (REST/ACI) & Port 3001 (ARP WebSocket) |
| **Database** | PostgreSQL 16 + `pgvector` | Row Level Security (RLS), multi-tenant isolation, ACID token ledger |
| **Async Queues** | Valkey + BullMQ | Scalable background workers, task scheduling & crash deduplication |
| **Model Gateway** | LiteLLM Proxy | 100% open-source gateway supporting cloud APIs and zero-cost local Ollama |
| **Sandboxes** | Dockerode + Testcontainers | Seccomp-hardened, non-root runner containers with egress firewalls |
| **Dashboard UI** | React + Vite + Tailwind + Shadcn | Interactive Kanban, React Flow DAG visualizer, XTerm streaming, Monaco diffs |
| **QA Engine** | Playwright + Intent Runtime | Semantic locators, zero-token cache replay, masked visual diffing |

---

## 🏁 Quickstart: Running Graywolf Locally

### Prerequisites
- Docker Engine 24+ & Docker Compose v2
- Node.js 20+ and `pnpm` (optional, for local development)

### 1. One-Command Bootstrap (Production Compose)

```bash
# Clone the repository
git clone git@github.com:malah-code/graywolf-squad.git
cd graywolf-squad

# Run the turnkey installer script
chmod +x scripts/install.sh
./scripts/install.sh
```

The installer verifies system requirements, configures your `.env.production` file, initializes your zero-prompt master key (`~/.graywolf/master.key`), and brings up the 4-network segmented Docker topology:
- 🌐 **Web Dashboard & Cockpit**: `http://localhost:8080`
- ⚙️ **Control Plane API**: `http://localhost:3000`
- 🤖 **LiteLLM Model Gateway**: `http://localhost:4000`

### 2. Local Development Mode

```bash
# Install dependencies
pnpm install

# Run database migrations
pnpm migrate:up

# Start orchestrator in watch mode
pnpm dev
```

### 3. Run the Verification Test Suite

```bash
# Run all 516 automated unit, integration, and E2E benchmark tests
pnpm test

# Full typecheck and linter audit
pnpm typecheck && pnpm lint
```

---

## 📊 Complete Feature & Phase Roadmap

Graywolf Squad is fully engineered across **20 architectural phases** defined in [`docs/implementation-plan-detailed.md`](docs/implementation-plan-detailed.md):

<details>
<summary><strong>Click to expand the 20-Phase Architectural Matrix (All 100% Converged)</strong></summary>

| Phase | Domain | Status | Key Deliverables |
|:---:|:---|:---:|:---|
| **P0** | **Bootstrap & Dual-Port Skeleton** | ✅ | Fastify dual-port skeleton, TypeBox contracts, structured ADR-042 error taxonomy. |
| **P1** | **Canonical Data Model & RLS** | ✅ | 24-table multi-tenant schema with PostgreSQL Row Level Security (RLS) & `withTenantContext`. |
| **P2** | **Auth, RBAC & WS TGT** | ✅ | Better-Auth session store, Casbin authorization enforcer, and single-use WebSocket tickets. |
| **P3** | **Control Plane REST & ACI Gateway** | ✅ | Schema-validated REST endpoints and model output validation gateway. |
| **P4** | **Worktrees, Locks & 3-Tier Sandbox DB** | ✅ | Relative-path Git worktrees, atomic proper-lockfile mutexes, and ephemeral Postgres cloning. |
| **P5** | **Orchestrator DAG & Clarification** | ✅ | 16-state task state machine, topological DAG scheduler, and Panic Button teardown. |
| **P6** | **Hardened Sandbox Runner & Admission** | ✅ | Seccomp confinement profile, hardware admission token-bucket, and network egress rules. |
| **P7** | **Agent Relay Protocol (ARP Port 3001)** | ✅ | In-container `relay.mjs` harness, structural `git-guard.sh`, and WebSocket backpressure. |
| **P8** | **LiteLLM Gateway & Spend Ledger** | ✅ | Virtual aliases (`agent-planner`, `agent-coder`), circuit breaker, and ACID `llm_calls` ledger. |
| **P9** | **Recon Pipeline & Dev Tiers** | ✅ | 5-phase brownfield reconnaissance scan, AST symbol graph, and 3-tier cognitive relay. |
| **P10** | **Guards, Evidence & DecisionGate** | ✅ | Deterministic Clean-Code/Test/Doc guards, append-only `.agent_evidence.db`, and System-One gates. |
| **P11** | **Review Packet & VCS Delivery** | ✅ | Provider-agnostic `repo-sdk`, 60-second review packet, and inbound PR review comment loop. |
| **P12** | **Conversational Cockpit & Kanban UI** | ✅ | React/Vite dashboard, resizable multi-tab drawer, Monaco diffs, and React Flow DAG. |
| **P13** | **Playwright E2E & Bug Bash** | ✅ | Semantic locator authoring guard, zero-token cache replay, and parallel bug bash sprints. |
| **P14** | **Continuous Learning Engine** | ✅ | 3-axis reflection worker, weekly skill curator, 80% context compressor, and stall detector. |
| **P15** | **Addon SDK & Shadow Mode** | ✅ | `@graywolf/addon-sdk`, crash deduplication, Tier 2 fail-closed SHA-256 registry lock. |
| **P16** | **Secrets Envelope & P0 Exit** | ✅ | Zero-prompt KEK (`~/.graywolf/master.key`), out-of-band secrets proxy, and P0 maturity verification. |
| **P17** | **Production Release Packaging** | ✅ | Multi-stage Dockerfiles (`linux/amd64`, `linux/arm64`), `docker-compose.prod.yml`, and installer. |
| **P18** | **First-Party Cockpit Addons** | ✅ | `@graywolf/addon-slack-cockpit`, `@graywolf/addon-discord-signal`, `@graywolf/addon-msteams-cockpit`. |
| **P19** | **Trajectory SFT Dataset Pipeline** | ✅ | Hermes Protect-Head/Tail/Summarize-Middle compressor, privacy redaction gate, and SFT exporter. |

</details>

---

## 🔒 Security & Privacy by Design

- **Zero External Token Leaks**: Tested and verified 100% offline with local Ollama runtimes (`qwen2.5-coder` + `nomic-embed-text`) with **$0.00** ledger cost and zero bytes external egress.
- **Envelope Encryption**: Per-secret DEKs are protected using AES-256-GCM via a host-level Key Encryption Key (`~/.graywolf/master.key`, mode `0600`).
- **Out-of-Band Secrets Broker**: Ephemeral runner containers receive zero cleartext production credentials. Live test API keys and git tokens are injected dynamically in-flight.
- **Privacy Redaction Gate**: SFT datasets automatically scrub API keys, database URLs, git remotes, PEM keys, and host paths while preserving relative code repository subpaths.

---

## 📄 License

Graywolf Squad is open source under the **[Elastic License 2.0 (ELv2)](LICENSE)**.

You are free to use, modify, copy, and redistribute Graywolf Squad for internal business use, testing, and development. The only restriction is that you may not provide Graywolf Squad as a managed or hosted service to third parties.

---

<p align="center">
  Built with ❤️ by <strong>Tarek El-Mallah</strong> & the <strong>Graywolf Squad Community</strong>.<br>
  <em>Software engineering with sovereign, container-isolated agent teams.</em>
</p>

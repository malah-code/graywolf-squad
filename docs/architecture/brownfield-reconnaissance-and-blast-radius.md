# Graywolf Squad — Deep-Dive Architecture: Brownfield Reconnaissance & Blast-Radius Engine

## 1. Executive Summary & Purpose

When Graywolf Squad integrates into an enterprise brownfield repository (e.g. an existing GitLab or GitHub accounting, ERP, or healthcare codebase), it cannot afford to guess conventions, modify protected infrastructure, or break existing CI/CD pipelines.

The **Reconnaissance Pass** is an automated, zero-token and low-token structural analysis phase executed **prior to any task execution**. It inspects the target repository to:
1. **Map Architectural Conventions**: Detect web frameworks (NestJS, Fastify, Express, Django, Spring), ORMs/ODMs (TypeORM, Prisma, Drizzle, SQLAlchemy), test harnesses (Jest, Vitest, Pytest), and package managers.
2. **Catalog CI/CD and Infrastructure Invariants**: Parse `.gitlab-ci.yml`, GitHub Actions (`.github/workflows/*`), Dockerfiles, and Helm charts to identify non-modifiable infrastructure.
3. **Generate Topological Codebase Map**: Build an AST symbol index and PageRank dependency graph via `tree-sitter`.
4. **Synthesize Initial Project Constitution**: Propose machine-executable linter rules and architectural invariants (`.agents/constitution.md`).
5. **Algorithmic Blast-Radius Proposal**: Automatically propose **Writable**, **Read-Only**, and **Forbidden** glob scopes based on feature briefs and dependency graph analysis, preventing accidental modifications to core infrastructure.
6. **Emit `recon-report.md`**: Produce an actionable audit report for the human lead engineer's review and sign-off during onboarding.

---

## 2. The 5-Phase Reconnaissance Pipeline

```
                             [Git Remote Cloned via repo-sdk]
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: MANIFEST & INFRASTRUCTURE SCAN (Deterministic, 0 tokens, < 1s)               │
│ - Parse package.json, pom.xml, requirements.txt, pyproject.toml, go.mod, Cargo.toml   │
│ - Identify CI/CD configs (.gitlab-ci.yml, .github/workflows/*.yml)                    │
│ - Catalog environment templates (.env.example) and database migrations                │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: TREE-SITTER AST SYMBOL EXTRACTION (0 tokens, < 5s)                           │
│ - Parse all source files across supported languages using tree-sitter grammars        │
│ - Extract classes, methods, exported functions, interfaces, and import statements     │
│ - Populate internal Code Intelligence database (code_symbols & code_references)       │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: DEPENDENCY GRAPH & CENTRALITY (0 tokens, < 2s)                               │
│ - Build directed graph G = (V, E) of modules and file import relationships             │
│ - Run PageRank algorithm to identify core utilities and leaf modules                  │
│ - Detect tightly coupled module clusters (Louvain modularity / Tarjan SCC)            │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: BLAST-RADIUS BOUNDARY PROPOSAL ALGORITHM (Deterministic + Graph Boundary)   │
│ - Auto-classify Protected Core (.github/**, .gitlab-ci.yml, src/core/auth/**) ➔ FORBIDDEN│
│ - Identify feature module root based on feature brief keywords                        │
│ - Compute transitive upstream dependencies & bounded downstream dependents ➔ READ-ONLY   │
│ - Designate feature implementation directories and tests ➔ WRITABLE                   │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: RECON REPORT SYNTHESIS & CONSTITUTION DRAFTING (Dev-Level-1, ~2,000 tokens) │
│ - Synthesize recon-report.md detailing tech stack, dependencies, and risk areas       │
│ - Author initial .agents/constitution.md runtime draft for human lead sign-off        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Heuristic Framework & Tooling Detection Matrix

During Phase 1, Graywolf evaluates deterministic signatures to fingerprint the repository without LLM invocation:

| Domain | Target Files / Signatures | Detected Technology | Default Test / Lint Commands |
| :--- | :--- | :--- | :--- |
| **Node / TS** | `package.json` with `@nestjs/core` | **NestJS** | `npm test`, `npm run lint` |
| **Node / TS** | `package.json` with `fastify` | **Fastify** | `npm test`, `npm run lint` |
| **Node / TS** | `package.json` with `next` | **Next.js** | `npm run build`, `npm run lint` |
| **Go** | `go.mod` | **Go Module** | `go test ./... -race`, `golangci-lint run` |
| **Python** | `requirements.txt` / `pyproject.toml` with `fastapi` | **FastAPI** | `pytest`, `ruff check .` |
| **Python** | `requirements.txt` / `pyproject.toml` with `django` | **Django** | `python manage.py test`, `flake8` |
| **Rust** | `Cargo.toml` | **Rust Crate** | `cargo test`, `cargo clippy` |
| **Java** | `pom.xml` / `build.gradle` (with Spring Boot) | **Spring Boot** | `mvn test` / `./gradlew test`, `checkstyle` |
| **C# / .NET** | `*.csproj` / `*.sln` | **.NET Core** | `dotnet test`, `dotnet format --verify-no-changes` |
| **PHP** | `composer.json` (with Laravel / Symfony) | **Laravel / Symfony** | `vendor/bin/phpunit`, `vendor/bin/phpstan` |
| **ORM / Data** | `prisma/schema.prisma` | **Prisma** | Migration tier 2: `prisma migrate dev` |
| **ORM / Data** | `package.json` with `typeorm` | **TypeORM** | Migration tier 2: `typeorm migration:run` |
| **ORM / Data** | `alembic.ini` | **Alembic** | Migration tier 2: `alembic upgrade head` |
| **CI / CD** | `.gitlab-ci.yml` | **GitLab CI** | Auto-classified into **Forbidden Scope** |
| **CI / CD** | `.github/workflows/*.yml` | **GitHub Actions**| Auto-classified into **Forbidden Scope** |

---

## 4. The Blast-Radius Boundary Proposal Algorithm

When a human developer creates a brownfield project or submits an initial feature brief (e.g., *"Implement VAT calculation and invoicing in the billing module"*), Graywolf executes the **Blast-Radius Boundary Proposal Algorithm**:

### 4.1 Step-by-Step Boundary Resolution

1. **Rule 0: Absolute System Forbidden Defaults (Non-Overridable)**:
   - Always placed in **Forbidden Scope**:
     - **VCS & CI/CD**: `.git/**`, `.github/**`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Dockerfile*`, `helm/**`, `docker-compose*.yml`
     - **Platform Control Files**: `relay.mjs`, `.agents/constitution.md`, `.agents/project.config.json`
   - *Note on Package Manifests (F14)*: Package manifests (e.g., `package.json`, `package-lock.json`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`) are intentionally excluded from Rule 0, as mid-task dependency installation is a supported flow. However, making manifests writable introduces two non-negotiable architectural requirements:
     1. **Distributed Manifest Write Serialization (F14 Prerequisite)**: 
        - **Pre-Dispatch Scope Overlap**: If Dev-Level-1 explicitly declares manifests in `writableScope` at dispatch, ADR-031's Pre-Dispatch Scope Overlap Checker automatically queues the task behind any other task declaring the same manifest.
        - **Mid-Task Dynamic Lock**: If Dev-Level-3 dynamically invokes a package manager (`npm install`, `go get`, `cargo add`) or modifies a manifest mid-task, `relay.mjs` intercepts the command and requests a distributed mutex from the Orchestrator via ARP message `manifest.lock.acquire`.
        - **Redis Mutex Mechanics**: The Orchestrator holds the lock at `workspace:{workspace_id}:lock:manifest:{hash(manifest_path)}` with a 60-second TTL and an active keep-alive heartbeat while the package manager executes. Queued tasks wait with exponential backoff + jitter (up to a 120-second timeout). If the lock times out, the command fails cleanly with `MANIFEST_LOCK_TIMEOUT`.
        - **Pre-Mutation Sync & Post-Mutation Verification**: Before writing, the container verifies its local base manifest is aligned with upstream. After writing, it executes `go mod verify` or `npm ls` to confirm lockfile integrity before releasing the lock.
     2. **Orchestrator Source of Truth (F14 Invariant)**: 
        - Because the container's `go.mod` is mutable by the agent, guards such as the Go Import Validator and TypeScript Module Resolver MUST source the canonical module path and dependency allowlists from the orchestrator-side **recon report** (`recon-report.json`), NEVER from the container's mutable `go.mod` on disk. This prevents an agent from manipulating module paths to bypass import bans.
2. **Step 1: Feature Root Identification**:
   - Matches brief keywords against the file tree. (e.g. "VAT calculation in billing" matches directory `src/modules/billing/**`).
   - Declares primary target: `src/modules/billing/**` and corresponding tests `tests/modules/billing/**`.
3. **Step 2: Upstream Dependency Closure (AST Graph Traversal)**:
   - Traverses the directed import graph $G$ from the target module outwards:
     $$\text{UpstreamImports} = \{ m \in V \mid \exists \text{ path } \text{target} \to m \}$$
   - Any shared models, interfaces, utility libraries, or database entities imported by the target module (e.g. `src/shared/types/**`, `src/database/models/**`) are classified as **Read-Only Scope**.
4. **Step 3: Downstream Impact Evaluation (Bounded Traversal)**:
   - Traverses reverse dependencies: modules that import the target module:
     $$\text{DownstreamDependents} = \{ d \in V \mid \exists \text{ path } d \to \text{target} \}$$
   - **Strict Traversal Boundaries (Anti-Token Bloat Guard)**:
     - **Depth Limit**: Traversal is capped at **$\text{depth} \le 1$** (direct immediate consumers only; transitive downstream consumers of consumers are excluded).
     - **Count Cap**: At most **20 direct consumer files** are placed into **Read-Only Scope** (prioritized by PageRank centrality score). Any additional consumers beyond 20 are logged to `recon-report.md` as "Downstream Regression Watchlist" but excluded from context to protect the token budget (ADR-012).
   - If downstream dependents are detected (e.g., `src/modules/checkout/checkout.service.ts` imports `billing.service.ts`), they are placed in **Read-Only Scope** and flagged in `recon-report.md` as regression risk points.

5. **Step 4: Output Proposal**:
   ```json
   {
     "writableScope": [
       "src/modules/billing/**",
       "tests/modules/billing/**"
     ],
     "readOnlyScope": [
       "src/shared/**",
       "src/database/models/**",
       "src/core/config/**",
       "src/modules/checkout/**"
     ],
     "forbiddenScope": [
       "src/core/auth/**",
       ".gitlab-ci.yml",
       "package.json",
       "docker/**",
       ".git/**"
     ]
   }
   ```

---

## 5. Artifact Output Contract: `recon-report.md`

Upon scan completion, Graywolf writes `.agents/recon-report.md` conforming to this structured schema:

```markdown
# Brownfield Reconnaissance Report

**Target Repository**: acme-financial/billing-service  
**Scanned Branch**: main  
**Commit SHA**: 4f8a12e9b...  
**Scan Timestamp**: 2026-09-14T21:57:00Z  

---

## 1. Architectural Summary
- **Language**: TypeScript 5.4
- **Primary Framework**: NestJS 10.3 (Modular Controller-Service-Repository architecture)
- **Data Layer**: PostgreSQL 16 via TypeORM 0.3
- **Test Harness**: Jest 29.7 (Unit) + Supertest (E2E)
- **CI/CD Platform**: GitLab CI (.gitlab-ci.yml detected)

## 2. Codebase Topology & Centrality
- **Total Source Files**: 248
- **Identified Symbols**: 1,842 (Classes: 184, Interfaces: 320, Functions: 1,338)
- **Highest Centrality Modules (PageRank Top 5)**:
  1. `src/shared/database/connection.ts` (Score: 0.084)
  2. `src/modules/auth/jwt.strategy.ts` (Score: 0.062)
  3. `src/shared/errors/app-error.ts` (Score: 0.051)
  4. `src/modules/users/user.entity.ts` (Score: 0.048)
  5. `src/shared/utils/currency.ts` (Score: 0.039)

## 3. Proposed Blast-Radius Scopes

### 🟢 Writable Scope (Designated Sandbox Workspace)
- `src/modules/tax/**`
- `tests/modules/tax/**`

### 🟡 Read-Only Scope (Inspected for Context & Types)
- `src/shared/**`
- `src/database/entities/**`
- `src/modules/invoicing/types/**`

### 🔴 Forbidden Scope (Non-Modifiable Infrastructure)
- `src/modules/auth/**` (Security Boundary)
- `.gitlab-ci.yml` (CI/CD Pipeline)
- `package.json`, `package-lock.json` (Root Dependencies)
- `docker-compose.yml`, `Dockerfile` (Container Infrastructure)

## 4. Key Architectural Invariants for Constitution
1. Controllers must never inject TypeORM repositories directly; must use domain services.
2. All dates must be stored in UTC via ISO-8601 strings; `moment` is strictly prohibited.
3. Database migrations in `src/database/migrations/` must be backward-compatible.
```

---

## 6. Onboarding Handshake & Human Sign-Off

The Reconnaissance Pass bridges into the Human Review Gate:

1. **Dashboard Presentation**: The web UI renders an interactive visual representation of the proposed Writable, Read-Only, and Forbidden boundaries overlaid on the file tree.
2. **Lead Developer Adjustments**: The human lead developer can click to add or remove globs, tune test execution commands, or amend proposed constitution rules.
3. **Commit to Repository**: Clicking **`[ Approve & Initialize Squad ]`** commits `.agents/project.config.json` and `.agents/constitution.md` to the target repository's branch.
4. **Autonomous Ready State**: The squad transitions from onboarding into active execution, capable of receiving tasks without risk of scope escape.

# Graywolf Squad — Deep-Dive Architecture: Project Constitution & Machine Enforcement

## 1. Executive Summary & Concept

In an autonomous multi-agent engineering platform, the **Constitution** is the supreme architectural law of a repository. It represents the non-negotiable boundaries, coding standards, library preferences, and prohibited patterns that human lead engineers would enforce on any new developer joining the team.

Rather than treating the Constitution as vague philosophical advice, Graywolf Squad establishes the Constitution as a **machine-readable, dual-enforced artifact**:
1. **Cognitive Enforcement**: Injected verbatim into the prompt bundle of **Dev-Level-1 (Planner)** to steer high-level strategy and prevent architecture drift.
2. **Deterministic Enforcement**: Machine-compiled into strict AST linter rules and grep assertions that **Dev-Level-2 (In-Container Reviewer)** executes inside the sandbox *before* invoking any LLM, catching violations in milliseconds for $0.

---

## 2. File Format & Specification

The Constitution follows a two-stage lifecycle:
1. **Master Template**: Stored at `.specify/memory/constitution.md` (project-global architectural principles and technology standards).
2. **Per-Project Runtime Copy**: Created at `.agents/constitution.md` during project onboarding (initialized from the master template, then customized with project-specific rules during the Reconnaissance pass and lead developer sign-off).

The runtime copy uses Markdown with a structured YAML frontmatter:

```markdown
---
version: "graywolf.constitution.v1"
projectId: "acme-billing-service"
language: "typescript"
framework: "fastify"

# Machine-Executable Checks (Run by Dev-Level-2 deterministic guard)
executableRules:
  nodejs:
    pathPattern: "src/frontend/**"
    lintCommand: "npm run lint"
    typecheckCommand: "npm run typecheck"
    testCommand: "npm test"
  golang:
    pathPattern: "src/backend/**"
    lintCommand: "golangci-lint run"
    testCommand: "go test ./... -race"

  forbiddenImports:
    - pattern: "moment"
      reason: "Moment.js is deprecated. Use date-fns or native Temporal API."
    - pattern: "lodash"
      reason: "Use native ES2022 array methods or micro-utilities."
    - pattern: "axios"
      reason: "Use native global fetch() or undici."
  forbiddenRegex:
    - regex: "any\\[\\]"
      reason: "Explicit type declarations required; untyped any arrays banned."
    - regex: "console\\.log\\("
      reason: "Use injected Pino logger (req.log), not raw console.log."

# Contract & Domain Invariants (Machine-Verified & Assistive Heuristics)
architecturalInvariants:
  apiContractValidation:
    sourceOfTruth: "api/openapi.yaml"
    enforceOn: ["src/backend/handlers/**", "src/frontend/api/client.ts"]
    reason: "Backend and frontend must exactly implement the OpenAPI spec."
  queryScopingInvariant:
    # Assistive heuristic layered into Confidence Scoring (ADR-033), NOT an infallible static guarantee.
    # While simple patterns catch obvious misses, dynamic query construction, multi-function builders, and raw SQL
    # cannot be fully proven absent of leaks via static AST alone.
    pattern: "org_id = ?"
    enforceOn: ["src/backend/repository/**"]
    approvedScopedWrappers: ["src/backend/db/ScopedRepository.go", "src/backend/db/tenant_context.go"]
    confidencePenaltyOnAmbiguity: 0.35
    reason: "All tenant-aware queries must strictly predicate on org_id. Unrecognized query builder patterns trigger an immediate confidence deduction and require human review."

# Architectural Invariants (Enforced cognitively by Dev-Level-1 Planner)
architecturalRules:
  - "Controllers must never execute SQL queries or access TypeORM entities directly; all persistence must go through Service repositories."
  - "Every public API endpoint must define a strict TypeBox / Zod JSON schema for request validation."
  - "Database migrations must be strictly additive and backward-compatible with the running deployment."

# Licensing & Dependency Constraints
governance:
  allowedLicenses: ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"]
  prohibitedLicenses: ["GPL-3.0", "AGPL-3.0", "SSPL"]
---

# Acme Billing Service — Architectural Constitution

## Philosophy
This service processes financial transactions. Reliability, immutability, and zero-downtime migrations take absolute priority over developer convenience.

## Core Invariants
1. **Idempotency**: All payment and billing endpoints must require an `Idempotency-Key` header.
2. **Audit Trails**: Financial records are append-only. Rows in `invoices` or `ledger_entries` are never updated in place.
```

---

## 3. Dual-Tier Enforcement Engine

```
                                  [Task Brief Dispatched]
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ TIER 1: COGNITIVE GUIDANCE (Dev-Level-1 Planner)       │
                 │ Injects architecturalRules + governance into context   │
                 │ Result: plan.md structurally respects constraints      │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ Dev-Level-3 (Implementer) writes code & candidate.patch│
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │ TIER 2: DETERMINISTIC MACHINE GUARD (In-Container)     │
                 │ Executed by Dev-Level-2 BEFORE calling Reviewer LLM:   │
                 │ 1. ast-grep scans candidate.patch for forbiddenImports │
                 │ 2. ripgrep scans for forbiddenRegex patterns           │
                 │ 3. osv-scanner checks new packages against license list│
                 │    (govulncheck is deduped in favor of osv-scanner)    │
                 │ 4. Tool versions must be pinned (no @latest allowed)   │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         ▼                                       ▼
                   Checks Pass                             Rule Violation
                         │                                       │
                         ▼                                       ▼
            ┌──────────────────────────┐            ┌──────────────────────────┐
            │ Invoke Dev-Level-2 LLM   │            │ Instant Reject (0 tokens)│
            │ for deep semantic review │            │ Return structured error: │
            └──────────────────────────┘            │ "Banned import: moment"  │
                                                    └──────────────────────────┘
```

### 3.1 Why Deterministic Pre-Filtering Is Critical
- **Cost & Speed**: If an implementer accidentally imports `moment` or leaves a `console.log`, calling a frontier reasoning model (Dev-Level-2) costs tokens and takes 10 seconds to say *"Please remove moment"*.
- **Fallback Strategy**: If an active project spans across boundary files that belong to an un-scanned adjacent module, a full re-scan and boundary re-calculation is mandated.
- The deterministic pre-filter catches this in **8 milliseconds** via `ast-grep` or `ripgrep` inside the container for **$0.00**, returning immediate revision instructions to Dev-Level-3.

### 3.2 Deterministic Guards vs. Assistive Invariant Heuristics
A critical distinction is maintained between:
1. **Deterministic Guards** (`forbiddenImports`, `forbiddenRegex`, `prohibitedLicenses`): Checks for the *presence* of forbidden tokens. These are binary, unambiguous, and carry near-zero false-negative rates. Violations trigger an immediate 0-token rejection.
2. **Assistive Invariant Heuristics** (`queryScopingInvariant`, structural encapsulation): Checking for the *absence* of a tenant-scoping predicate across open-ended query construction patterns (raw SQL strings, GORM/sqlx method chains, multi-function query builders) is fundamentally an open-world problem. A simple AST or regex pattern will catch obvious violations, but **cannot guarantee total absence of leaks**.
   - **No False Green Pass**: If an un-scoped query pattern is caught, it is flagged immediately.
   - **Confidence Penalty for Ambiguous Patterns**: Any file touching queries (`src/backend/repository/**`) that does *not* strictly route through provably-scoped repository wrappers (`approvedScopedWrappers`) automatically suffers a **confidence penalty** (e.g. -0.35, capping confidence at Medium/Low).
   - **Explicit Human Escalation**: In the Executive Review Packet, this file is surfaced with an explicit advisory: *"Query touched without provably scoped ORM wrapper: manual query review recommended for multi-tenant isolation"*. This ensures ambiguous queries never pass silently with artificial high confidence.

---

## 4. Lifecycle & Authorship

1. **Auto-Generation during Reconnaissance**:
   When a brownfield repository is onboarded, the Reconnaissance pass (§7.3) inspects the package manifests, ESLint configurations, and existing code patterns to author an initial draft of `.agents/constitution.md`.
2. **Lead Developer Sign-Off**:
   During the onboarding wizard, the human lead developer reviews, tunes, and commits the Constitution to the repository.
3. **Continuous Evolution**:
   When humans reject PRs due to team convention violations, the Continuous Learning Engine (§9) proposes additions to the Constitution, allowing the ruleset to mature over time with human approval.

---

## 5. Ecosystem Convention Files & Precedence Hierarchy (ADR-038)

Modern software repositories increasingly contain existing agent/developer guidelines authored for tools like Claude Code, Cursor, Windsurf, or Copilot. To eliminate duplicate rule authoring and make Graywolf feel native from day one, Graywolf automatically discovers and ingests these convention files.

### 5.1 Precedence Cascade

During the task pre-flight routine, rules are aggregated according to a strict hierarchical precedence order (higher levels override lower levels on direct conflicts; all non-conflicting rules are additive):

```
┌────────────────────────────────────────────────────────────────────────┐
│ Level 1: System Baseline Constitution (.specify/memory/constitution.md)│
│ Core invariants: Non-committing git barrier, blast radius scopes,       │
│ $0 OSS toolchain constraints, container security boundaries.           │
│ (IMMUTABLE — NEVER OVERRIDDEN BY REPOSITORY RULES)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ overrides
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 2: Project Runtime Constitution (.agents/constitution.md)        │
│ Machine-executable linters, architecturalRules, banned packages,       │
│ approved licenses, vetted by human lead engineer.                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ overrides
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Level 3: Repo-Native Ecosystem Convention Files                        │
│ Discovered automatically at repository root during reconnaissance:     │
│ 1. AGENTS.md                                                           │
│ 2. CLAUDE.md                                                           │
│ 3. .cursorrules or .cursor/rules/*.mdc                                 │
│ 4. .windsurfrules                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Context Injection Mechanics

1. **Discovery**: During the pre-flight routine, `relay.mjs` scans the repository root for any of the supported convention files.
2. **Sanitization**: Discovered files are read into memory and checked against the **Blast-Radius Invariant**: convention files cannot override file scopes or disable the non-committing barrier (`git-guard.sh`).
3. **Prompt Section**: The raw markdown content is injected directly into Dev-Level-1 (Planner) and Dev-Level-3 (Implementer) context windows under the header:
   ```markdown
   ## Repository Local Guidelines (from AGENTS.md / CLAUDE.md)
   <Ingested markdown content>
   ```
4. **Zero Supply-Chain Bloat**: The parser is a lightweight native TypeScript markdown reader — no external meta-frameworks or runtime dependencies are required ($0 cost).

---

## 6. Pending Enhancements & Sequencing (Ledger)

To prevent Goodharting and maintain rule integrity, certain gaps from the field reports have explicit sequencing dependencies before they can be implemented into the constitution:
- **Gap 9 (Test Naming Validation)**: Must be sequenced **behind** Enhancement #9 (Adversarial Tester Persona). Enforcing test naming rules before separating test authorship from implementation incentivizes agents to write empty tests just to pass the guard.
- **Gap 4 (Polyglot Contract Registry)**: **RESOLVED**. Sequenced strictly behind N11b (Severity Classification) and fully specified in `review-gates-and-guardrails.md` §7.9 with binary severity tiers (Breaking hard-block vs Additive green-pass) and F11 diff-scoping.


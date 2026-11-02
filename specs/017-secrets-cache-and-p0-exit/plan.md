# Implementation Plan: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

**Branch**: `017-secrets-cache-and-p0-exit` | **Date**: 2026-11-01 | **Spec**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/017-secrets-cache-and-p0-exit/spec.md)  
**Input**: Feature specification from `/specs/017-secrets-cache-and-p0-exit/spec.md` & `docs/implementation-plan-detailed.md` Phase 16

## Summary

Complete Phase 16 (the final phase of P0 platform maturity) across 4 core subsystems:
1. **Task 16.1 (`src/orchestrator/security/kek-vault.ts`, `src/orchestrator/security/mcp-redaction.ts`)**: Zero-prompt Master Key Encryption Key (`~/.graywolf/master.key`, `0600`) with pluggable KMS interface, AES-256-GCM column-level envelope encryption (`encrypted_dek` + `encrypted_value` in `secret_vault`), and ADR-055 MCP Credential Redaction (`REDACTED_MCP_SECRET_VALUE = "**********"`, untouched secret leaf preservation on edit, and server-side recursive probe re-hydration).
2. **Task 16.2 (`src/orchestrator/security/secrets-proxy.ts`, `src/orchestrator/security/secret-scrubber.ts`)**: Out-of-Band Secrets Proxy ensuring zero raw secrets in container `process.env`, issuing short-lived (300s TTL) scoped Git tokens via a local credential helper socket/broker, substituting `sk_test_placeholder_<name>` headers in-flight, and scrubbing all `terminal.chunk` streams, logs, and PR Review Packets with `[REDACTED_SECRET_BY_GRAYWOLF]`.
3. **Task 16.3 (`src/orchestrator/runner/cache.ts`, `src/orchestrator/ServiceOtel.ts`)**: Tier 1 content-addressable package-manager cache volume (`pkg-cache-{project_id}` mapped to `~/.npm`, `~/.local/share/pnpm/store`, `~/.cache/pip`, `~/.cargo/registry`, Go caches, etc., with post-merge background warming), Tier 2 BuildKit snapshot pre-bake worker debounced behind a 10-minute (`600,000` ms) lockfile quiescence window, and optional OpenTelemetry (`gen_ai.*`) OTLP trace exporter (`ServiceOtel.ts`, disabled by default for `$0` Solo runs).
4. **Task 16.4 (`tests/e2e/p0-maturity-benchmarks.test.ts`)**: Automated P0 Platform Maturity Exit Benchmark Suite proving all 4 PRD §16 exit criteria (5 consecutive Brownfield tasks, 100% Gate Integrity, `< 2000` ms container cold start, and `$0.00` / `0`-byte external egress offline Ollama run).

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)  
**Primary Dependencies**: `node:crypto` (AES-256-GCM), `node:fs/promises`, `@sinclair/typebox`, PostgreSQL (`pg` via `withTenantContext`), Valkey (debounce state & token store)  
**Storage**: PostgreSQL 16 (`secret_vault`, `mcp_servers`) + Host filesystem (`~/.graywolf/master.key`, `0600`) + Docker Volumes (`pkg-cache-{project_id}`) + Valkey (`cache:debounce:{project_id}`)  
**Testing**: Vitest (`tests/unit/kek-vault-and-mcp-redaction.test.ts`, `tests/unit/secrets-proxy-and-scrubber.test.ts`, `tests/integration/cache-cold-start.test.ts`, `tests/e2e/p0-maturity-benchmarks.test.ts`)  
**Target Platform**: Linux server & Solo developer workstation  
**Project Type**: Backend security, container runner cache, observability, and E2E benchmark suite  
**Performance Goals**: `< 1ms` per-chunk secret scrubbing; `< 2000ms` container cold start on warmed Tier 1 cache; `600,000ms` (10m) lockfile debounce quiescence  
**Constraints**: Zero raw `secret_vault` values in container `process.env`; never mount raw `node_modules` or `.venv` across containers; OTLP exporter off by default (`0` bytes external egress in offline mode)  
**Scale/Scope**: 6 source modules + 4 test suites (2 unit, 1 integration, 1 E2E benchmark)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

1. **Human Sovereignty & Non-Committing Relay Contract**: **PASS** — P0 Exit Benchmark 2 & 1 verify 100% Gate Integrity and non-committing relay isolation across 5 consecutive Brownfield tasks.
2. **Zero Runtime Lock-In & Permissive Licensing First**: **PASS** — Uses built-in `node:crypto` AES-256-GCM, standard OpenTelemetry semantic conventions, and Docker BuildKit cache mounts without proprietary dependencies.
3. **Single ACID Relational & Vector Baseline**: **PASS** — Uses the existing `secret_vault` and `mcp_servers` tables in PostgreSQL 16 with `withTenantContext` RLS isolation.
4. **Headless Execution & Observability**: **PASS** — `ServiceOtel.ts` emits standardized `gen_ai.*` spans when enabled while defaulting to zero-egress no-op for Solo/offline deployments.
5. **Dual Operational Mode (Greenfield & Brownfield)**: **PASS** — P0 Exit Benchmark 1 directly certifies 5 consecutive Brownfield tasks with `Writable`, `Read-Only`, and `Forbidden` scope enforcement.
6. **Virtual Developer Tier Handoff Protocol**: **PASS** — End-to-end Brownfield benchmark exercises Dev-Level-1 Planner $\rightarrow$ Dev-Level-3 Implementer $\rightarrow$ Dev-Level-2 Reviewer handoffs.
7. **Chat as Active Control Plane (Cockpit Rule)**: **PASS** — ADR-055 MCP credential redaction protects Cockpit MCP settings against browser network inspection while preserving one-click connectivity probes.
8. **Blast-Radius and Dependency Integrity**: **PASS** — Tier 1 cache mounts content-addressable package stores (`pkg-cache-{project_id}`) into isolated task worktrees without sharing mutable `node_modules` or `.venv`.
9. **Zero-Cost Open Source Foundation ($0 Platform License)**: **PASS** — P0 Exit Benchmark 4 verifies 100% offline execution (`qwen2.5-coder` + `nomic-embed-text` via Ollama) with `$0.00` ledger cost and `0` bytes external egress.

## Project Structure

### Documentation (this feature)

```text
specs/017-secrets-cache-and-p0-exit/
├── spec.md                              # Feature specification with 5 clarifications encoded
├── plan.md                              # This file
├── research.md                          # Phase 0 architectural research decisions
├── data-model.md                        # Phase 1 entities, binary layouts & cache mappings
├── quickstart.md                        # Phase 1 runnable verification guide
├── checklists/
│   └── requirements.md                  # 16/16 passing quality checklist
└── contracts/
    └── secrets-cache-and-p0-exit.md     # TypeScript module & benchmark contracts
```

### Source Code (repository root)

```text
src/orchestrator/
├── ServiceOtel.ts                       # Task 16.3b: Opt-in OpenTelemetry (gen_ai.*) OTLP trace exporter
├── runner/
│   └── cache.ts                         # Task 16.3a: Tier 1 pkg-cache-{project_id} mounts & Tier 2 10m debounced pre-bake
└── security/
    ├── kek-vault.ts                     # Task 16.1a: ~/.graywolf/master.key (0600) & AES-256-GCM secret_vault envelope encryption
    ├── mcp-redaction.ts                 # Task 16.1b: ADR-055 REDACTED_MCP_SECRET_VALUE ("**********") & probe re-hydration
    ├── secrets-proxy.ts                 # Task 16.2a: Out-of-band Git credential helper (300s TTL) & placeholder substitution
    └── secret-scrubber.ts               # Task 16.2b: High-throughput regex + vault-literal scrubber ([REDACTED_SECRET_BY_GRAYWOLF])

tests/
├── unit/
│   ├── kek-vault-and-mcp-redaction.test.ts   # Task 16.1 unit tests
│   └── secrets-proxy-and-scrubber.test.ts    # Task 16.2 unit tests
├── integration/
│   └── cache-cold-start.test.ts              # Task 16.3 integration tests (<2s warm cold start & 10m debounce)
└── e2e/
    └── p0-maturity-benchmarks.test.ts        # Task 16.4 P0 Platform Maturity Exit Benchmark Suite (PRD §16)
```

**Structure Decision**: Matches the exact file paths and test suites specified in `docs/implementation-plan-detailed.md` Phase 16 (Tasks 16.1, 16.2, 16.3, and 16.4).

## Complexity Tracking

No Constitution violations or complexity exceptions required.

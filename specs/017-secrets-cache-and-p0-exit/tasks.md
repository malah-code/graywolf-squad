# Tasks: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

**Input**: Design documents from `/specs/017-secrets-cache-and-p0-exit/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/secrets-cache-and-p0-exit.md`, `quickstart.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 16 (`tests/unit/kek-vault-and-mcp-redaction.test.ts`, `tests/unit/secrets-proxy-and-scrubber.test.ts`, `tests/integration/cache-cold-start.test.ts`, `tests/e2e/p0-maturity-benchmarks.test.ts`).

**Organization**: Tasks are grouped by user story (`US1` $\rightarrow$ Task 16.1, `US2` $\rightarrow$ Task 16.2, `US3` $\rightarrow$ Task 16.3, `US4` $\rightarrow$ Task 16.4) with every binary layout, regex, TTL, mount path, and P0 benchmark assertion quoted verbatim.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Zero-Prompt KEK (`~/.graywolf/master.key`), Envelope-Encrypted `secret_vault` & MCP Credential Redaction (Priority: P1 — Master Plan Task 16.1) 🎯 MVP

**Goal**: Implement `src/orchestrator/security/kek-vault.ts` and `src/orchestrator/security/mcp-redaction.ts` providing zero-prompt `~/.graywolf/master.key` (`0600`) generation with a pluggable KMS interface, AES-256-GCM envelope encryption (`encrypted_dek` + `encrypted_value`) in `secret_vault`, and ADR-055 MCP Credential Redaction (`REDACTED_MCP_SECRET_VALUE = "**********"`).

**Independent Test**: Run `pnpm vitest run tests/unit/kek-vault-and-mcp-redaction.test.ts` to verify `0600` master key permissions, 61-byte `encrypted_dek` wrapping, AAD-bound AES-256-GCM `encrypted_value` encryption/tamper rejection, and MCP `"**********"` masking, edit preservation, and probe re-hydration.

### Implementation & Tests for User Story 1 (Master Plan Task 16.1)

- [x] T001 [P] [US1] Implement `KekProvider`, `LocalFileKekProvider`, and `EnvelopeSecretVault` in `src/orchestrator/security/kek-vault.ts` auto-generating a 32-byte master key at `~/.graywolf/master.key` with `0600` file permissions on first boot (or enforcing `chmod 0600` if existing permissions are broader), wrapping per-secret 32-byte random DEKs (`encrypted_dek`) and secret values (`encrypted_value`) as version-prefixed AES-256-GCM binary buffers `Buffer.concat([Buffer.from([0x01]), iv12, authTag16, ciphertext])` with AAD `${workspaceId}:${secretName}`, and persisting/querying PostgreSQL `secret_vault` via `withTenantContext` (with in-memory store fallback)
- [x] T002 [P] [US1] Implement `REDACTED_MCP_SECRET_VALUE = "**********"`, `isSensitiveMcpKey`, `redactMcpConfigForUi`, `mergeMcpConfigOnUpdate`, and `rehydrateMcpConfigForProbe` in `src/orchestrator/security/mcp-redaction.ts` matching sensitive keys via `/(?:api[_-]?key|token|secret|password|auth(?:orization)?|credential|private[_-]?key)/i` and `secretRefs`, masking credential leaves as `"**********"` for the UI, preserving untouched encrypted leaves when `"**********"` is submitted on edit, and recursively merging `"**********"` leaves with decrypted server-side values in memory during connectivity probes (ADR-055)
- [x] T003 [US1] Create unit test suite in `tests/unit/kek-vault-and-mcp-redaction.test.ts` testing `LocalFileKekProvider` `0600` permission enforcement, unique per-secret DEK generation, AES-256-GCM ciphertext/tag/cross-tenant AAD tamper rejection, and ADR-055 MCP credential redaction, partial update preservation, and probe re-hydration

**Checkpoint**: User Story 1 (Task 16.1) is complete and independently verified via `tests/unit/kek-vault-and-mcp-redaction.test.ts`.

---

## Phase 2: User Story 2 - Out-of-Band Secrets Proxy, Git Credential Socket & High-Throughput Regex Secret Scrubber (Priority: P1 — Master Plan Task 16.2)

**Goal**: Implement `src/orchestrator/security/secrets-proxy.ts` and `src/orchestrator/security/secret-scrubber.ts` ensuring zero raw secrets in container `process.env`, issuing 300s scoped Git tokens via the out-of-band credential helper, substituting `sk_test_placeholder_<name>` headers in-flight, and scrubbing all `terminal.chunk` streams, logs, and PR Review Packets with `[REDACTED_SECRET_BY_GRAYWOLF]`.

**Independent Test**: Run `pnpm vitest run tests/unit/secrets-proxy-and-scrubber.test.ts` to verify sanitized container env generation, 300s Git token expiry, in-flight third-party placeholder substitution + response scrubbing, and streaming regex + vault-literal scrubbing across split chunk boundaries.

### Implementation & Tests for User Story 2 (Master Plan Task 16.2)

- [x] T004 [P] [US2] Implement `REDACTED_SECRET_REPLACEMENT = "[REDACTED_SECRET_BY_GRAYWOLF]"`, `scrubSecretsFromText`, and `createStreamingSecretScrubber` in `src/orchestrator/security/secret-scrubber.ts` matching GitHub PATs (`ghp_`, `github_pat_`), GitLab PATs (`glpat-`), OpenAI (`sk-`), Anthropic (`sk-ant-`), AWS (`AKIA`), Slack (`xox[baprs]-`), PEM private keys, Bearer tokens, and registered `secret_vault` literal values (`>= 6` chars), including sliding-window carry-over buffering for secrets split across adjacent `terminal.chunk` frames
- [x] T005 [P] [US2] Implement `buildSanitizedContainerEnv` and `SecretsBrokerProxy` in `src/orchestrator/security/secrets-proxy.ts` stripping all `secret_vault` keys/values from container `env` (injecting only `OPENAI_BASE_URL`, `OPENAI_API_KEY: 'sk-graywolf-internal-proxy-token'`, and `GRAYWOLF_SECRETS_SOCKET: '/var/run/graywolf/secrets.sock'`), issuing scoped ephemeral Git tokens (`ttlSeconds: 300`) formatted for Git's `credential.helper` `get` protocol, and rewriting outbound test requests containing `sk_test_placeholder_<name>` or `X-Graywolf-Secret-Placeholder` while scrubbing injected secrets from inbound responses
- [x] T006 [US2] Create unit test suite in `tests/unit/secrets-proxy-and-scrubber.test.ts` testing zero raw secrets in `buildSanitizedContainerEnv`, 300s scoped Git credential helper grants and expiration, in-flight `sk_test_placeholder_*` substitution and error response scrubbing, and `scrubSecretsFromText` / `createStreamingSecretScrubber` across single and split `terminal.chunk` buffers

**Checkpoint**: User Story 2 (Task 16.2) is complete and independently verified via `tests/unit/secrets-proxy-and-scrubber.test.ts`.

---

## Phase 3: User Story 3 - Sub-2s Package Cache Volume (Tier 1), Debounced Pre-Bake Worker (Tier 2) & Optional OTLP Exporter (Priority: P1 — Master Plan Task 16.3)

**Goal**: Implement `src/orchestrator/runner/cache.ts` and `src/orchestrator/ServiceOtel.ts` mounting `pkg-cache-{project_id}` content-addressable package stores (with post-merge warming and `< 2000` ms warm cold start), debouncing Tier 2 BuildKit pre-bake image rebuilds behind a 10-minute (`600,000` ms) lockfile quiescence window, and providing an opt-in OpenTelemetry (`gen_ai.*`) trace exporter disabled by default.

**Independent Test**: Run `pnpm vitest run tests/integration/cache-cold-start.test.ts` to verify Tier 1 mount paths, rejection of `node_modules`/`.venv` mounts, `< 2000` ms warm container cold start, 10-minute Tier 2 lockfile quiescence debounce, and `ServiceOtel` zero-egress default vs enabled OTLP export.

### Implementation & Tests for User Story 3 (Master Plan Task 16.3)

- [x] T007 [P] [US3] Implement `TIER2_LOCKFILE_QUIESCENCE_MS = 600_000`, `resolveTier1CacheMounts`, `assertValidCacheMounts`, `warmTier1PackageCacheOnMerge`, `measureWarmContainerColdStart`, and `Tier2PreBakeScheduler` in `src/orchestrator/runner/cache.ts` mapping `pkg-cache-{project_id}` to `/home/graywolf/.npm`, `/home/graywolf/.local/share/pnpm/store`, `/home/graywolf/.cache/pip`, `/home/graywolf/.cache/uv`, `/home/graywolf/.cache/go-build`, `/home/graywolf/go/pkg/mod`, `/home/graywolf/.cargo/registry`, `/home/graywolf/.cargo/git`, `/home/graywolf/.m2/repository`, `/home/graywolf/.gradle/caches`, `/home/graywolf/.nuget/packages`, and `/home/graywolf/.cache/composer` (rejecting `node_modules` or `.venv`), and enforcing a 10-minute (`600,000` ms) lockfile quiescence timer before emitting BuildKit `--mount=type=cache` snapshot rebuild jobs
- [x] T008 [P] [US3] Implement `ServiceOtel` in `src/orchestrator/ServiceOtel.ts` defaulting to disabled (`enabled: false`, `0` bytes external egress for `$0` Solo runs) and, when enabled, recording standardized `gen_ai.*` spans (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `graywolf.task.id`, `graywolf.dev.tier`) with all span attributes scrubbed via `scrubSecretsFromText`
- [x] T009 [US3] Create integration test suite in `tests/integration/cache-cold-start.test.ts` asserting `< 2000` ms container boot across repeated warm cache runs, rejection of raw `node_modules`/`.venv` mounts, 10-minute (`600,000` ms) Tier 2 lockfile debounce reset behavior, and `ServiceOtel` disabled vs enabled span export

**Checkpoint**: User Story 3 (Task 16.3) is complete and independently verified via `tests/integration/cache-cold-start.test.ts`.

---

## Phase 4: User Story 4 - P0 Platform Maturity Exit Benchmark Suite (Priority: P1 — Master Plan Task 16.4)

**Goal**: Implement `tests/e2e/p0-maturity-benchmarks.test.ts` proving all 4 P0 Platform Maturity Exit Criteria from `docs/PRD.md` §16.

**Independent Test**: Run `pnpm vitest run tests/e2e/p0-maturity-benchmarks.test.ts` to verify all 4 P0 exit benchmarks pass deterministically.

### Implementation & Tests for User Story 4 (Master Plan Task 16.4)

- [x] T010 [US4] Implement the automated P0 Platform Maturity Exit Benchmark Suite in `tests/e2e/p0-maturity-benchmarks.test.ts` verifying all 4 PRD §16 criteria: (1) **5 Consecutive Brownfield Tasks Completed** with `0` container deadlocks, `0` blast-radius boundary escapes, and `0` git conflicts; (2) **100% Gate Integrity** blocking 100% of unauthorized modifications to protected branches (`main`/`master`) or `Forbidden`/`Read-Only` scopes; (3) **Sub-2s Container Cold Start** (`< 2000` ms) verified across repeated task runs using Tier 1 `pkg-cache-{project_id}`; and (4) **Zero External Token Leaks** verified on a 100% offline local Ollama run (`qwen2.5-coder` + `nomic-embed-text`) with `$0.00` ledger cost, `0` bytes external egress, and `0` plaintext secrets in container env or logs

**Checkpoint**: User Story 4 (Task 16.4) is complete and independently verified via `tests/e2e/p0-maturity-benchmarks.test.ts`.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, build, and regression verification across all 17 phases (`P0`–`P16`).

- [x] T011 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` across all suites and mark Tasks 16.1, 16.2, 16.3, and 16.4 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T003`, US1 `kek-vault.ts` & `mcp-redaction.ts`)**: No dependencies — starts immediately.
- **Phase 2 (`T004`–`T006`, US2 `secret-scrubber.ts` & `secrets-proxy.ts`)**: `T004` and `T005` can start in parallel with Phase 1 (`secrets-proxy.ts` uses `secret-scrubber.ts` for response scrubbing).
- **Phase 3 (`T007`–`T009`, US3 `cache.ts` & `ServiceOtel.ts`)**: `T007` (`cache.ts`) has no dependencies; `T008` (`ServiceOtel.ts`) uses `scrubSecretsFromText` from `T004`.
- **Phase 4 (`T010`, US4 `p0-maturity-benchmarks.test.ts`)**: Exercises modules from Phases 1–3 alongside Brownfield scope guards, gate policies, and offline Ollama routing.
- **Phase 5 (`T011`)**: Depends on `T001`–`T010`.

### Parallel Opportunities

- `T001` (`kek-vault.ts`), `T002` (`mcp-redaction.ts`), `T004` (`secret-scrubber.ts`), and `T007` (`cache.ts`) touch completely separate files and can be implemented in parallel.
- `T005` (`secrets-proxy.ts`) and `T008` (`ServiceOtel.ts`) can be implemented in parallel once `T004` is ready.

## Parallel Example: User Stories 1, 2 & 3

```bash
# Implement core security and cache modules in parallel:
Task: "T001 [P] [US1] Implement KekProvider, LocalFileKekProvider, and EnvelopeSecretVault in src/orchestrator/security/kek-vault.ts"
Task: "T002 [P] [US1] Implement REDACTED_MCP_SECRET_VALUE and MCP redaction/probe helpers in src/orchestrator/security/mcp-redaction.ts"
Task: "T004 [P] [US2] Implement scrubSecretsFromText and createStreamingSecretScrubber in src/orchestrator/security/secret-scrubber.ts"
Task: "T007 [P] [US3] Implement resolveTier1CacheMounts and Tier2PreBakeScheduler in src/orchestrator/runner/cache.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`–`T003`: Zero-Prompt KEK, Envelope Vault & MCP Redaction).
2. **STOP and VALIDATE**: Run `pnpm vitest run tests/unit/kek-vault-and-mcp-redaction.test.ts`.

### Incremental Delivery

1. Complete Phase 1 (US1 — Task 16.1) $\rightarrow$ Verify `tests/unit/kek-vault-and-mcp-redaction.test.ts`
2. Complete Phase 2 (US2 — Task 16.2) $\rightarrow$ Verify `tests/unit/secrets-proxy-and-scrubber.test.ts`
3. Complete Phase 3 (US3 — Task 16.3) $\rightarrow$ Verify `tests/integration/cache-cold-start.test.ts`
4. Complete Phase 4 (US4 — Task 16.4) $\rightarrow$ Verify `tests/e2e/p0-maturity-benchmarks.test.ts`
5. Complete Phase 5 (`T011`) $\rightarrow$ Full P0 platform convergence check


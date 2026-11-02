# Feature Specification: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

**Feature Branch**: `017-secrets-cache-and-p0-exit`  
**Created**: 2026-11-01  
**Status**: Clarified  
**Input**: User description: "Phase 16 — Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification: Complete all security hardening (`docs/architecture/security-and-secrets.md`), MCP credential redaction (ADR-055), Tier 1/Tier 2 package cache optimization (`docs/architecture/build-cache-and-performance.md`), optional OTLP export (`ServiceOtel.ts`), and automated verification of the 4 P0 Platform Maturity Exit Criteria (PRD §13, §5.6, §16)."

## Clarifications

### Session 2026-11-01

- Q: What is the exact binary envelope format for storing `encrypted_value` and `encrypted_dek` in the `BYTEA` columns of `secret_vault`? (FR-001) → A: Use a version-prefixed binary buffer `Buffer.concat([version(1 byte: 0x01), iv(12 bytes), authTag(16 bytes), ciphertext])` for both fields. For `encrypted_dek`, the ciphertext is the 32-byte DEK encrypted under KEK via AES-256-GCM (exact size: 61 bytes); for `encrypted_value`, the ciphertext is the arbitrary-length UTF-8 secret payload encrypted under DEK via AES-256-GCM.
- Q: How should `mcp-redaction.ts` discover which keys in an arbitrary MCP configuration represent credentials for masking as `REDACTED_MCP_SECRET_VALUE = "**********"` and server-side probe re-hydration? (FR-002) → A: Recursively match object keys against case-insensitive regex `/(?:api[_-]?key|token|secret|password|auth(?:orization)?|credential|private[_-]?key)/i` AND any explicit key paths specified in `mcp_servers.secret_refs`. On UI save, preserve existing encrypted values for any leaf equal to `"**********"`; on probe dispatch, clone the configuration in-memory and re-hydrate `"**********"` leaves with decrypted secrets without returning cleartext to the client.
- Q: What protocol, authentication, and lifetime limits govern the Git credential helper and third-party test placeholder substitution in `secrets-proxy.ts`? (FR-003) → A: Git operations communicate with an out-of-band credential socket (`/var/run/graywolf/secrets.sock` or HTTP loopback broker) using Git's native `credential.helper` protocol (`get`), authenticating with a task token to issue ephemeral scoped tokens with a 300-second (5-minute) TTL; third-party test requests match placeholder tokens prefixed with `sk_test_placeholder_<name>` or the `X-Graywolf-Secret-Placeholder` header, substituting decrypted values in-flight on outbound requests and stripping matching values from response headers and bodies.
- Q: Which precise host volume paths and container mount destinations compose the Tier 1 content-addressable package cache, and how is the Tier 2 10-minute quiescence window tracked? (FR-005) → A: Tier 1 mounts `pkg-cache-{project_id}` subdirectories (`npm` → `/home/graywolf/.npm`, `pnpm-store` → `/home/graywolf/.local/share/pnpm/store`, `pip` → `/home/graywolf/.cache/pip`, `uv` → `/home/graywolf/.cache/uv`, `go-mod` → `/home/graywolf/go/pkg/mod`, `cargo-registry` → `/home/graywolf/.cargo/registry`, `cargo-git` → `/home/graywolf/.cargo/git`), never mounting `node_modules` or `.venv`; Tier 2 tracks lockfile changes in Valkey key `cache:debounce:{project_id}` with a 600-second (`600,000` ms) TTL, resetting the timer on each commit and dispatching the BuildKit cache-mount snapshot build upon quiescence expiry.
- Q: What exact test execution structure and assertions define the automated verification in `tests/e2e/p0-maturity-benchmarks.test.ts`? (FR-007) → A: Structure as 4 distinct benchmark suites mapping 1:1 to PRD §16: (1) `5 Consecutive Brownfield Tasks` verifying 0 container deadlocks, 0 boundary escapes (`RELAY_BLAST_RADIUS_VIOLATION`), and 0 git conflicts; (2) `100% Gate Integrity` verifying 100% rejection of unauthorized mutations to protected branches or forbidden paths; (3) `Sub-2s Container Cold Start` asserting 3 consecutive runs boot in `< 2000` ms on warmed Tier 1 cache; (4) `Zero External Token Leaks` running offline Ollama profile asserting `$0.00` ledger cost, 0 external outbound network calls, and zero cleartext secrets in logs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero-Prompt KEK (`~/.graywolf/master.key`), Envelope-Encrypted `secret_vault` & MCP Credential Redaction (Priority: P1)

As a workspace administrator storing sensitive Git tokens, provider API keys, and MCP server credentials (`src/orchestrator/security/kek-vault.ts`, `src/orchestrator/security/mcp-redaction.ts`, ADR-013, ADR-055), I need zero-prompt master Key Encryption Key (KEK) generation at `~/.graywolf/master.key` (`chmod 0600`) with a pluggable external KMS interface, per-secret Data Encryption Key (DEK) envelope encryption (`encrypted_dek` + `encrypted_value` via AES-256-GCM) in `secret_vault`, and ADR-055 MCP credential redaction (`REDACTED_MCP_SECRET_VALUE = "**********"`) that masks stored secrets in UI payloads while recursively re-hydrating untouched encrypted leaves server-side during connectivity probes.

**Why this priority**: Guarantees database dumps (`pg_dump`) and browser network traces never expose cleartext secrets while maintaining the `< 1 second` zero-prompt boot experience required by Solo and Team operators.

**Independent Test**: Can be tested by initializing the KEK manager in a temporary directory and verifying `0600` file permissions, encrypting and decrypting secrets via per-record DEKs, confirming tampering with ciphertext or auth tags fails closed, and running MCP config redaction, partial update preservation, and probe leaf merging against `REDACTED_MCP_SECRET_VALUE = "**********"`.

**Acceptance Scenarios**:

1. **Given** an initial orchestrator boot where `~/.graywolf/master.key` does not exist, **When** the KEK vault initializes, **Then** it silently generates a cryptographically random 32-byte (256-bit) master key at the configured path with `0600` (`rw-------`) permissions (or delegates wrap/unwrap to a pluggable KMS provider), and for every secret stored in `secret_vault` it generates a unique random 256-bit DEK, encrypts the secret value with the DEK (`encrypted_value`), and encrypts the DEK with the KEK (`encrypted_dek`).
2. **Given** an MCP server configuration containing sensitive credential fields (`apiKey`, `token`, `secret`, `password`, `authorization`, or keys listed in `secretRefs`), **When** the configuration is serialized for the Cockpit Settings UI, **Then** every secret leaf is replaced with `REDACTED_MCP_SECRET_VALUE = "**********"`; when the operator edits non-credential fields and saves, any leaf still equal to `"**********"` retains its existing server-side encrypted value, and when the operator triggers an MCP connectivity probe, the server recursively merges `"**********"` leaves with decrypted values from `secret_vault` in memory without returning cleartext to the browser.

---

### User Story 2 - Out-of-Band Secrets Proxy, Git Credential Socket & High-Throughput Regex Secret Scrubber (Priority: P1)

As a platform security engineer isolating ephemeral agent containers (`src/orchestrator/security/secrets-proxy.ts`, `src/orchestrator/security/secret-scrubber.ts`, `docs/architecture/security-and-secrets.md` §3–§4), I need an out-of-band Secrets Broker that issues short-lived scoped Git tokens over a local Unix socket helper and substitutes placeholder test API keys (`sk_test_placeholder_*`) in-flight without injecting raw secrets into container `process.env`, paired with a streaming regex + vault-value secret scrubber that replaces leaked credentials with `[REDACTED_SECRET_BY_GRAYWOLF]` across all `terminal.chunk` streams, logs, and PR Review Packets.

**Why this priority**: Prevents agents or rogue tests from exfiltrating credentials via `console.log(process.env)`, stack traces, terminal streams, or git diffs.

**Independent Test**: Can be tested by verifying sanitized container environment maps contain zero raw secrets (only proxy/placeholder tokens), exchanging a short-lived Git credential request and an outbound third-party placeholder header through the Secrets Proxy, and feeding raw terminal chunks containing GitHub PATs, OpenAI keys, AWS keys, private keys, and custom `secret_vault` values through the Secret Scrubber to assert 100% replacement with `[REDACTED_SECRET_BY_GRAYWOLF]`.

**Acceptance Scenarios**:

1. **Given** an ephemeral task container launched for a project with registered secrets in `secret_vault`, **When** the container environment variables are constructed, **Then** zero raw secret values from `secret_vault` appear in `env` (`OPENAI_API_KEY` is set to the internal proxy token `sk-graywolf-internal-proxy-token`), Git credential requests over the local credential helper socket receive short-lived scoped tokens, and outbound HTTP test requests carrying registered placeholder tokens (`sk_test_placeholder_<name>`) have the real secret substituted in-flight and stripped from error responses.
2. **Given** container `stdout`/`stderr` chunks (`terminal.chunk`), structured logs, or PR Review Packet diffs containing either known secret patterns (GitHub PATs `ghp_*` / `github_pat_*`, OpenAI `sk-*`, Anthropic `sk-ant-*`, AWS `AKIA*`, Slack tokens `xox[baprs]-*`, PEM private keys) or exact literal values registered in the workspace's `secret_vault`, **When** processed by the Secret Scrubber before persistence or WebSocket broadcast, **Then** every match is deterministically replaced with `[REDACTED_SECRET_BY_GRAYWOLF]`.

---

### User Story 3 - Sub-2s Package Cache Volume (Tier 1), Debounced Pre-Bake Worker (Tier 2) & Optional OTLP Exporter (Priority: P1)

As a developer running iterative multi-agent tasks (`src/orchestrator/runner/cache.ts`, `src/orchestrator/ServiceOtel.ts`, `docs/architecture/build-cache-and-performance.md`), I need Tier 1 content-addressable package-manager cache volume mounts (`pkg-cache-{project_id}` mapped to `~/.npm`, `~/.local/share/pnpm/store`, `~/.cache/pip`, `~/.cargo/registry`, Go caches, etc.) with post-merge background cache warming, a Tier 2 lockfile watcher that triggers BuildKit pre-baked snapshot image rebuilds only after a 10-minute (`600,000` ms) lockfile quiescence window, and an optional OpenTelemetry (`gen_ai.*`) OTLP trace exporter (`ServiceOtel.ts`) disabled by default for `$0` offline Solo runs.

**Why this priority**: Delivers sub-2-second container cold starts without the native binary corruption or symlink breakage caused by sharing raw `node_modules` or `.venv` directories across containers.

**Independent Test**: Can be tested by resolving Tier 1 volume bind mounts for a project (verifying `pkg-cache-{project_id}` mounts package stores and never mounts `node_modules` or `.venv`), simulating rapid lockfile edits to confirm Tier 2 rebuilds debounce until 10 minutes of quiescence, verifying cold-start readiness completes in `< 2000` ms on a warmed cache, and testing `ServiceOtel` in disabled (no-op, zero network egress) vs enabled OTLP export modes.

**Acceptance Scenarios**:

1. **Given** a project with ID `project_id`, **When** a task sandbox container is configured with Tier 1 caching, **Then** the persistent volume `pkg-cache-{project_id}` is mounted into the container's content-addressable package store paths (`/home/graywolf/.npm`, `/home/graywolf/.local/share/pnpm/store`, `/home/graywolf/.cache/pip`, `/home/graywolf/.cargo/registry`, `/home/graywolf/go/pkg/mod`, etc.) without mounting raw `node_modules` or `.venv`, and when a task branch merges with lockfile updates, a background cache-warming job pre-populates the Tier 1 cache so subsequent task containers achieve `< 2000` ms cold start.
2. **Given** repo-scoped lockfile modifications (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `requirements.txt`, `go.sum`, `Cargo.lock`, etc.), **When** multiple commits modify lockfiles in rapid succession, **Then** the Tier 2 pre-bake scheduler resets its debounce timer on each change and dispatches the BuildKit `--mount=type=cache` snapshot image build only after the lockfile has remained quiescent for `10` minutes (`600,000` ms).
3. **Given** `ServiceOtel.ts` initialized in a Solo/offline environment (`OTEL_EXPORTER_OTLP_ENDPOINT` unset or telemetry disabled), **When** `gen_ai.*` spans are recorded, **Then** it operates as a zero-overhead in-memory/no-op tracer with `0` bytes of external network egress; when explicitly enabled with an OTLP endpoint, it emits standardized `gen_ai.*` spans (model, token usage, task ID, tier) with secrets scrubbed.

---

### User Story 4 - P0 Platform Maturity Exit Benchmark Suite (Priority: P1)

As a release engineer certifying the Graywolf Squad platform for P0 completion (`tests/e2e/p0-maturity-benchmarks.test.ts`, PRD §16), I need an automated end-to-end verification harness that executes and proves all 4 non-negotiable P0 Platform Maturity Exit Criteria: (1) 5 consecutive Brownfield tasks completed with zero deadlocks, zero boundary escapes, and zero git conflicts; (2) 100% Gate Integrity against protected branches and forbidden scopes; (3) `< 2s` (`< 2000` ms) container cold start across repeated runs using the Tier 1 package cache; and (4) Zero External Token Leaks during a 100% offline local Ollama run (`qwen2.5-coder` + `nomic-embed-text`) with `$0.00` ledger cost and `0` bytes of external network egress.

**Why this priority**: Provides the authoritative, repeatable release gate required by `docs/PRD.md` §16 before declaring P0 platform maturity complete.

**Independent Test**: Can be executed directly via `pnpm vitest run tests/e2e/p0-maturity-benchmarks.test.ts` to assert all 4 benchmark suites pass deterministically.

**Acceptance Scenarios**:

1. **Given** a Brownfield repository with `Writable`, `Read-Only`, and `Forbidden` scope boundaries, **When** the benchmark harness executes 5 consecutive Brownfield tasks through the Planner $\rightarrow$ Implementer $\rightarrow$ Reviewer relay pipeline, **Then** all 5 tasks complete with `0` container deadlocks, `0` blast-radius escapes, and `0` git worktree conflicts.
2. **Given** protected branch rules (`main`/`master`) and `Forbidden` / `Read-Only` path scopes, **When** simulated agent diffs or delivery requests attempt to modify a forbidden path or push directly to a protected branch without gate approval, **Then** 100% of unauthorized attempts are blocked (`100%` Gate Integrity).
3. **Given** a warmed Tier 1 `pkg-cache-{project_id}` volume, **When** repeated task containers boot and initialize their dependency environment, **Then** every measured cold-start duration is `< 2000` ms (`< 2` seconds).
4. **Given** a workspace configured in 100% offline local mode (`qwen2.5-coder` + `nomic-embed-text` via local Ollama), **When** a full task lifecycle executes, **Then** total ledger cost is `$0.00` (`0` USD), `0` bytes are transmitted to external commercial LLM endpoints, and `0` plaintext secrets appear in container env or logs.

---

### Edge Cases

- **`~/.graywolf/master.key` exists on disk with overly permissive mode (e.g., `0644` or `0777`)**: The KEK loader automatically tightens permissions to `0600` (`chmod 0600`) or rejects loading if owned by an untrusted user, and tampering with any byte of `encrypted_dek` or `encrypted_value` causes AES-256-GCM authentication tag verification to fail closed.
- **MCP settings update contains a mix of untouched `"**********"` leaves and newly entered secret strings**: Untouched `"**********"` leaves preserve their existing encrypted database records, while newly supplied cleartext strings are freshly envelope-encrypted with a new random DEK.
- **A secret value is split across two adjacent `terminal.chunk` stream buffers or appears URL-encoded**: The Secret Scrubber maintains a sliding window carry-over buffer (or normalizes common encodings) and scrubs both regex pattern matches and registered `secret_vault` literals above minimum length (`>= 6` chars) with `[REDACTED_SECRET_BY_GRAYWOLF]`.
- **Multiple lockfile modifications occur at `t = 0m`, `t = 4m`, and `t = 9m`**: The Tier 2 pre-bake timer resets on each modification and only fires at `t = 19m` (`10` minutes after the last lockfile change at `t = 9m`).
- **Container cold-start benchmark attempts to mount `node_modules` or `.venv` directly**: Rejected by the Tier 1 cache validator to prevent cross-container native binary corruption.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Zero-Prompt KEK & AES-256-GCM Envelope Encryption — Task 16.1a, ADR-013)**: System MUST implement `src/orchestrator/security/kek-vault.ts` auto-generating `~/.graywolf/master.key` (32 random bytes, file mode `0600`) on first boot when no external KMS provider is configured, encrypting per-secret 256-bit Data Encryption Keys (`encrypted_dek`) with the KEK and encrypting secret values (`encrypted_value`) with the DEK using authenticated AES-256-GCM in PostgreSQL `secret_vault` (`workspace_id`, `secret_name`, `encrypted_value`, `encrypted_dek`).
- **FR-002 (MCP Credential Redaction & Server-Side Probe Re-Hydration — Task 16.1b, ADR-055)**: System MUST implement `src/orchestrator/security/mcp-redaction.ts` exporting `REDACTED_MCP_SECRET_VALUE = "**********"`, replacing all credential leaves in MCP configurations sent to the UI with `"**********"`, preserving existing encrypted values when `"**********"` is submitted back during edits, and recursively merging `"**********"` leaves with decrypted server-side secrets in memory before executing MCP connectivity probes.
- **FR-003 (Out-of-Band Secrets Proxy & Scoped Git Credential Helper — Task 16.2a, ADR-018)**: System MUST implement `src/orchestrator/security/secrets-proxy.ts` ensuring zero raw `secret_vault` values are injected into sandbox container environment variables, issuing short-lived scoped Git tokens via a local credential helper endpoint/socket, and substituting registered placeholder tokens (`sk_test_placeholder_<name>`) with decrypted third-party test API keys in-flight while stripping raw secrets from upstream error responses.
- **FR-004 (High-Throughput Regex & Vault-Literal Secret Scrubber — Task 16.2b)**: System MUST implement `src/orchestrator/security/secret-scrubber.ts` scrubbing all container `stdout`/`stderr` chunks (`terminal.chunk`), logs, and PR Review Packets against both standard credential regex signatures (GitHub PATs, OpenAI/Anthropic keys, AWS keys, Slack tokens, PEM private keys, Bearer tokens) and registered `secret_vault` values, replacing every match with `[REDACTED_SECRET_BY_GRAYWOLF]`.
- **FR-005 (Tier 1 Content-Addressable Package Cache & Tier 2 10m Debounced Pre-Bake — Task 16.3a)**: System MUST implement `src/orchestrator/runner/cache.ts` mounting the persistent volume `pkg-cache-{project_id}` into language-specific content-addressable cache directories (`~/.npm`, `~/.local/share/pnpm/store`, `~/.cache/pip`, `~/.cargo/registry`, Go caches, etc. — never raw `node_modules` or `.venv`), triggering post-merge background cache warming, and debouncing Tier 2 BuildKit snapshot image rebuilds behind a `10`-minute (`600,000` ms) lockfile quiescence window.
- **FR-006 (Opt-In OpenTelemetry `gen_ai.*` Exporter — Task 16.3b)**: System MUST implement `src/orchestrator/ServiceOtel.ts` providing an OpenTelemetry (`gen_ai.*`) trace exporter that defaults to disabled (`0` network egress, `$0` cost for Solo/offline runs) and, when enabled via configuration, exports scrubbed `gen_ai.*` spans capturing task, tier, model alias, latency, and token metrics.
- **FR-007 (Automated P0 Platform Maturity Exit Benchmark Suite — Task 16.4, PRD §16)**: System MUST implement `tests/e2e/p0-maturity-benchmarks.test.ts` verifying all 4 P0 exit criteria: (1) 5 consecutive Brownfield tasks completed with zero deadlocks, zero boundary escapes, and zero git conflicts; (2) 100% Gate Integrity; (3) `< 2000` ms container cold start on warmed Tier 1 cache; and (4) Zero External Token Leaks (`$0.00` ledger cost and `0` bytes external egress) on a 100% offline local Ollama run (`qwen2.5-coder` + `nomic-embed-text`).

### Key Entities

- **Envelope-Encrypted Secret Record (`SecretVaultEntry`)**: Row in `secret_vault` (`id`, `workspace_id`, `secret_name`, `encrypted_value` BYTEA containing AES-256-GCM IV + authTag + ciphertext, `encrypted_dek` BYTEA containing KEK-wrapped DEK, `created_at`, `updated_at`).
- **Key Encryption Key Provider (`KekProvider`)**: Pluggable interface supporting `LocalFileKekProvider` (`~/.graywolf/master.key`, `0600`) and external KMS providers (`Vault`, `AWS KMS`, `GCP KMS`).
- **Tier 1 & Tier 2 Package Cache Descriptor (`ProjectPackageCacheConfig`)**: Mapping of `pkg-cache-{project_id}` volume mounts per detected language ecosystem plus Tier 2 lockfile watcher state (`lastLockfileModifiedAt`, `quiescenceMs: 600000`, `snapshotImageTag`).
- **P0 Maturity Benchmark Report (`P0ExitBenchmarkSummary`)**: Structured verification result capturing the 4 PRD §16 exit metrics (`consecutiveBrownfieldTasksPassed: 5`, `gateIntegrityRate: 1.0`, `maxWarmColdStartMs < 2000`, `offlineExternalEgressBytes: 0`, `offlineLedgerCostUsd: 0`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (100% Envelope Encryption & Zero Cleartext UI/DB Exposure)**: 100% of secrets stored in `secret_vault` use unique per-secret DEKs wrapped by the KEK (`~/.graywolf/master.key` with `0600` permissions), and 100% of MCP credential leaves returned to the UI are masked as `"**********"` (`REDACTED_MCP_SECRET_VALUE`).
- **SC-002 (Zero Container Env Secret Leaks & 100% Stream Redaction)**: 0 raw secrets from `secret_vault` are injected into container `process.env`, and 100% of synthetic and vault-registered secrets emitted in `terminal.chunk` streams, logs, or PR packets are replaced with `[REDACTED_SECRET_BY_GRAYWOLF]`.
- **SC-003 (Sub-2s Warmed Container Cold Start & 10-Minute Lockfile Debounce)**: Warmed Tier 1 package cache runs achieve `< 2000` ms container startup time across repeated runs, and Tier 2 snapshot rebuilds trigger 0 times before 10 minutes (`600,000` ms) of lockfile quiescence have elapsed.
- **SC-004 (100% P0 Exit Benchmark Pass Rate)**: All 4 P0 Platform Maturity Exit Criteria in `tests/e2e/p0-maturity-benchmarks.test.ts` (5 consecutive Brownfield tasks, 100% Gate Integrity, `< 2s` cold start, and `$0.00` / `0`-byte external egress offline Ollama run) pass with 0 failures.

## Assumptions

- AES-256-GCM envelope encryption encodes `encrypted_value` and `encrypted_dek` as self-contained binary payloads (`[12-byte IV][16-byte AuthTag][Ciphertext]`) stored in the `BYTEA` columns of `secret_vault` defined in `migrations/1789444040216_create-tasks-table.js`.
- For unit and E2E benchmark execution in CI/local environments without a live Docker daemon or external network, `cache.ts`, `secrets-proxy.ts`, and `p0-maturity-benchmarks.test.ts` support deterministic in-process execution and clock injection while exercising the real orchestrator security, cache, gate, and offline routing modules.


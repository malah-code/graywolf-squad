# Phase 0 Research: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

## 1. Version-Prefixed AES-256-GCM Envelope Binary Format (`FR-001`)

- **Decision**: Encode both `encrypted_dek` and `encrypted_value` in `secret_vault` as self-contained binary buffers:
  `Buffer.concat([Buffer.from([0x01]), iv (12 bytes), authTag (16 bytes), ciphertext])`.
  - For `encrypted_dek`: a fresh 32-byte random DEK (`crypto.randomBytes(32)`) is encrypted under the 32-byte KEK using `aes-256-gcm`, yielding a 61-byte `Buffer` (`1 + 12 + 16 + 32`).
  - For `encrypted_value`: the UTF-8 secret cleartext is encrypted under the 32-byte DEK using `aes-256-gcm` with workspace/secret AAD (`${workspaceId}:${secretName}`), yielding `29 + ciphertext.length` bytes.
- **Rationale**: Fits directly into the existing `encrypted_value BYTEA NOT NULL` and `encrypted_dek BYTEA NOT NULL` columns in `migrations/1789444040216_create-tasks-table.js` without requiring additional IV or auth-tag columns, while binding each secret to its `(workspace_id, secret_name)` via GCM Additional Authenticated Data (AAD) so cross-row/cross-tenant ciphertext swapping fails closed.
- **Alternatives considered**: Separate `iv` and `auth_tag` columns (requires schema migration) or `pgcrypto` SQL-side `pgp_sym_encrypt` (exposes DEK or cleartext in SQL query parameters).

## 2. ADR-055 MCP Credential Redaction & Recursive Probe Re-Hydration (`FR-002`)

- **Decision**: Export `REDACTED_MCP_SECRET_VALUE = "**********"`. Identify secret leaves by matching object keys against `/(?:api[_-]?key|token|secret|password|auth(?:orization)?|credential|private[_-]?key)/i` or explicit key paths in `secretRefs`.
  - `redactMcpConfigForUi(config, secretRefs)`: Deep-clones `config` and replaces every non-empty string at a sensitive key path with `"**********"`.
  - `mergeMcpConfigOnUpdate(existingEncryptedConfig, incomingUiConfig, vault, workspaceId, secretRefs)`: Recursively walks `incomingUiConfig`; if a sensitive leaf equals `"**********"`, keeps the existing `secret_vault` reference/ciphertext; if a new non-redacted string is provided, encrypts and stores it in `secret_vault`.
  - `rehydrateMcpConfigForProbe(configWithPlaceholders, storedSecretMap)`: Deep-clones the config in memory and replaces `"**********"` leaves with decrypted secret values strictly for the duration of the server-side connectivity probe.
- **Rationale**: Implements ADR-055 (`@openhands/agent-canvas` MIT pattern) so cleartext MCP credentials never travel back to the browser after initial save while connectivity probes still test real credentials.
- **Alternatives considered**: Returning boolean `hasSecret` flags (breaks JSON schema shape expected by dynamic settings forms).

## 3. Out-of-Band Secrets Proxy & Streaming Secret Scrubber (`FR-003`, `FR-004`)

- **Decision**:
  - `buildSanitizedContainerEnv`: Strips any key matching `secret_vault` secret names or raw provider keys and injects only `OPENAI_BASE_URL: 'http://litellm-proxy:4000'`, `OPENAI_API_KEY: 'sk-graywolf-internal-proxy-token'`, and `GRAYWOLF_SECRETS_SOCKET: '/var/run/graywolf/secrets.sock'`.
  - `SecretsBrokerProxy`: Issues ephemeral task-scoped Git credentials (`ttlSeconds: 300`) when queried via Git's `credential.helper` `get` protocol, and rewrites outbound HTTP test requests carrying `sk_test_placeholder_<secret_name>` or `X-Graywolf-Secret-Placeholder` by substituting the decrypted secret on egress and scrubbing the secret from response headers/bodies.
  - `SecretScrubber`: Matches both high-entropy/known token regexes (`ghp_`, `github_pat_`, `glpat-`, `sk-`, `sk-ant-`, `AKIA`, `xox[baprs]-`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`) and exact literal secrets registered in `secret_vault` (`length >= 6`), replacing every occurrence with `[REDACTED_SECRET_BY_GRAYWOLF]`. Includes a stateful stream wrapper (`createStreamingSecretScrubber`) that holds a sliding tail carry-over buffer to catch secrets split across adjacent `terminal.chunk` frames.
- **Rationale**: Fulfills `docs/architecture/security-and-secrets.md` §§3–4 with zero environment exposure and defense-in-depth stream redaction.
- **Alternatives considered**: Regex-only scrubbing without vault-literal registration (misses custom non-prefixed secrets stored in `secret_vault`).

## 4. Two-Tier Package Cache (`pkg-cache-{project_id}`) & 10-Minute Lockfile Debounce (`FR-005`, `FR-006`)

- **Decision**:
  - **Tier 1 (`resolveTier1CacheMounts`)**: Maps `pkg-cache-{project_id}` subdirectories to `/home/graywolf/.npm`, `/home/graywolf/.local/share/pnpm/store`, `/home/graywolf/.cache/pip`, `/home/graywolf/.cache/uv`, `/home/graywolf/.cache/go-build`, `/home/graywolf/go/pkg/mod`, `/home/graywolf/.cargo/registry`, `/home/graywolf/.cargo/git`, `/home/graywolf/.m2/repository`, `/home/graywolf/.gradle/caches`, `/home/graywolf/.nuget/packages`, and `/home/graywolf/.cache/composer`. Explicitly rejects any mount targeting `node_modules` or `.venv`.
  - **Tier 2 (`Tier2PreBakeScheduler`)**: Tracks lockfile modifications per project with a `600,000` ms (`10`-minute) quiescence window (backed by Valkey key `cache:debounce:{project_id}` TTL `600`s and injectable clock), resetting the timer on each lockfile commit and generating the BuildKit `--mount=type=cache` snapshot build descriptor only after full quiescence.
  - **`ServiceOtel.ts`**: Disabled by default (`enabled: false`, `0` network egress); when enabled, records and exports `gen_ai.*` spans with `SecretScrubber` applied to span attributes.
- **Rationale**: Matches `docs/architecture/build-cache-and-performance.md` §§2–5 and achieves `< 2000` ms warm container cold starts.
- **Alternatives considered**: Rebuilding Docker images on every `package.json` commit (causes rebuild storms during active branches).


# Phase 1 Data Model: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

## 1. Envelope-Encrypted Secret Record (`secret_vault` — Task 16.1a)

| Column | PostgreSQL Type | Binary / Format Constraint |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | Generated UUID |
| `workspace_id` | `UUID NOT NULL` | Foreign key to `workspaces(id)`, RLS isolated |
| `secret_name` | `VARCHAR(128) NOT NULL` | Unique per `(workspace_id, secret_name)` |
| `encrypted_value` | `BYTEA NOT NULL` | `[0x01 (1B)][IV (12B)][GCM Tag (16B)][Ciphertext]` encrypted with per-secret DEK & AAD `${workspace_id}:${secret_name}` |
| `encrypted_dek` | `BYTEA NOT NULL` | `[0x01 (1B)][IV (12B)][GCM Tag (16B)][32B DEK Ciphertext]` (61 bytes) encrypted with Master KEK |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | Last rotation/update timestamp |

## 2. MCP Credential Redaction Model (`mcp_servers` — Task 16.1b, ADR-055)

- **Constant**: `REDACTED_MCP_SECRET_VALUE = "**********"`
- **Sensitive Key Pattern**: `/(?:api[_-]?key|token|secret|password|auth(?:orization)?|credential|private[_-]?key)/i` OR explicit key paths in `secret_refs: string[]`.
- **State Transitions**:
  1. **Save (New Secret)**: UI sends cleartext string $\rightarrow$ Server encrypts into `secret_vault` $\rightarrow$ UI receives `"**********"`.
  2. **Save (Untouched Secret)**: UI sends `"**********"` $\rightarrow$ Server preserves existing `secret_vault` encrypted entry untouched.
  3. **Connectivity Probe**: Server clones config in memory $\rightarrow$ replaces `"**********"` leaves with decrypted `secret_vault` values $\rightarrow$ executes probe $\rightarrow$ discards cleartext clone.

## 3. Out-of-Band Secrets Proxy & Scrubber Entities (Task 16.2)

- **`ScopedGitCredentialGrant`**:
  - `token`: `string` (`gw_git_<randomHex>`)
  - `workspaceId`: `string`
  - `taskId`: `string`
  - `repoPath`: `string`
  - `expiresAtMs`: `number` (`issuedAtMs + 300_000` — 5-minute TTL)
- **`ReplacementToken`**: `"[REDACTED_SECRET_BY_GRAYWOLF]"`

## 4. Tier 1 & Tier 2 Package Cache Model (Task 16.3)

| Ecosystem | Lockfiles Watched (Tier 2) | Volume Subpath (`pkg-cache-{project_id}/...`) | Container Mount Target |
|---|---|---|---|
| `npm` | `package-lock.json` | `npm` | `/home/graywolf/.npm` |
| `pnpm` | `pnpm-lock.yaml` | `pnpm-store` | `/home/graywolf/.local/share/pnpm/store` |
| `pip` / `uv` | `requirements.txt`, `poetry.lock`, `Pipfile.lock` | `pip`, `uv` | `/home/graywolf/.cache/pip`, `/home/graywolf/.cache/uv` |
| `go` | `go.mod`, `go.sum` | `go-build`, `go-mod` | `/home/graywolf/.cache/go-build`, `/home/graywolf/go/pkg/mod` |
| `cargo` | `Cargo.lock` | `cargo-registry`, `cargo-git` | `/home/graywolf/.cargo/registry`, `/home/graywolf/.cargo/git` |
| `maven` / `gradle` | `pom.xml`, `gradle.lockfile` | `maven`, `gradle` | `/home/graywolf/.m2/repository`, `/home/graywolf/.gradle/caches` |
| `nuget` | `packages.lock.json` | `nuget` | `/home/graywolf/.nuget/packages` |
| `composer` | `composer.lock` | `composer` | `/home/graywolf/.cache/composer` |

## 5. P0 Maturity Exit Benchmark Summary (`P0ExitBenchmarkSummary` — Task 16.4)

```ts
export interface P0ExitBenchmarkSummary {
  brownfieldConsecutiveTasksCompleted: number; // Must be 5
  containerDeadlocks: number;                  // Must be 0
  boundaryEscapes: number;                     // Must be 0
  gitConflicts: number;                        // Must be 0
  gateIntegrityRate: number;                   // Must be 1.0 (100%)
  warmColdStartDurationsMs: number[];          // Every entry must be < 2000
  offlineRunLedgerCostUsd: number;             // Must be 0
  offlineRunExternalEgressBytes: number;       // Must be 0
  offlineRunPlaintextSecretLeaks: number;      // Must be 0
  allPassed: boolean;                          // Must be true
}
```


# Data Model: Software Factory & Pluggable `@graywolf/addon-sdk`

**Feature**: `specs/002-addon-sdk`  
**Canonical Schema Source**: `specs/002-addon-sdk/addon-interfaces.ts` & `migrations/1789444040216_create-tasks-table.js`

---

## 1. `GraywolfSignalEnvelope` (TypeBox Schema)

Normalized inbound signal produced by every `SignalAddon`:

| Field | Type / Constraint | Required | Description |
|:---|:---|:---|:---|
| `id` | `string` (`format: 'uuid'`) | Yes | Globally unique signal ID |
| `source` | `string` (`minLength: 1`) | Yes | Originating addon package name (e.g. `'@graywolf/addon-sentry'`) |
| `kind` | `'crash' \| 'bug-report' \| 'feature' \| 'community' \| 'custom'` | Yes | Signal classification |
| `title` | `string` (`minLength: 1`, `maxLength: 200`) | Yes | Human-readable title surfaced in Kanban and Cockpit triage card |
| `description` | `string` (`maxLength: 4096`) | Yes | Extended description in Markdown (max 4 KB) |
| `links` | `Array<{ label: string; url: string (format: 'uri') }>` (`maxItems: 10`) | Yes | Structured links back to originating upstream system |
| `severity` | `'critical' \| 'high' \| 'medium' \| 'low' \| 'unknown'` | Yes | Upstream severity hint |
| `occurredAt` | `string` (`format: 'date-time'`) | Yes | ISO-8601 timestamp when upstream event occurred |
| `ingestedAt` | `string` (`format: 'date-time'`) | Yes | ISO-8601 timestamp when Graywolf ingested the signal |
| `raw` | `string` (`maxLength: 65536`) | No | Optional unmodified webhook payload (truncated to `<= 65536` chars; never passed to LLM context) |
| `meta` | `Record<string, string \| number \| boolean \| null>` | No | Optional scalar metadata bag (e.g. `fingerprint`, `issueNumber`, `environment`) |

---

## 2. Valkey Signal Deduplication Key (ADR-044)

- **Key Pattern**: `signal:{workspaceId}:{fingerprintHash}`
- **Fingerprint Formula**:
  - `fingerprintHash = SHA-256("${envelope.source}|${envelope.kind}|${normalizedTitle}|${upstreamKey}")`
  - `normalizedTitle`: `envelope.title.toLowerCase()` with ISO timestamps, hex strings, and standalone digits stripped and whitespace collapsed.
  - `upstreamKey`: `String(envelope.meta?.fingerprint ?? envelope.links[0]?.url ?? '')`.
- **Value**: `signalId` (`envelope.id`)
- **TTL**: `cooldownSeconds` (default `180` seconds)

---

## 3. `AddonManifest` & `InstalledAddonEntry` (`.agents/project.config.json`)

| Field | Type / Constraint | Required | Description |
|:---|:---|:---|:---|
| `maxSignalAddons` | `integer` (`minimum: 0`, `maximum: 3`, default `3`) | No | Topology A maximum `SignalAddon` slots |
| `maxCockpitAddons` | `integer` (`minimum: 0`, `maximum: 1`, default `1`) | No | Topology A maximum `CockpitAddon` slots |
| `installed[].package` | `string` (`minLength: 1`) | Yes | NPM package identifier |
| `installed[].type` | `'signal' \| 'cockpit'` | Yes | Determines permitted `GraywolfRelayContext` methods |
| `installed[].tier` | `'official' \| 'community'` | Yes | `'official'` (`@graywolf/*`) vs Tier 2 `'community'` |
| `installed[].shadowState` | `'shadow' \| 'graduated' \| 'deprecated'` | Yes | Current Shadow Mode lifecycle state |
| `installed[].shadowRunCount` | `integer` (`minimum: 0`, default `0`) | No | Total recorded shadow runs |
| `installed[].shadowDiscardRate` | `number` (`minimum: 0`, `maximum: 1`, default `0`) | No | Ratio `discardedShadowCount / shadowRunCount` |
| `installed[].contentHash` | `string` (`pattern: '^[0-9a-f]{64}$'`) | Conditional | Required when `tier === 'community'`; SHA-256 hex digest of addon bundle |
| `installed[].approvedAt` | `string` (`format: 'date-time'`) | Conditional | Required when `tier === 'community'`; ISO-8601 lead developer approval timestamp |
| `installed[].approvedBy` | `string` | No | Approving user ID or handle |

---

## 4. Shadow Mode State Machine (`AddonShadowLifecycle`)

```text
[New Addon Registered]
         │
         ▼
     "shadow"  (Audit-log only; no Kanban task write)
         │
         │  Requires ALL of:
         │  1. shadowRunCount >= 20
         │  2. shadowDiscardRate < 0.10 (discardedShadowCount / shadowRunCount < 0.10)
         │  3. Explicit promotion by 'lead_dev' or 'owner'
         ▼
    "graduated" (Live Kanban triage task creation enabled)
         │
         │  Triggered automatically when:
         │  consecutivePostGradDiscards >= 5
         ▼
   "deprecated" (Disabled; no Kanban writes; audit log archived)
```

---

## 5. External Identity Binding (`workspace_member_identities` Table — Table #6)

 Defined in `migrations/1789444040216_create-tasks-table.js` (lines 70–78):

| Column | SQL Type | Constraint | Description |
|:---|:---|:---|:---|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Row ID |
| `workspace_id` | `UUID` | `NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Tenant workspace ID |
| `user_id` | `UUID` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Linked internal Graywolf user ID |
| `provider` | `VARCHAR(32)` | `NOT NULL` | Platform identifier (`'discord' \| 'slack' \| 'msteams' \| 'custom'`) |
| `external_provider_user_id` | `VARCHAR(255)` | `NOT NULL` | External user ID (`actorExternalId`) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Creation timestamp |

- **Unique Constraint**: `UNIQUE(workspace_id, provider, external_provider_user_id)`
- **Lookup Failure Behavior**: Throws `GraywolfAppError('ADDON_UNLINKED_EXTERNAL_USER')` (HTTP 403).


# Research: Software Factory & Pluggable `@graywolf/addon-sdk`

**Feature**: `specs/002-addon-sdk`  
**Phase**: 15 (`docs/implementation-plan-detailed.md` Tasks 15.1–15.3)  
**ADRs Referenced**: ADR-018, ADR-025, ADR-038, ADR-039, ADR-042, ADR-044, ADR-080

---

## 1. Capability-Scoped `GraywolfRelayContext` & Secret Isolation (ADR-080)

- **Decision**: Construct two distinct runtime proxy implementations of `GraywolfRelayContext` (`createSignalRelayContext` and `createCockpitRelayContext`) inside `src/orchestrator/addons/sdk.ts`.
  - `SignalAddon` contexts implement `submitSignal` and `scheduleRepeatableJob`, while `postTaskBrief`, `postEscalation`, and `receiveHumanIntent` throw `new GraywolfAppError('RBAC_INSUFFICIENT_ROLE', ..., { addonName, capability, reason: 'ADDON_FORBIDDEN_CAPABILITY' })` (HTTP 403).
  - `CockpitAddon` contexts implement `postTaskBrief`, `postEscalation`, and `receiveHumanIntent`, while `submitSignal` and `scheduleRepeatableJob` throw `new GraywolfAppError('RBAC_INSUFFICIENT_ROLE', ..., { addonName, capability, reason: 'ADDON_FORBIDDEN_CAPABILITY' })` (HTTP 403).
  - Both contexts validate `readSecret(key)` against `new Set(meta.requiredSecrets)` before calling the secret reader; undeclared keys immediately throw `GraywolfAppError('RBAC_INSUFFICIENT_ROLE')` with `reason: 'ADDON_FORBIDDEN_CAPABILITY'`.
  - Neither context exposes `executeCommand` or worktree file I/O.
- **Rationale**: Enforces least-privilege separation at the TypeScript and runtime boundary while preserving the closed 41-code `ERROR_CODES` enum in `src/orchestrator/errors/taxonomy.ts`.
- **Alternatives Considered**: Relying solely on TypeScript compile-time interface narrowing (rejected because community Tier 2 JavaScript plugins or untyped calls could bypass compile-time checks).

---

## 2. Crash-Storm Webhook Deduplication via Valkey (ADR-044)

- **Decision**: Compute a deterministic SHA-256 fingerprint for every `GraywolfSignalEnvelope` inside `submitSignal(envelope)`:
  - `fingerprintHash = SHA-256("${envelope.source}|${envelope.kind}|${normalizedTitle}|${upstreamKey}")`
  - `normalizedTitle` lowercases `envelope.title`, strips ISO timestamps, hex addresses, and standalone integers, and collapses whitespace.
  - `upstreamKey` resolves `String(envelope.meta?.fingerprint ?? envelope.links[0]?.url ?? '')`.
  - Check Valkey key `signal:{workspaceId}:{fingerprintHash}`. If present, return the existing `signalId` with `deduplicated: true` without invoking Kanban or shadow-log persistence. Otherwise store the new `signalId` at `signal:{workspaceId}:{fingerprintHash}` with TTL `cooldownSeconds` (default `180` seconds).
- **Rationale**: Prevents Sentry crash storms or webhook retry floods from creating hundreds of duplicate Kanban triage cards within a 3-minute window.
- **Alternatives Considered**: Deduplicating in PostgreSQL via unique index (rejected because high-rate crash storms would cause unnecessary ACID write pressure on PostgreSQL).

---

## 3. `<untrusted_signal_payload>` XML Wrapping & Prompt-Injection Sanitization (ADR-025, ADR-038)

- **Decision**: Implement `sanitizeUntrustedSignalText` and `sanitizeSignalEnvelopeForPrompt` in `src/orchestrator/addons/sanitization.ts`:
  - Strip or neutralize embedded `<untrusted_signal_payload>` / `</untrusted_signal_payload>` tags so an attacker cannot close the XML jail early.
  - Redact known prompt-injection control sequences (`IGNORE PREVIOUS INSTRUCTIONS`, `DISREGARD ALL PRIOR`, `<|im_start|>`, `<|im_end|>`, `[SYSTEM]`, `### SYSTEM:`) to `[REDACTED_INJECTION_MARKER]`.
  - Wrap the sanitized envelope payload inside `<untrusted_signal_payload source="..." signal_id="..." kind="...">...</untrusted_signal_payload>`.
- **Rationale**: External issue descriptions, Sentry exception messages, and Discord chat messages are untrusted external inputs; structural XML tagging + boundary-escape stripping aligns with `<untrusted_browser_observation>` from Phase 9 (ADR-077).
- **Alternatives Considered**: Rejecting issues that contain code snippets or brackets (rejected because legitimate bug reports frequently contain HTML/XML/code).

---

## 4. Two-Tier Trust Registry, Shadow Mode Graduation & External Identity Binding (ADR-080, PRD §17)

- **Decision**:
  - **Topology A Slot Caps**: `maxSignalAddons` (default `3`, max `3`) and `maxCockpitAddons` (default `1`, max `1`). Exceeding either throws `GraywolfAppError('ADDON_SLOT_LIMIT_EXCEEDED')` (HTTP 429).
  - **Tier 2 Content-Hash Lock**: Official (`tier: 'official'`) `@graywolf/*` addons are trusted first-party code; community (`tier: 'community'`) addons MUST specify `contentHash` (`^[0-9a-f]{64}$`) and `approvedAt` in `.agents/project.config.json`, and their SHA-256 bundle hash MUST match at boot—otherwise throw `GraywolfAppError('ADDON_HASH_MISMATCH')` (HTTP 403 fail-closed).
  - **Shadow Mode Lifecycle**: All newly registered addons start in `shadowState: 'shadow'` (writing signals only to the shadow audit log). Promotion to `'graduated'` requires `shadowRunCount >= 20`, `shadowDiscardRate = discardedShadowCount / shadowRunCount < 0.10`, and an explicit `'lead_dev'` or `'owner'` promotion call. Once `'graduated'`, `5` consecutive operator discards (`consecutivePostGradDiscards >= 5`) automatically transition the addon to `'deprecated'`.
  - **External Identity Binding**: `receiveHumanIntent` queries `workspace_member_identities` by `(workspace_id, provider, external_provider_user_id)`; unlinked external users fail closed with `GraywolfAppError('ADDON_UNLINKED_EXTERNAL_USER')` (HTTP 403).
- **Rationale**: Satisfies ADR-080 supply-chain, resource-cap, noise-gate, and RBAC identity invariants.
- **Alternatives Considered**: Allowing `developer` role to graduate shadow addons (rejected per PRD §17 which reserves graduation approval for `lead_dev` / `owner`).

---

## 5. First-Party Reference Addons Without Heavy Vendor SDKs (Task 15.3)

- **Decision**: Implement `@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, and `@graywolf/addon-discord-cockpit` as lightweight Fastify plugins using Node's built-in `node:crypto` (`createHmac('sha256', secret)` + `timingSafeEqual`) and TypeBox (`@sinclair/typebox/value`), with zero `@sentry/node` imports and zero `setInterval`/`setTimeout` timers.
- **Rationale**: Keeps orchestrator memory footprint minimal, adheres to Constitution Principle 9 ($0 open-source baseline), and prevents background timer leaks inside Fastify plugins.
- **Alternatives Considered**: Importing `@sentry/node` or `@octokit/webhooks` (rejected per Task 15.3 explicit ban on `@sentry/node` and heavy external SDKs).


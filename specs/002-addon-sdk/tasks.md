# Tasks: Software Factory & Pluggable `@graywolf/addon-sdk`

**Input**: Design documents from `/specs/002-addon-sdk/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `addon-interfaces.ts`, `research.md`, `data-model.md`, `contracts/addon-sdk.md`, `quickstart.md`

**Tests**: Included as required by `docs/implementation-plan-detailed.md` Phase 15 (`tests/unit/addon-sdk.test.ts`, `tests/unit/addon-registry-shadow-identity.test.ts`, `tests/integration/addons-builtin.test.ts`).

**Organization**: Tasks are grouped by user story (`US1` $\rightarrow$ Task 15.1, `US2` $\rightarrow$ Task 15.2, `US3` $\rightarrow$ Task 15.3) with every TypeBox constraint, Valkey key format, SQL column name, and ADR-042 error code quoted verbatim.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Scoped `@graywolf/addon-sdk` Relay Context, Valkey Deduplication & Untrusted Signal Sanitization (Priority: P1 — Master Plan Task 15.1) 🎯 MVP

**Goal**: Implement `src/orchestrator/addons/sdk.ts` and `src/orchestrator/addons/sanitization.ts` providing the capability-scoped `GraywolfRelayContext`, Valkey crash-storm deduplication (`signal:{workspaceId}:{fingerprintHash}` with 180s TTL), and `<untrusted_signal_payload>` XML prompt-injection sanitization.

**Independent Test**: Run `pnpm vitest run tests/unit/addon-sdk.test.ts` to verify cross-role capability rejection (`RBAC_INSUFFICIENT_ROLE`), undeclared `readSecret()` rejection, 180s Valkey signal deduplication, and `<untrusted_signal_payload>` XML wrapping with injection marker stripping.

### Implementation & Tests for User Story 1 (Master Plan Task 15.1)

- [x] T001 [P] [US1] Implement `sanitizeUntrustedSignalText` and `sanitizeSignalEnvelopeForPrompt` in `src/orchestrator/addons/sanitization.ts` stripping embedded `<untrusted_signal_payload>` / `</untrusted_signal_payload>` boundary breakouts and prompt-injection directives (`IGNORE PREVIOUS INSTRUCTIONS`, `DISREGARD ALL PRIOR`, `<|im_start|>`, `<|im_end|>`, `[SYSTEM]`, `### SYSTEM:`), truncating `title` (`maxLength: 200`), `description` (`maxLength: 4096`), and `raw` (`maxLength: 65536`), and wrapping untrusted fields (`title`, `description`, and string values in `meta`) inside `<untrusted_signal_payload source="..." signal_id="..." kind="...">...</untrusted_signal_payload>`
- [x] T002 [P] [US1] Implement `computeSignalFingerprint` and `createScopedRelayContext` in `src/orchestrator/addons/sdk.ts` re-exporting canonical TypeBox contracts from `specs/002-addon-sdk/addon-interfaces.ts` (`GraywolfSignalEnvelope` with `id` UUID, `source` `minLength: 1`, `kind`: `'crash' | 'bug-report' | 'feature' | 'community' | 'custom'`, `title` `1..200` chars, `description` `<= 4096` chars, `links` `maxItems: 10`, `severity`: `'critical' | 'high' | 'medium' | 'low' | 'unknown'`, `occurredAt`, `ingestedAt`, optional `raw` `<= 65536` chars, optional scalar `meta`), computing `fingerprintHash = SHA-256("${source}|${kind}|${normalizedTitle}|${upstreamKey}")` (where `upstreamKey` is `String(envelope.meta?.fingerprint ?? envelope.links[0]?.url ?? '')`), deduplicating in `submitSignal` via Valkey key `signal:{workspaceId}:{fingerprintHash}` (default `cooldownSeconds: 180`), and throwing `GraywolfAppError('RBAC_INSUFFICIENT_ROLE')` (HTTP 403, `details.reason: 'ADDON_FORBIDDEN_CAPABILITY'`) on cross-role calls (`SignalAddon` calling `postTaskBrief`/`postEscalation`/`receiveHumanIntent` or `CockpitAddon` calling `submitSignal`/`scheduleRepeatableJob`) or undeclared `readSecret(key)` calls
- [x] T003 [US1] Create unit test suite in `tests/unit/addon-sdk.test.ts` testing `SignalAddon` vs `CockpitAddon` method isolation (`RBAC_INSUFFICIENT_ROLE` 403), undeclared `readSecret(key)` rejection, `submitSignal` Valkey deduplication within the 180s cooldown window vs expiry, TypeBox validation of `GraywolfSignalEnvelope`, and `sanitizeSignalEnvelopeForPrompt` against `</untrusted_signal_payload>` tag escapes and prompt-injection strings

**Checkpoint**: User Story 1 (Task 15.1) is complete and independently verified via `tests/unit/addon-sdk.test.ts`.

---

## Phase 2: User Story 2 - Two-Tier Addon Registry, Shadow Mode Graduation Lifecycle & External Identity Binding (Priority: P1 — Master Plan Task 15.2)

**Goal**: Implement `src/orchestrator/addons/registry.ts`, `src/orchestrator/addons/shadow-lifecycle.ts`, and `src/orchestrator/addons/identity-binding.ts` enforcing Topology A slot caps (`3 Signal + 1 Cockpit`), Tier 2 SHA-256 `contentHash` fail-closed verification, Shadow Mode graduation (`>= 20` runs, `< 10%` discard rate, `lead_dev`/`owner` promotion, `5` consecutive post-graduation discards auto-deprecation), and External Identity Binding (`workspace_member_identities`).

**Independent Test**: Run `pnpm vitest run tests/unit/addon-registry-shadow-identity.test.ts` to verify slot limit enforcement (`ADDON_SLOT_LIMIT_EXCEEDED` 429), Tier 2 hash mismatch rejection (`ADDON_HASH_MISMATCH` 403), banned timer/SDK rejection, Shadow Mode state transitions, and unlinked external user rejection (`ADDON_UNLINKED_EXTERNAL_USER` 403).

### Implementation & Tests for User Story 2 (Master Plan Task 15.2)

- [x] T004 [P] [US2] Implement `ShadowLifecycleManager` in `src/orchestrator/addons/shadow-lifecycle.ts` initializing newly registered addons in `shadowState: 'shadow'` (recording signals in `auditLog` with `forwardedToKanban: false`), computing `shadowDiscardRate = discardedShadowCount / shadowRunCount`, enforcing promotion to `'graduated'` only when `shadowRunCount >= 20` AND `shadowDiscardRate < 0.10` AND `actorRole` is `'lead_dev' | 'owner'` (throwing `GraywolfAppError('RBAC_INSUFFICIENT_ROLE')` 403 for `'developer' | 'viewer'`), forwarding `'graduated'` signals (`forwardedToKanban: true`), and automatically transitioning `'graduated'` to `'deprecated'` when `consecutivePostGradDiscards >= 5`
- [x] T005 [P] [US2] Implement `parseHumanIntentText` and `resolveAndVerifyExternalIdentity` in `src/orchestrator/addons/identity-binding.ts` querying PostgreSQL `workspace_member_identities` (`workspace_id`, `provider`, `external_provider_user_id` -> `user_id`) via `withTenantContext` (or injectable `lookupOverride`), throwing `GraywolfAppError('ADDON_UNLINKED_EXTERNAL_USER')` (HTTP 403) when unlinked, extracting `taskId` via `/\b(TASK-[0-9A-Z-]+)\b/i`, and classifying `intentText` into `'approve' | 'reject' | 'escalate' | 'unknown'`
- [x] T006 [US2] Implement `computeAddonBundleHash`, `assertNoBannedAddonPatterns`, and `AddonRegistry` in `src/orchestrator/addons/registry.ts` enforcing Topology A slot limits (`maxSignalAddons: 3`, `maxCockpitAddons: 1` -> throwing `GraywolfAppError('ADDON_SLOT_LIMIT_EXCEEDED')` HTTP 429), verifying Tier 2 (`tier === 'community'`) `contentHash` (`^[0-9a-f]{64}$`) and `approvedAt` against SHA-256 bundle digest at registration/boot (throwing `GraywolfAppError('ADDON_HASH_MISMATCH')` HTTP 403 fail-closed on mismatch or missing fields), rejecting addons containing `@sentry/node`, `setInterval(`, or `setTimeout(`, and mounting registered Fastify plugins
- [x] T007 [US2] Create unit test suite in `tests/unit/addon-registry-shadow-identity.test.ts` testing Topology A `3 Signal + 1 Cockpit` slot caps (`ADDON_SLOT_LIMIT_EXCEEDED` 429), Tier 2 SHA-256 `contentHash` match vs mismatch/missing (`ADDON_HASH_MISMATCH` 403), banned `@sentry/node`/`setInterval` rejection, Shadow Mode lifecycle (`< 20` runs or `>= 10%` discard rejection, `>= 20` runs + `< 10%` discard + `lead_dev` promotion to `graduated`, and `5` consecutive post-graduation discards auto-deprecation to `deprecated`), and `resolveAndVerifyExternalIdentity` (`ADDON_UNLINKED_EXTERNAL_USER` 403 vs linked user intent resolution)

**Checkpoint**: User Story 2 (Task 15.2) is complete and independently verified via `tests/unit/addon-registry-shadow-identity.test.ts`.

---

## Phase 3: User Story 3 - First-Party Official Reference Addons: Sentry, GitHub Issues & Discord Cockpit (Priority: P1 — Master Plan Task 15.3)

**Goal**: Implement the three official Tier 1 reference plugins (`src/orchestrator/addons/builtin/sentry-signal.ts`, `src/orchestrator/addons/builtin/github-issues-signal.ts`, `src/orchestrator/addons/builtin/discord-cockpit.ts`) using TypeBox webhook validation and constant-time HMAC-SHA256 verification via `relay.readSecret()` with zero `@sentry/node` imports and zero `setInterval`/`setTimeout` calls.

**Independent Test**: Run `pnpm vitest run tests/integration/addons-builtin.test.ts` to verify Fastify webhook routes, HMAC signature verification, TypeBox validation, signal normalization, Discord cockpit human intent routing, and static source compliance.

### Implementation & Tests for User Story 3 (Master Plan Task 15.3)

- [x] T008 [P] [US3] Implement `@graywolf/addon-sentry` (`sentrySignalAddon`) in `src/orchestrator/addons/builtin/sentry-signal.ts` declaring `requiredSecrets: ['SENTRY_WEBHOOK_HMAC_SECRET']`, registering `POST /addons/sentry/webhook`, verifying `x-sentry-hook-signature` via constant-time HMAC-SHA256 (`crypto.timingSafeEqual`, returning HTTP 401 on invalid/missing signature), validating payload via TypeBox, normalizing into `GraywolfSignalEnvelope` (`kind: 'crash'`, truncating `title` to `<= 200`, `description` to `<= 4096`, `raw` to `<= 65536`), and calling `relay.submitSignal(envelope)` with zero `@sentry/node` imports and zero `setInterval`/`setTimeout` timers
- [x] T009 [P] [US3] Implement `@graywolf/addon-github-issues` (`githubIssuesSignalAddon`) in `src/orchestrator/addons/builtin/github-issues-signal.ts` declaring `requiredSecrets: ['GITHUB_WEBHOOK_HMAC_SECRET']`, registering `POST /addons/github-issues/webhook`, verifying `x-hub-signature-256` (`sha256=<hex>`) via constant-time HMAC-SHA256 (returning HTTP 401 on invalid/missing signature), validating issue payload via TypeBox, classifying labels into `kind: 'bug-report' | 'feature'`, normalizing into `GraywolfSignalEnvelope`, and calling `relay.submitSignal(envelope)` with zero `setInterval`/`setTimeout` timers
- [x] T010 [P] [US3] Implement `@graywolf/addon-discord-cockpit` (`discordCockpitAddon`) in `src/orchestrator/addons/builtin/discord-cockpit.ts` declaring `platform: 'discord'` and `requiredSecrets: ['DISCORD_WEBHOOK_SECRET']`, registering `POST /addons/discord/interactions` (verifying `x-discord-signature-sha256` via constant-time HMAC-SHA256 and calling `relay.receiveHumanIntent`) and `POST /addons/discord/notify` (dispatching `relay.postTaskBrief` and `relay.postEscalation`) with zero `setInterval`/`setTimeout` timers
- [x] T011 [US3] Create Fastify integration test suite in `tests/integration/addons-builtin.test.ts` testing `@graywolf/addon-sentry`, `@graywolf/addon-github-issues`, and `@graywolf/addon-discord-cockpit` across valid vs invalid HMAC signatures (200 vs 401), crash storm Valkey deduplication, unlinked vs linked Discord user intents (403 `ADDON_UNLINKED_EXTERNAL_USER` vs 200), and static source inspection confirming zero `@sentry/node` imports and zero `setInterval`/`setTimeout` calls

**Checkpoint**: User Story 3 (Task 15.3) is complete and independently verified via `tests/integration/addons-builtin.test.ts`.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Full repository typecheck, lint, and regression suite verification.

- [x] T012 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` across all suites and mark Tasks 15.1, 15.2, and 15.3 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (`T001`–`T003`, US1 `sanitization.ts` & `sdk.ts`)**: No dependencies — starts immediately.
- **Phase 2 (`T004`–`T007`, US2 `shadow-lifecycle.ts`, `identity-binding.ts`, `registry.ts`)**: `T004` and `T005` can run in parallel with Phase 1; `T006` (`registry.ts`) uses types from `sdk.ts` (`T002`).
- **Phase 3 (`T008`–`T011`, US3 built-in reference addons)**: Depends on `sdk.ts` (`T002`) and `identity-binding.ts` (`T005`). `T008`, `T009`, and `T010` touch separate files and can be implemented in parallel.
- **Phase 4 (`T012`)**: Depends on `T001`–`T011`.

### Parallel Opportunities

- `T001` (`sanitization.ts`), `T002` (`sdk.ts`), `T004` (`shadow-lifecycle.ts`), and `T005` (`identity-binding.ts`) touch completely separate files and can be developed in parallel.
- `T008` (`sentry-signal.ts`), `T009` (`github-issues-signal.ts`), and `T010` (`discord-cockpit.ts`) can be developed in parallel.

## Parallel Example: User Story 1 & User Story 3

```bash
# Implement SDK and sanitizer in parallel (US1):
Task: "T001 [P] [US1] Implement sanitizeUntrustedSignalText and sanitizeSignalEnvelopeForPrompt in src/orchestrator/addons/sanitization.ts"
Task: "T002 [P] [US1] Implement computeSignalFingerprint and createScopedRelayContext in src/orchestrator/addons/sdk.ts"

# Implement all 3 built-in reference addons in parallel (US3):
Task: "T008 [P] [US3] Implement sentrySignalAddon in src/orchestrator/addons/builtin/sentry-signal.ts"
Task: "T009 [P] [US3] Implement githubIssuesSignalAddon in src/orchestrator/addons/builtin/github-issues-signal.ts"
Task: "T010 [P] [US3] Implement discordCockpitAddon in src/orchestrator/addons/builtin/discord-cockpit.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (`T001`–`T003`: `@graywolf/addon-sdk` Runtime Context, Deduplication & Sanitization).
2. **STOP and VALIDATE**: Run `pnpm vitest run tests/unit/addon-sdk.test.ts`.

### Incremental Delivery

1. Complete Phase 1 (US1 — Task 15.1) $\rightarrow$ Verify `tests/unit/addon-sdk.test.ts`
2. Complete Phase 2 (US2 — Task 15.2) $\rightarrow$ Verify `tests/unit/addon-registry-shadow-identity.test.ts`
3. Complete Phase 3 (US3 — Task 15.3) $\rightarrow$ Verify `tests/integration/addons-builtin.test.ts`
4. Complete Phase 4 (`T012`) $\rightarrow$ Full repo convergence check


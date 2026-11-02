# Feature Specification: Provider Keys

**Feature Branch**: `004-provider-keys`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "Phase 4: Provider Keys — BYOK key management for AI image generation providers"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a Provider Key (Priority: P1)

A brand owner navigates to the keys management page for their brand and adds a new API key for a supported provider (OpenAI or Gemini). They enter the full API key, give it an optional label for identification, and choose whether to make it the active key. The system securely stores the key in a vault, never exposing the full key value again. The user sees only a masked hint (last 4 characters) confirming the key was saved.

**Why this priority**: Without at least one stored key, no image generation is possible. This is the foundational action for the entire BYOK model.

**Independent Test**: Can be fully tested by adding a key and confirming it appears in the key list with correct hint, label, provider, and active status. Delivers the ability to store credentials needed for generation.

**Acceptance Scenarios**:

1. **Given** a brand with no keys, **When** the user adds an OpenAI key with label "Production" and `make_active: true`, **Then** the key is stored securely, the list shows one key with provider "openai", label "Production", hint showing last 4 characters, and `is_active: true`.
2. **Given** a brand with an existing active OpenAI key, **When** the user adds another OpenAI key with `make_active: true`, **Then** the new key becomes active and the previous key is deactivated atomically.
3. **Given** a brand with no keys, **When** the user adds a key with `make_active: false`, **Then** the key is stored but marked inactive; no key is active for that provider.
4. **Given** the user submits an empty key value, **When** the system processes the request, **Then** it rejects the submission with a clear validation error.

---

### User Story 2 - View and Manage Keys (Priority: P1)

A brand owner views all stored API keys for their brand, organized by provider. They can see which key is currently active for each provider, the masked hint, label, validation status, and when each key was last validated. The full key value is never displayed.

**Why this priority**: Users need visibility into their stored keys to manage rotation and troubleshoot issues. Co-equal with adding keys for a usable feature.

**Independent Test**: Can be tested by listing keys for a brand that has multiple keys across providers and verifying the list shows correct metadata without ever exposing actual key values.

**Acceptance Scenarios**:

1. **Given** a brand with 3 keys (2 OpenAI, 1 Gemini), **When** the user views the keys page, **Then** all 3 keys are listed with provider, label, hint, active status, and validation status visible.
2. **Given** a brand with no keys, **When** the user views the keys page, **Then** an empty state is displayed guiding the user to add their first key.
3. **Given** a key that was previously validated, **When** the user views the key, **Then** the last validation timestamp and result (valid/invalid) are shown.

---

### User Story 3 - Validate a Key (Priority: P2)

A brand owner validates a stored API key to confirm it is still working with the provider. The system makes a lightweight test call to the provider's API and reports whether the key is valid or invalid, along with any error details. The validation result and timestamp are persisted.

**Why this priority**: Validation prevents failed generations due to expired or revoked keys. Important for user confidence but not strictly required to store and use keys.

**Independent Test**: Can be tested by validating a known-good key (expect success) and a known-bad key (expect failure with error details). Delivers confidence in key health before generation.

**Acceptance Scenarios**:

1. **Given** a stored OpenAI key that is valid, **When** the user triggers validation, **Then** the system reports `valid: true` with the current timestamp and clears any previous error.
2. **Given** a stored Gemini key that has been revoked, **When** the user triggers validation, **Then** the system reports `valid: false` with a human-readable error description and the timestamp.
3. **Given** a key validation is in progress, **When** the user views the key, **Then** a loading/progress indicator is shown until the result returns.

---

### User Story 4 - Activate a Key (Priority: P2)

A brand owner who has multiple keys for the same provider can switch which key is active. Activating a key automatically deactivates the previously active key for that provider in a single atomic operation. Only one key per provider per brand can be active at any time.

**Why this priority**: Key rotation is a core operational workflow, but only relevant once multiple keys exist. Builds on the add-key foundation.

**Independent Test**: Can be tested by adding two keys for the same provider, activating the second, and verifying only the second is now active.

**Acceptance Scenarios**:

1. **Given** a brand with two OpenAI keys (Key A active, Key B inactive), **When** the user activates Key B, **Then** Key B becomes active and Key A becomes inactive atomically.
2. **Given** a brand with one active Gemini key, **When** the user activates the same key, **Then** the state remains unchanged (idempotent).
3. **Given** a brand with keys for both providers, **When** the user activates a different OpenAI key, **Then** only the OpenAI active key changes; the Gemini active key is unaffected.

---

### User Story 5 - Delete a Key (Priority: P3)

A brand owner deletes a stored API key they no longer need. The key is permanently removed from both the vault and the database. If the deleted key was the active key, no key is active for that provider until the user activates another one.

**Why this priority**: Cleanup is important for security hygiene but is the least frequent operation and can be deferred.

**Independent Test**: Can be tested by deleting a key and confirming it no longer appears in the list and its vault secret is also removed.

**Acceptance Scenarios**:

1. **Given** a brand with an inactive OpenAI key, **When** the user deletes it, **Then** the key is removed from both the secure vault and the key list.
2. **Given** a brand with only one active OpenAI key, **When** the user deletes it, **Then** the key is removed and no OpenAI key is active. The user is informed they need to add a new key to generate images.
3. **Given** a deletion request for a key belonging to another brand, **When** the system processes it, **Then** the request is rejected (ownership enforcement).

---

### Edge Cases

- What happens when the vault is temporarily unavailable during key addition? The operation fails with a clear error; no partial record is left in the database.
- What happens when a user tries to add a key for an unsupported provider? The system rejects with a validation error listing supported providers.
- What happens when validation times out against the provider? The system reports the key as unvalidated with a timeout error, not as invalid.
- What happens when two users simultaneously try to activate different keys for the same brand/provider? The unique constraint ensures only one active key; the second request either succeeds (last writer wins) or retries.
- What happens when a key is deleted while a generation using it is in progress? The in-progress generation continues (it already retrieved the key); the key is removed for future use.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to add API keys for supported providers (OpenAI, Gemini) to a brand they own.
- **FR-002**: System MUST store API key values exclusively in a secure vault; the raw key value MUST NOT be stored in the application database.
- **FR-003**: System MUST never return the full API key value in any response. Only a masked hint (last 4 characters) is shown.
- **FR-004**: System MUST enforce that at most one key per provider per brand can be active at any time.
- **FR-005**: When a new key is activated, the system MUST atomically deactivate the previously active key for the same provider and brand.
- **FR-006**: System MUST allow users to validate a stored key by making a lightweight test call to the provider's API.
- **FR-007**: System MUST persist validation results (valid/invalid, timestamp, error details) on the key record.
- **FR-008**: System MUST support key deletion, removing both the vault secret and the database record.
- **FR-009**: System MUST enforce brand ownership for all key operations — users can only manage keys for brands they own.
- **FR-010**: System MUST list all keys for a brand, showing provider, label, hint, active status, validation status, and timestamps.
- **FR-011**: System MUST accept an optional label (up to 100 characters) for each key to help users identify them.
- **FR-012**: System MUST support the `make_active` flag when adding a key, which sets the new key as active (deactivating any current active key for that provider).
- **FR-013**: The UI MUST organize keys by provider using a tabbed interface.
- **FR-014**: The UI MUST provide a modal form for adding new keys with fields for provider selection, key value, optional label, and an active toggle.
- **FR-015**: The UI MUST display each key as a card showing hint, label, active badge, validation status, and action buttons (validate, activate, delete).

### Key Entities

- **Provider Key**: A reference to a securely stored API key for a specific provider. Belongs to exactly one brand. Attributes: provider (OpenAI/Gemini), label, hint (last 4 characters), active status, validation status, validation timestamp, validation error, last used timestamp.
- **Brand**: The parent entity. A brand can have multiple keys per provider but at most one active key per provider.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can add an API key and see it listed within 3 seconds of submission.
- **SC-002**: The full API key value is never present in any user-facing response, browser network traffic, or application logs.
- **SC-003**: Key validation returns a result within 15 seconds for each supported provider.
- **SC-004**: At most one key per provider per brand is active at any time, enforced at the data layer.
- **SC-005**: Key activation completes atomically — there is no moment where zero or two keys are simultaneously active for the same provider during rotation.
- **SC-006**: Deleted keys are fully removed from both the secure vault and the database.
- **SC-007**: Users who do not own a brand cannot view, add, modify, or delete that brand's keys.
- **SC-008**: Users can complete the full lifecycle (add, validate, activate, delete) for a key in under 5 minutes on their first attempt.

## Assumptions

- The vault service is available and accessible from the backend via service-role credentials.
- Provider validation uses lightweight, low-cost API calls (e.g., listing models or a minimal test request) rather than generating actual content.
- The hint is derived server-side from the last 4 characters of the submitted key at creation time.
- Key operations are performed via the backend API; the frontend never handles or stores raw key values beyond the initial submission form.
- The "make_active" behavior on add is a convenience shortcut; the explicit activate endpoint remains available for subsequent rotation.

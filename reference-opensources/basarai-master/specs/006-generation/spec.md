# Feature Specification: Image Generation

**Feature Branch**: `006-generation`
**Created**: 2026-04-11
**Status**: Draft
**Input**: User description: "docs/implementation-plan.md - Phase 6: Generation ONLY. Implementation will be done by a cheaper model, so the specification must be super clear and unambiguous."

## Overview

This feature lets a brand owner generate a branded social image by writing a prompt, picking a platform preset (e.g., Instagram Post), choosing a provider (OpenAI or Gemini), choosing how the brand's logo is applied, and clicking Generate. The system calls the chosen provider using the brand's own API key, adjusts the returned image to the exact preset size, optionally applies a logo watermark, saves the PNG, and displays it for the user to download.

**This spec covers Phase 6 only.** History browsing, listing past generations, reopening past results, and deleting generations are **out of scope** (see [Out of Scope](#out-of-scope) and Phase 7).

## Clarifications

### Session 2026-04-11

- Q: What is the maximum generation timeout, and what does it apply to? → A: 120 seconds, applied to the provider API call (post-processing and storage are fast and run after the provider returns).
- Q: Does the system automatically retry transient provider failures (rate limit, network, timeout, 5xx)? → A: No — zero automatic retries. Any provider error causes the generation to fail immediately and the user retries manually by clicking Generate again.
- Q: What are the default watermark visual parameters (position, size, opacity, margin)? → A: Bottom-right corner, 15% of the generated image's width (logo height scales proportionally), 70% opacity, 20 px margin from the right and bottom edges. These are fixed in Phase 6 — not user-configurable.
- Q: Which provider is pre-selected when the user opens the generator? → A: Smart default — if only one provider has an active key, auto-select it; if both providers have active keys, default to Gemini; if neither has an active key, default to OpenAI and show the "no active key" notice (FR-009).
- Q: What filename does the Download button give the saved PNG? → A: `{sanitized-brand-name}-{preset}-{YYYYMMDD-HHmmss}.png` (e.g., `my-brand-instagram_post-20260411-143052.png`), where the timestamp is UTC and derived from the generation's `completed_at`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate an Image End-to-End (Priority: P1)

A brand owner opens the generator for one of their brands, writes a prompt like "A modern minimal office with natural light, desk plants, and a laptop", picks the Instagram Post preset, keeps the pre-selected provider (the system has already chosen it per FR-033), keeps logo mode "none", and clicks Generate. The system shows a loading state, calls the provider, produces a PNG at the exact Instagram Post dimensions (1080 × 1080), displays the image in a preview area, and offers a Download button that saves the file to their device.

**Why this priority**: This is the core product — everything else in the application exists to enable this moment. Without a successful end-to-end generation, the product has no value.

**Independent Test**: On a brand that has an active provider key, open the generator, enter a valid prompt, select any preset, click Generate, wait for the result, and verify (a) an image appears in the preview area, (b) the image dimensions match the chosen preset exactly, (c) the Download button saves a PNG file to disk, and (d) a generation record is created with status "succeeded".

**Acceptance Scenarios**:

1. **Given** a brand with an active OpenAI key and a valid prompt entered, **When** the user selects the Instagram Post preset and clicks Generate, **Then** a PNG image at exactly 1080 × 1080 pixels is displayed in the preview area within the same page, with a Download button beside it.
2. **Given** a brand with an active Gemini key, **When** the user selects the YouTube Thumbnail preset (1280 × 720) and clicks Generate, **Then** the final PNG is exactly 1280 × 720 pixels, even if the provider's native output is a different aspect ratio or size.
3. **Given** a successful generation is shown in the preview, **When** the user clicks Download, **Then** a PNG file is saved to the user's device.
4. **Given** a generation is in progress (Generate has been clicked and the system is calling the provider), **When** the user views the form, **Then** the Generate button is disabled, a loading indicator is visible, and the form cannot be submitted again until the current generation finishes.
5. **Given** a user enters a prompt that is shorter than 3 characters or longer than 4,000 characters, **When** the user attempts to click Generate, **Then** the form blocks submission and surfaces a validation message explaining the allowed range.

---

### User Story 2 - Apply the Brand Logo to the Generation (Priority: P2)

A brand owner has uploaded a logo for their brand (from Phase 3). Before generating, they pick how the logo should appear on the image: not at all, described to the provider in the prompt, overlaid as a watermark after generation, or both described in the prompt and overlaid as a watermark. The system applies the chosen logo mode and the final image reflects the choice.

**Why this priority**: Logo usage is a defining differentiator of branded image generation versus generic AI images. Without it, users have no way to tie generated visuals to their brand identity.

**Independent Test**: For a brand that has a logo, generate one image per logo mode (none, prompt, watermark, both) and verify the final preview image behaves as expected for each mode. For a brand that has no logo, verify that "watermark" and "both" are unavailable.

**Acceptance Scenarios**:

1. **Given** a brand with an uploaded logo, **When** the user selects logo mode "watermark" and generates, **Then** the returned image has the brand logo composited onto it at a position and size that is clearly visible without obscuring the main subject.
2. **Given** a brand with an uploaded logo, **When** the user selects logo mode "prompt" and generates, **Then** no watermark is composited, and the request sent to the provider instructs the provider to incorporate the brand logo naturally in the scene.
3. **Given** a brand with an uploaded logo, **When** the user selects logo mode "both" and generates, **Then** the provider is instructed to incorporate the logo into the scene AND a watermark is additionally composited on the final image.
4. **Given** a brand with an uploaded logo, **When** the user selects logo mode "none" and generates, **Then** no watermark is composited and the prompt sent to the provider contains no logo instruction.
5. **Given** a brand that does **not** have an uploaded logo, **When** the user opens the generator, **Then** the logo mode selector offers only "none" and "prompt" (or shows "watermark" and "both" as disabled with an explanation).

---

### User Story 3 - Handle Provider Failures Gracefully (Priority: P3)

A user clicks Generate, but the chosen provider returns an error (invalid key, rate limit, network failure, content policy rejection, or timeout). Instead of seeing a silent failure or a raw technical dump, the user sees a clear, human-readable error message explaining what went wrong and what to try next. The failed attempt is recorded so operators can see it later, but the user can immediately retry a new generation without losing their form state.

**Why this priority**: Provider errors are the most common failure mode in a BYOK (bring-your-own-key) product. A bad failure experience will be the single most frequent complaint and will block users from successful generations.

**Independent Test**: Configure a brand with an intentionally invalid API key, attempt a generation, and verify (a) the user sees a human-readable error, (b) the form state (prompt, preset, logo mode) is preserved so the user can retry, (c) a generation record with status "failed" and an error code/message is persisted, and (d) no PNG file is stored.

**Acceptance Scenarios**:

1. **Given** a brand whose active provider key is invalid or revoked, **When** the user clicks Generate, **Then** the user sees a clear error message identifying the key as the problem and is offered a link or instruction to review their provider keys.
2. **Given** a provider call fails for any reason (network error, rate limit, content policy, timeout), **When** the failure is detected, **Then** a generation record is persisted with status "failed", an error code, and an error message, and no image file is stored.
3. **Given** a generation has just failed, **When** the user views the form, **Then** the form retains the prompt, preset, provider, and logo mode the user had selected, and the Generate button is re-enabled so the user can retry immediately.
4. **Given** a provider call takes too long to respond, **When** the 120-second provider-call timeout elapses, **Then** the generation is recorded as failed with a timeout error code and the user is shown a timeout error message.
5. **Given** the user has no active provider key for the currently selected provider, **When** the user opens the generator, **Then** the Generate button is disabled and an inline message directs the user to add or activate a provider key (linking to the provider keys page).

---

### User Story 4 - Brand Context Enriches Generation (Priority: P4)

When a brand has a completed brand kit (from Phase 5), the generator automatically uses the brand's context summary — tagline, tone, audience, colors, words to avoid — to enrich the request sent to the provider. This happens silently: the user writes the same short prompt they always would, and the system extends it with the brand context before calling the provider. If the brand kit is not complete, the system still generates, but without the extra brand context.

**Why this priority**: Brand context is what distinguishes on-brand output from generic AI imagery. Automatic enrichment means users don't have to repeat their brand identity in every prompt.

**Independent Test**: Generate two images on the same prompt — once on a brand with a complete kit, once on a brand with no kit — and verify that both succeed. Additionally verify that the brand kit's information is never visible in the stored prompt (which must remain the raw user input), and that generations on a kit-complete brand include the kit's context in the request sent to the provider.

**Acceptance Scenarios**:

1. **Given** a brand with a complete brand kit, **When** the user submits a prompt, **Then** the system sends the provider a combined request that includes both the brand's context summary and the user's prompt — without requiring the user to enter any brand context manually.
2. **Given** a brand with no brand kit (or an incomplete one), **When** the user submits a prompt, **Then** the generation still completes successfully using only the user's prompt, and no error or warning is shown about the missing kit.
3. **Given** any generation (kit-complete or not), **When** the user views or downloads the result, **Then** the stored generation record contains the user's original prompt only — not the enriched/combined prompt that was sent to the provider.

---

### Edge Cases

- **Prompt boundaries**: Prompts shorter than 3 characters or longer than 4,000 characters must be rejected client-side before the Generate button is enabled.
- **Brand without logo + watermark selection**: If the brand has no uploaded logo, the "watermark" and "both" logo modes must be unavailable (not selectable) and an explanation must be visible to the user.
- **No active provider key**: If the brand has no active key for the currently selected provider, the Generate button must be disabled with an inline explanation and a link to the keys page.
- **Concurrent generation attempt**: While one generation is in progress, the Generate button must be disabled so a second generation cannot be submitted from the same form. Navigating away and back should not allow the user to bypass this.
- **Provider output size ≠ preset size**: Some providers (notably Gemini) return images at fixed aspect-ratio sizes rather than exact pixel dimensions. The system must always post-process the returned image so the final PNG matches the preset's exact pixel dimensions.
- **Provider returns no image**: If the provider call succeeds at the HTTP level but returns no image data, the generation must be recorded as failed with an error code and a clear message.
- **Content policy rejection**: If the provider refuses the prompt due to content policy, the generation must be recorded as failed with an error code that identifies the rejection as a policy issue, and the user must see a clear, non-technical explanation.
- **Preview persistence across navigation**: The result preview is only shown on the generator page after a successful generation in the current session. If the user navigates away from the generator and back, the preview is gone — past generations are viewed via the history feature (Phase 7), which is not part of this spec.
- **User switches brand mid-generation**: If the user switches to a different brand while a generation is in progress, the system must not show the result on the new brand's generator; the result belongs only to the brand it was generated for.
- **User is not the brand owner**: A user must never be able to generate for a brand they do not own. Any such attempt must be rejected.

## Requirements *(mandatory)*

### Functional Requirements

#### Form and Inputs

- **FR-001**: The generator MUST be accessible for any brand the user owns.
- **FR-002**: The generator MUST accept a **user prompt** as free-text input between **3 and 4,000 characters** (inclusive). Prompts outside this range MUST be rejected before submission with a clear validation message.
- **FR-003**: The generator MUST offer a **provider selector** with two options: **OpenAI** and **Gemini**.
- **FR-004**: Each provider has **exactly one supported model** in Phase 6: **OpenAI → `gpt-image-1.5`**, **Gemini → `gemini-3-pro-image-preview`**. These are used automatically based on the selected provider. A user-facing model selector is **not required** in Phase 6 — the model is resolved implicitly from the provider choice. The stored generation record MUST still persist the model identifier that was used.
- **FR-005**: The generator MUST offer a **platform preset selector** with the 13 options listed in **Reference Table A (Platform Presets)** below, grouped by platform in the UI.
- **FR-006**: The generator MUST offer a **logo mode selector** with four options — `none`, `prompt`, `watermark`, `both` — whose effects are defined in **Reference Table B (Logo Modes)** below.
- **FR-007**: Logo modes `watermark` and `both` MUST only be selectable when the brand has an uploaded logo. When no logo exists, those two options MUST be disabled or hidden with an explanation visible to the user.
- **FR-008**: The **Generate button** MUST be disabled when **any** of the following are true:
    - Prompt is empty, under 3 characters, or over 4,000 characters.
    - No platform preset is selected.
    - No active provider key exists for the currently selected provider on the current brand.
    - A generation is already in progress from this form.
- **FR-009**: When no active provider key exists for the currently selected provider, the form MUST show an **inline notice** explaining the issue and linking to the provider keys page for this brand.
- **FR-033**: When the generator is first opened for a brand, the system MUST pre-select a provider using this deterministic rule:
    1. If **only one** provider (OpenAI or Gemini) has an active key for this brand → auto-select that provider.
    2. If **both** providers have active keys → default to **Gemini**.
    3. If **neither** provider has an active key → default to **OpenAI** and immediately show the inline "no active key" notice from FR-009.
    The user may still freely switch providers afterward; the pre-selection only determines the initial state of the provider selector.

#### Generation Pipeline Behavior

- **FR-010**: When Generate is clicked, the system MUST create a **generation record** associated with the current brand, starting in status `pending`.
- **FR-011**: The generation status MUST follow exactly this lifecycle: `pending` → `processing` → (`succeeded` | `failed`). It MUST NOT skip states or remain in `pending`/`processing` after the request completes.
- **FR-012**: The system MUST resolve the target dimensions from the selected platform preset's width and height (per Reference Table A) before calling the provider.
- **FR-013**: The system MUST fetch the brand's **active** provider key for the selected provider and use it to authenticate the provider call. Provider keys MUST NEVER be exposed to the browser, logged in plain text, or returned in any response.
- **FR-014**: If the brand has a **complete** brand kit (Phase 5), the system MUST include the kit's derived **brand context summary** in the request sent to the provider, prepended to the user's prompt. If the kit is incomplete or missing, the system MUST proceed with the user prompt alone — no error.
- **FR-015**: When logo mode is `prompt` or `both` AND the brand has an uploaded logo, the system MUST append a logo instruction to the request sent to the provider (e.g., "Incorporate the brand logo naturally into the image.").
- **FR-016**: The system MUST call the selected provider using that provider's supported model (per FR-004) and the composed prompt. OpenAI calls MUST pass the target width × height. Gemini calls MUST pass the preset's mapped aspect ratio (see FR-017) because Gemini does not accept explicit pixel dimensions.
- **FR-017**: For Gemini calls, the system MUST map each preset to a supported Gemini aspect ratio using **Reference Table C (Preset → Gemini Aspect Ratio)** below.
- **FR-018**: After the provider returns an image, the system MUST **post-process** it so the final PNG matches the preset's exact pixel dimensions (from Reference Table A). When the provider's output differs in size or aspect ratio, the system MUST scale the image to cover the target dimensions and then center-crop to those exact dimensions.
- **FR-019**: When logo mode is `watermark` or `both` AND the brand has an uploaded logo, the system MUST composite the brand logo onto the post-processed image using these **fixed** visual parameters (not user-configurable in Phase 6):
    - **Position**: bottom-right corner of the generated image.
    - **Size**: logo scaled so its width is **15% of the generated image's width**; logo height scales proportionally to preserve the logo's native aspect ratio.
    - **Opacity**: **70%** (0.7 alpha multiplier applied to the logo's alpha channel before compositing).
    - **Margin**: **20 pixels** between the logo and both the right edge and the bottom edge of the image.
    - **Compositing**: the logo is overlaid on top of the post-processed image; the final stored image remains PNG.
- **FR-020**: On success, the system MUST:
    1. Save the final PNG to storage at a stable, unguessable location scoped to the brand and generation.
    2. Update the generation record to status `succeeded` with the stored image path and a completion timestamp.
    3. Update the provider key's last-used timestamp.
- **FR-021**: On failure at any step of the pipeline, the system MUST update the generation record to status `failed`, persist an **error code** and a **human-readable error message** (truncated if very long), and record a completion timestamp. No partial image file must remain in storage for a failed generation.
- **FR-022**: The generation record MUST store the user's **original prompt only** — NOT the combined/enriched prompt that was sent to the provider.
- **FR-023**: The output format MUST ALWAYS be PNG. No other formats are allowed in this phase.
- **FR-031**: The provider API call (FR-016) MUST be subject to a **120-second timeout**. If the provider does not return a response within 120 seconds, the pipeline MUST abort the call, mark the generation `failed` with a timeout error code, and surface a timeout message to the user (per FR-026). Post-processing (FR-018), watermarking (FR-019), and storage upload (FR-020) run after the provider returns and are NOT included in this 120-second window.
- **FR-032**: The system MUST NOT automatically retry a provider call after any failure — transient (rate limit, network error, timeout, 5xx) or permanent (invalid key, content policy rejection, 4xx). Every provider call is **exactly one attempt**. On failure, the user retries manually by clicking Generate again, which creates a new generation record.

#### Result Display and Download

- **FR-024**: On success, the generator MUST display the returned PNG in a **result preview area** on the same page as the form.
- **FR-025**: The result preview MUST include a **Download button** that, when clicked, saves the PNG file to the user's device.
- **FR-034**: The downloaded PNG MUST be delivered with a **human-readable filename** in the exact format:

    `{sanitized-brand-name}-{preset-identifier}-{YYYYMMDD-HHmmss}.png`

    Sanitization and formatting rules:
    - **`sanitized-brand-name`**: start from the brand's `name`, lowercase it, replace every character that is not `a–z` or `0–9` with a hyphen (`-`), collapse consecutive hyphens into one, trim leading and trailing hyphens, and truncate to a maximum of **40 characters**. If the result is empty (e.g., a brand named entirely with non-ASCII characters), use the literal string `brand`.
    - **`preset-identifier`**: the preset's stable identifier from Reference Table A, used as-is (e.g., `instagram_post`, `youtube_thumbnail`).
    - **`YYYYMMDD-HHmmss`**: the generation's `completed_at` timestamp formatted in **UTC**, zero-padded (e.g., `20260411-143052`).
    - **Example**: a brand named "My Brand!" generating an Instagram Post at 2026-04-11 14:30:52 UTC produces `my-brand-instagram_post-20260411-143052.png`.

    The filename MUST be conveyed to the browser so the file is saved with this name (not the stored UUID path).
- **FR-026**: On failure, the result preview area MUST show a **human-readable error message** instead of an image, derived from the failure category (e.g., "Your provider key was rejected — please check your keys.", "This request was refused by the provider's content policy.", "The request timed out. Please try again."). The message MUST NOT dump raw technical details or stack traces.
- **FR-027**: After a success or failure, the generator form MUST retain the user's last inputs (prompt, preset, provider, logo mode) so the user can iterate without re-entering them.
- **FR-028**: While a generation is in progress, the form MUST show a **loading state** (e.g., spinner) and the Generate button MUST be disabled until the generation resolves as success or failure.

#### Security and Ownership

- **FR-029**: A user MUST NOT be able to submit a generation for a brand they do not own. Any attempt MUST be rejected with an authorization error.
- **FR-030**: The system MUST NOT return or log the raw provider API key in any API response, frontend state, browser network trace, or server log.

#### Reference Table A — Platform Presets

The following 13 presets are the complete and exhaustive set for Phase 6. Identifiers, labels, and dimensions are fixed.

| Platform | Preset Identifier | Human Label | Width (px) | Height (px) |
|----------|-------------------|-------------|------------|-------------|
| Instagram | `instagram_post` | Instagram Post | 1080 | 1080 |
| Instagram | `instagram_story` | Instagram Story | 1080 | 1920 |
| Instagram | `instagram_reel_cover` | Instagram Reel Cover | 1080 | 1920 |
| Facebook | `facebook_post` | Facebook Post | 1200 | 630 |
| Facebook | `facebook_cover` | Facebook Cover | 820 | 312 |
| Facebook | `facebook_story` | Facebook Story | 1080 | 1920 |
| Twitter/X | `twitter_post` | Twitter Post | 1200 | 675 |
| Twitter/X | `twitter_header` | Twitter Header | 1500 | 500 |
| LinkedIn | `linkedin_post` | LinkedIn Post | 1200 | 627 |
| LinkedIn | `linkedin_banner` | LinkedIn Banner | 1584 | 396 |
| TikTok | `tiktok_video_cover` | TikTok Video Cover | 1080 | 1920 |
| YouTube | `youtube_thumbnail` | YouTube Thumbnail | 1280 | 720 |
| YouTube | `youtube_banner` | YouTube Banner | 2560 | 1440 |

#### Reference Table B — Logo Modes

| Value | Effect on Provider Prompt | Effect on Final Image |
|-------|---------------------------|-----------------------|
| `none` | No logo instruction | No watermark |
| `prompt` | Instructs provider to incorporate brand logo | No watermark |
| `watermark` | No logo instruction | Brand logo composited onto returned image |
| `both` | Instructs provider to incorporate brand logo | Brand logo composited onto returned image |

#### Reference Table C — Preset → Gemini Aspect Ratio

Gemini requires an aspect ratio rather than explicit pixel dimensions. Every preset maps to exactly one Gemini aspect ratio. Post-processing (FR-018) is responsible for reaching exact preset dimensions from Gemini's native output.

| Preset Identifier | Gemini Aspect Ratio |
|-------------------|---------------------|
| `instagram_post` | `1:1` |
| `instagram_story` | `9:16` |
| `instagram_reel_cover` | `9:16` |
| `facebook_story` | `9:16` |
| `tiktok_video_cover` | `9:16` |
| `facebook_post` | `16:9` |
| `twitter_post` | `16:9` |
| `linkedin_post` | `16:9` |
| `youtube_thumbnail` | `16:9` |
| `twitter_header` | `16:9` |
| `facebook_cover` | `16:9` |
| `linkedin_banner` | `16:9` |
| `youtube_banner` | `16:9` |

### Key Entities

- **Generation**: A single image generation attempt for a brand. Captures what the user asked for (prompt, preset, provider, logo mode), the model that was used (resolved automatically from the provider per FR-004), the lifecycle state (`pending` → `processing` → `succeeded`/`failed`), the stored output (image path on success), failure details (error code + message on failure), and timestamps (created, completed).
- **Platform Preset**: A named output configuration for a specific social platform and use case. Has a stable identifier, a human label, a target pixel width, a target pixel height, and (for Gemini calls) a mapped aspect ratio. The 13 presets are fixed and defined in Reference Table A.
- **Logo Mode**: One of `none`, `prompt`, `watermark`, `both`. Determines whether and how the brand logo is applied to the generation — via the provider prompt, via post-processing watermark, both, or neither.
- **Provider**: One of `openai` or `gemini`. Determines which external image generation service is called and which key is used from the brand's active provider keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A brand owner with an active provider key and a valid prompt can click Generate and see the resulting image in the preview area, for a standard-sized preset (Instagram Post, YouTube Thumbnail), within **90 seconds** including provider response time.
- **SC-002**: **100% of successful generations** produce a PNG whose pixel dimensions exactly match the selected preset — verified by inspecting the stored file, not just the API response.
- **SC-003**: **100% of failed generations** persist a non-null error code and a non-null human-readable error message on the generation record.
- **SC-004**: A user whose provider key is invalid sees a human-readable error that references the key as the problem (not a generic "something went wrong"), verified with a deliberately invalid key.
- **SC-005**: When the brand has no uploaded logo, the generator's logo mode selector **never** allows the user to pick `watermark` or `both`.
- **SC-006**: While a generation is in progress, clicking the Generate button a second time has no effect — the system does not start a second parallel generation from the same form.
- **SC-007**: The Download button delivers a file whose contents are **byte-identical** to the PNG stored in the system for that generation.
- **SC-008**: A user attempting to generate for a brand they do not own is rejected with an authorization error, and no generation record is created for that brand.
- **SC-009**: Given the same brand, same prompt, and the same logo mode (`none`), the generated result fits the selected preset's exact dimensions regardless of which provider (OpenAI or Gemini) is chosen — i.e., preset dimensions are always enforced for the client-visible output.
- **SC-010**: Generations made on a brand with a complete brand kit reach the provider with the brand's context summary attached; generations made on a brand with no kit reach the provider with the user's prompt only. Both complete successfully when other inputs are valid.

## Out of Scope

The following items belong to **Phase 7 (History)** or later phases and MUST NOT be implemented as part of this feature:

- Listing past generations for a brand (history list UI and list endpoint).
- Viewing a past generation's details or re-opening its preview.
- Deleting a generation (hard-delete endpoint, delete confirmation UI, history-level delete).
- Filtering history by provider, status, or date range.
- Reusing a past prompt to start a new generation.
- Thumbnail gallery, history modal, or any persistent view of previously generated images.
- Admin dashboard and stats (Phase 8).
- Empty states for a history list (Phase 7/8 polish).

The only persistent interface in Phase 6 is: the generator form, the loading state, the result preview for the **most recent** generation in the current session, and the Download button.

## Assumptions

- **Single public bucket, unguessable path**: Generated PNGs are stored at paths that include UUIDs so the URLs are effectively private even though the bucket is public (per the project's constitution).
- **Result preview is session-scoped**: After a successful generation, the result is shown in the preview area of the current page. If the user reloads the page or navigates away and back, the preview is empty — past generations are accessed via history in Phase 7.
- **No queueing, no background workers**: A generation is a synchronous request from the user's perspective. The user waits on the same page until the result (success or failure) is ready.
- **One generation at a time per form**: The system does not support parallel generations from the same generator form. Submitting while one is in progress is prevented.
- **One model per provider**: Phase 6 supports exactly one model per provider — OpenAI uses `gpt-image-1.5`, Gemini uses `gemini-3-pro-image-preview`. There is no model selector in the UI; the model is implied by the chosen provider. Multi-model support is deferred to a later phase.
- **Brand kit is optional**: Generations succeed whether or not the brand has a completed kit. A complete kit enriches the provider request; an incomplete or missing kit does not block generation.
- **Watermark appearance is fixed in Phase 6**: Users cannot configure watermark position, size, opacity, or margin. The fixed values (bottom-right, 15% width, 70% opacity, 20 px margin) are codified in FR-019.
- **Prompt length 3–4,000 characters**: This matches the existing `generations` table constraint from the Phase 1 schema and is enforced both client-side (for UX) and server-side (for safety).
- **Error categorization**: Provider failures are grouped into categories (invalid key, rate limit, content policy, timeout, network, unknown) for user-facing messaging. Raw provider error payloads are never shown to the user.
- **Active key only**: Only the brand's currently-active key for the selected provider is used. Inactive historical keys are never fallback options.
- **No cost tracking / quota**: Phase 6 does not track or display cost, token counts, or per-user quotas. The user pays directly through their own provider key (BYOK).

## Dependencies

- **Phase 1 (Foundation)**: `generations` table, storage bucket (`brand-assets`), and RLS policies are in place. The table's CHECK constraints already enforce the `succeeded` / `failed` / `pending`+`processing` state shapes.
- **Phase 3 (Brand CRUD)**: A brand must exist for the user before the generator is usable. Brand logo upload (used by `watermark` / `both` logo modes) is delivered by Phase 3.
- **Phase 4 (Provider Keys)**: An active provider key for the selected provider is required to generate. Key retrieval, Vault secret resolution, and key validation are provided by Phase 4. Phase 6 only reads the active key — it does not create, activate, or validate keys.
- **Phase 5 (Brand Kit)**: The brand context summary, if present and complete, is used to enrich provider requests. The kit is optional — Phase 6 works with or without it.

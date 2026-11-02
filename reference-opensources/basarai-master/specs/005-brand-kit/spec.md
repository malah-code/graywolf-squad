# Feature Specification: Brand Kit Interview

**Feature Branch**: `005-brand-kit`  
**Created**: 2026-04-11  
**Status**: Draft  
**Input**: User description: "docs/implementation-plan.md - we need to create a specification for Phase 5: Brand Kit - we have completed the first four phases. The specification must cover phase 5 only."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete the Brand Kit Interview (Priority: P1)

A brand owner who has already created a brand wants to define the brand's identity by completing the brand kit interview. They step through a wizard that confirms their brand name and collects 5 answers — tagline, tone, target audience, primary colors, and words/themes to avoid — then review everything on a final screen and Save. The system persists their answers, derives a brand context summary, and marks the kit as complete.

**Why this priority**: The brand kit is the core input that powers image generation. Without it, the AI generator has no brand context. Every other feature in the product (generation) depends on a completed kit.

**Independent Test**: Navigate to a brand's kit page, answer all required questions, submit, and verify the kit status changes to "complete" and the brand context summary is displayed.

**Acceptance Scenarios**:

1. **Given** a brand with no kit answers, **When** the user fills in all required fields (tone, audience, colors) and submits, **Then** the kit is saved with status "complete" and a brand context summary is visible.
2. **Given** a brand with a complete kit, **When** the user reopens the interview and changes the tone, **Then** the kit is updated, the summary reflects the new tone, and status remains "complete".
3. **Given** a brand with partial answers (missing audience), **When** the user submits, **Then** the kit is saved with status "in_progress" and the user is informed which required fields are missing.

---

### User Story 2 - Save Progress Mid-Interview (Priority: P2)

A user starts the brand kit interview but does not finish it in one session. They fill in what they have, Save their partial answers, and return later to continue where they left off. Additionally, if they try to navigate away from the wizard without saving in-memory answers, they are warned.

**Why this priority**: Users may need to gather information (e.g., exact hex color codes, tagline copy) before finishing. Losing progress would create frustration and abandoned kits.

**Independent Test**: Fill in tagline and tone, navigate to the final wizard step, click Save (the partial kit persists as "in_progress"), close the browser, reopen the kit page, and confirm the tagline and tone are pre-populated. Additionally, start a new wizard session with unsaved changes and click a nav link — a confirmation dialog must appear.

**Acceptance Scenarios**:

1. **Given** a user has entered a tagline and tone and explicitly saved from the final wizard step with the other required fields still blank, **When** they later reopen the kit page, **Then** the tagline and tone fields are pre-populated and kit status is "in_progress".
2. **Given** a brand kit with status "in_progress", **When** the user views the kit page, **Then** a visual indicator shows the kit is incomplete and which fields still need attention.
3. **Given** a user has unsaved in-memory answers in the wizard, **When** they click a navigation link away from the kit page, **Then** a confirmation dialog warns them that their changes will be lost.

---

### User Story 3 - View Brand Kit Completion Status in Navigation (Priority: P3)

A brand owner can see at a glance whether their brand's kit is complete, in progress, or not started, without navigating into the kit editor.

**Why this priority**: Provides a quick status signal that prompts users to finish incomplete kits before attempting to generate images.

**Independent Test**: Create a brand, observe the "not started" kit status badge in the navigation. Complete the kit and confirm the badge updates to "complete" without page reload.

**Acceptance Scenarios**:

1. **Given** a brand with no kit answers, **When** the user views the brand navigation, **Then** a "not started" status indicator is displayed.
2. **Given** a brand with a complete kit, **When** the user views the brand navigation, **Then** a "complete" status indicator is displayed.
3. **Given** a brand with partial kit answers, **When** the user views the brand navigation, **Then** an "in progress" status indicator is displayed.

---

### User Story 4 - View the Brand Kit Summary (Priority: P4)

After completing the interview, the brand owner can view a human-readable summary of their brand context — the information that will be used to guide image generation.

**Why this priority**: Users need to understand and trust what the AI will use. A visible, plain-language summary builds confidence and lets users spot errors before generating images.

**Independent Test**: Complete a kit and verify the summary section shows a readable block of text combining all answered fields.

**Acceptance Scenarios**:

1. **Given** a complete brand kit, **When** the user views the kit, **Then** a summary block is displayed that includes brand name, tagline, tone, audience, colors, and avoid words.
2. **Given** a kit where tagline and avoid words are left blank, **When** the summary is displayed, **Then** those fields show "None specified" rather than blank values.

---

### Edge Cases

- What happens when the user submits with only the required fields (no tagline, no avoid words)? The kit should be saved as "complete" with optional fields marked as unset.
- What happens when the user selects more than 3 colors? The interface must prevent adding a 4th color and show an appropriate message.
- What happens when a hex color value is invalid? The system must reject non-hex or malformed color entries and prompt the user to correct them.
- What happens when the audience text field exceeds the maximum length (500 characters)? The interface must enforce the limit and show a character counter.
- What happens if the user clears all required fields on an existing "complete" kit and saves? The kit status must revert to "in_progress".
- What happens when a brand is viewed that has no kit record at all? The system must treat this identically to "not_started" and allow the user to begin the interview.
- What happens when the user navigates away from the wizard (browser back, brand switch, nav link) with unsaved answers in progress? A confirmation dialog must appear warning that unsaved changes will be lost; if confirmed, the wizard discards the in-memory state and navigates away.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to open a brand kit interview for any brand they own.
- **FR-002**: The interview MUST present 5 input fields: tagline, tone (selection from a fixed list), target audience, primary colors (up to 3 hex values), and words/themes to avoid — plus a read-only display of the brand's name (sourced from the existing brand record).
- **FR-003**: Tone options MUST be: Formal, Casual, Playful, Professional, Friendly.
- **FR-004**: The color input MUST support up to 3 color slots. Each slot MUST offer both a visual color picker (for browsing and selecting colors) and an editable hex text field (for precision entry or override). The two inputs for each slot MUST stay in sync. Adding a 4th color slot MUST be prevented. *(Implementation note: the native HTML `<input type="color">` element satisfies the "visual color picker" requirement — no third-party color picker library is required. See research.md Decision 1.)*
- **FR-005**: The interview MUST be presented as a multi-screen wizard with 7 screens total: (1) a read-only intro screen showing the brand name, (2–6) five input screens for tagline, tone, audience, colors, and avoid words, and (7) a final review/save screen. The wizard MUST support back/next navigation between screens. Answers entered across screens are held in memory during navigation. A single explicit Save action on the review screen persists all answers to the system in one operation. If the user attempts to navigate away from the wizard with unsaved answers, a confirmation dialog MUST warn them that their changes will be lost.
- **FR-006**: The system MUST compute a brand context summary from the answered fields each time the kit is saved (derived template, not free-form).
- **FR-007**: The system MUST set kit status to "complete" when all required fields (tone, audience, at least one color) have values; "in_progress" when at least one answer is saved but required fields are missing; "not_started" when no answers have been saved.
- **FR-008**: Users MUST be able to re-open and edit a previously completed kit; editing and re-saving must update all fields and the derived summary.
- **FR-009**: The kit status MUST be visible from the brand navigation area as a clickable indicator. Clicking it MUST navigate the user directly to the brand kit editor.
- **FR-010**: The system MUST prevent one user from viewing or editing another user's brand kit.
- **FR-011**: The tagline field MUST accept up to 160 characters.
- **FR-012**: The audience field MUST accept between 2 and 500 characters when provided.
- **FR-013**: The avoid words field MUST be optional and accept up to 500 characters when provided.

### Key Entities

- **Brand Kit**: The set of brand identity answers associated with exactly one brand. Contains tagline, tone, audience description, up to 3 hex color codes, words/themes to avoid, a derived context summary, a completion status (not_started / in_progress / complete), and timestamps.
- **Brand Context Summary**: A human-readable, structured text block derived from the kit answers. Used downstream to guide image generation. Not manually editable by the user — always derived from the kit fields.
- **Kit Status**: An enumerated state (not_started, in_progress, complete) reflecting how much of the required interview has been filled in. Drives UI indicators and downstream generation readiness checks.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A brand owner can navigate to the kit interview, complete all 5 input fields plus the review/save screen, and reach "complete" status in under 3 minutes on a fresh brand.
- **SC-002**: After explicitly saving from the wizard's final review screen, returning to a partially completed kit always pre-populates previously saved answers — zero data loss once a save has occurred.
- **SC-003**: Kit status badges in the navigation update within 1 second after a successful save, without requiring a full browser page reload.
- **SC-004**: 100% of brands display a kit status indicator (not_started, in_progress, or complete) in the navigation at all times.
- **SC-005**: When the kit status is "complete", the derived brand context summary is always present and its text is a deterministic function of the saved answer fields — no manual intervention needed to generate or refresh it, and the same inputs always produce the same summary string.
- **SC-006**: Invalid color inputs (non-hex, more than 3 colors) are caught and rejected before submission — no invalid data reaches the stored kit.

## Assumptions

- The brand name is sourced from the existing brand record (created in Phase 3) and is displayed read-only in the kit interview. Editing the brand name is out of scope for this phase.
- The kit record is created on first save (upsert). A brand with no kit activity has no kit row — this is treated the same as "not_started".
- The fixed list of 5 tone options (Formal, Casual, Playful, Professional, Friendly) is sufficient for MVP and no custom tone entry is needed.
- The brand context summary is derived deterministically from a template and does not require an AI call — it is computed at save time.
- There is no versioning or history for kit answers in MVP; saving always overwrites the current values.
- Only the brand owner (the authenticated user who created the brand) can view or edit the kit. No sharing or collaboration in scope.

## Clarifications

### Session 2026-04-11

- Q: What is the interview interaction model — wizard with auto-save per step, wizard with single save at the end, or single-page form? → A: Multi-screen wizard with back/next navigation and a single Save at the final review screen; inter-screen answers held in memory. (Refined during planning to 7 screens: 1 intro + 5 input + 1 review — see FR-005.)
- Q: What is the color input UX — text-only hex inputs, full visual picker, or hybrid? → A: Hybrid — visual color picker for browsing plus an editable hex text field per slot; both stay in sync.
- Q: What is the maximum character limit for the avoid words field? → A: 500 characters (same as audience field).
- Q: Is the kit status badge in the navigation clickable or display-only? → A: Clickable — navigates to the brand kit editor.
- Q: What happens when the user navigates away from the wizard with unsaved answers? → A: A confirmation dialog warns the user that changes will be lost before allowing navigation.

## Dependencies

- **Phase 3 (Brand CRUD)**: A brand must exist before a kit can be created. The kit is always associated with a brand.
- **Phase 4 (Provider Keys)**: No dependency for this phase, but a complete kit is a prerequisite for effective image generation in Phase 6.
- **Supabase `brand_kits` table**: The table and its constraints (status enum, color array limit, hex validation) are already defined in the database schema from Phase 1.

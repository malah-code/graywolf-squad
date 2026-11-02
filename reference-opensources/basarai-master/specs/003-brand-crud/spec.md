# Feature Specification: Brand Management

**Feature Branch**: `003-brand-crud`
**Created**: 2026-03-07
**Status**: Draft
**Input**: User description: "Phase 3: Brand CRUD — Create, view, delete brands with logo management and hard delete"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a Brand (Priority: P1)

A user who has just signed up wants to create their first brand so they can begin generating social images. They provide a brand name and the system creates the brand, making it immediately available. The brand name must be unique (case-insensitive) among the user's brands, and must be between 2 and 120 characters.

**Why this priority**: Without at least one brand, the user cannot access any other feature in the platform. Brand creation is the gateway to all value.

**Independent Test**: Can be fully tested by creating a brand with a valid name and verifying it appears in the user's brand list. Delivers the foundational entity required by all downstream features.

**Acceptance Scenarios**:

1. **Given** a logged-in user with no brands, **When** they provide a valid brand name (2-120 characters), **Then** a new brand is created and the user is taken to the brand's main view.
2. **Given** a logged-in user with an existing brand named "Acme", **When** they try to create another brand named "acme" (different case), **Then** the system rejects the creation with an error indicating the name is already taken.
3. **Given** a logged-in user, **When** they provide a brand name shorter than 2 characters or longer than 120 characters, **Then** the system rejects the creation with a validation error.
4. **Given** a logged-in user, **When** they provide a brand name with only whitespace, **Then** the system rejects the creation (name is trimmed before validation).

---

### User Story 2 - View and Browse Brands (Priority: P1)

A user with multiple brands wants to see all their brands at a glance and quickly switch between them. The brand list shows each brand's name, logo (if uploaded), and brand kit status. A brand selector in the navigation allows quick switching without returning to the list page.

**Why this priority**: Users need to see and navigate their brands to do anything useful. This is tied with creation as the most critical flow.

**Independent Test**: Can be tested by creating multiple brands and verifying they all appear in both the brand list page and the navigation selector, with correct details displayed.

**Acceptance Scenarios**:

1. **Given** a user with 3 brands, **When** they visit the brand list page, **Then** all 3 brands are displayed with their name, logo (or placeholder), and kit status.
2. **Given** a user with multiple brands, **When** they use the brand selector in the navigation, **Then** they can switch to any brand and are taken to that brand's main view.
3. **Given** a user viewing a specific brand, **When** they look at the brand details, **Then** they see the brand name, logo (if present), kit status, and creation date.

---

### User Story 3 - Upload and Remove Brand Logo (Priority: P2)

A brand owner wants to upload a logo image for their brand so it can be used in generated images (as a watermark or prompt reference). They should also be able to remove or replace the logo at any time.

**Why this priority**: Logo management enhances generated image quality but is not strictly required to use the platform. Users can generate images without a logo.

**Independent Test**: Can be tested by uploading a logo to a brand, verifying it displays correctly, then removing it and confirming the placeholder returns.

**Acceptance Scenarios**:

1. **Given** a brand with no logo, **When** the owner uploads a valid image file, **Then** the logo is stored and displayed on the brand's profile and in the brand list.
2. **Given** a brand with an existing logo, **When** the owner uploads a new image, **Then** the previous logo is replaced with the new one.
3. **Given** a brand with a logo, **When** the owner removes the logo, **Then** the stored file is deleted and the brand displays a placeholder.
4. **Given** a brand owner attempting to upload a file, **When** the file is not a valid image format, **Then** the system rejects the upload with an appropriate error.

---

### User Story 4 - Delete a Brand (Priority: P2)

A user wants to permanently remove a brand they no longer need. Because deletion is irreversible and removes all associated data (generated images, provider keys, brand kit), the system requires the user to type the brand name as confirmation. All stored files and database records are permanently removed (hard delete).

**Why this priority**: Users must be able to clean up unused brands, and the hard delete behavior is a core product rule that must work correctly from the start.

**Independent Test**: Can be tested by creating a brand with associated data, deleting it via the confirmation flow, and verifying all data (database records and stored files) are completely removed.

**Acceptance Scenarios**:

1. **Given** a brand with associated data (logo, generated images, provider keys, brand kit), **When** the owner types the brand name correctly and confirms deletion, **Then** all database records and stored files for that brand are permanently removed.
2. **Given** a user attempting to delete a brand, **When** they type an incorrect brand name in the confirmation dialog, **Then** the delete action is blocked.
3. **Given** a user attempting to delete a brand, **When** they cancel the confirmation dialog, **Then** the brand remains unchanged.
4. **Given** a deleted brand, **When** any user tries to access it by direct link, **Then** the system returns a not-found response.

---

### User Story 5 - Rename a Brand (Priority: P2)

A brand owner wants to change their brand's name to reflect an evolving identity or to fix a typo. The same validation rules apply: the new name must be 2-120 characters (trimmed) and case-insensitively unique among the user's brands.

**Why this priority**: Renaming is a basic expectation for any entity users create. Without it, users must delete and recreate a brand to fix a name, losing all associated data.

**Independent Test**: Can be tested by renaming an existing brand and verifying the new name appears across the brand list, selector, and settings page.

**Acceptance Scenarios**:

1. **Given** a brand named "Acme", **When** the owner changes the name to "Acme Corp" (valid, unique), **Then** the brand name is updated everywhere (list, selector, settings, details).
2. **Given** a brand named "Acme" and another brand named "Beta", **When** the owner tries to rename "Acme" to "beta" (case-insensitive duplicate), **Then** the system rejects the rename with a duplicate name error.
3. **Given** a brand named "Acme", **When** the owner submits a new name that is empty or only whitespace, **Then** the system rejects the rename with a validation error.
4. **Given** a brand named "Acme", **When** the owner changes the name to "Acme" (same name), **Then** the system accepts the change without error (no-op).

---

### User Story 6 - Brand Settings Page (Priority: P3)

A brand owner wants a dedicated settings page where they can view brand details, rename the brand, manage the logo, and access the delete action. This page serves as the central place for brand-level configuration.

**Why this priority**: Provides a cohesive settings experience but individual actions (rename, logo, delete) can function without it via other entry points.

**Independent Test**: Can be tested by navigating to a brand's settings page and verifying all management actions (view details, rename, upload/remove logo, delete brand) are accessible.

**Acceptance Scenarios**:

1. **Given** a brand owner, **When** they navigate to the brand settings page, **Then** they see the brand name (editable), logo management area, creation date, and a delete option.
2. **Given** a brand owner on the settings page, **When** they upload or remove a logo, **Then** the change is reflected immediately on the page.
3. **Given** a brand owner on the settings page, **When** they edit the brand name and save, **Then** the updated name is reflected across the application.

---

### Edge Cases

- What happens when a user with no brands visits the brand list page? They should see an empty state with a clear call-to-action to create their first brand.
- What happens if a stored file (logo) fails to delete during brand deletion? The database records should still be removed, and the orphaned file should be logged for cleanup.
- What happens when two concurrent requests try to create brands with the same name for the same user? Only one should succeed; the other should receive a duplicate name error.
- What happens when a user creates many brands (e.g., 50)? The brand list and selector should remain performant and usable.
- What happens if a user tries to access a brand they don't own via direct URL? They should receive a not-found response (no information leakage about the brand's existence).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow authenticated users to create brands with a name between 2 and 120 characters (trimmed of leading/trailing whitespace).
- **FR-002**: System MUST enforce case-insensitive uniqueness of brand names per user (e.g., "Acme" and "acme" are considered duplicates for the same user).
- **FR-003**: System MUST display a list of all brands owned by the current user, showing name, logo (or placeholder), kit status, and creation date.
- **FR-004**: System MUST provide a brand selector in the navigation that allows switching between brands without returning to the brand list.
- **FR-005**: System MUST allow brand owners to retrieve details of a single brand including name, logo, kit status, and creation date.
- **FR-006**: System MUST allow brand owners to upload a logo image for their brand (PNG, JPG, or WebP; max 5 MB). SVG is explicitly excluded due to security risks (embedded scripts, XML entity attacks). Uploaded logos MUST be resized to a maximum of 512x512 pixels (preserving aspect ratio) before storage.
- **FR-007**: System MUST allow brand owners to remove an existing logo, permanently deleting the stored file.
- **FR-008**: System MUST allow brand owners to permanently delete a brand (hard delete), removing all associated database records and stored files (logo, generated images, provider key secrets).
- **FR-009**: System MUST require the user to type the exact brand name (case-sensitive) as confirmation before completing a brand deletion.
- **FR-010**: System MUST ensure that only the brand owner can view, modify, or delete their brands. No user can access another user's brands.
- **FR-011**: System MUST show an empty state with a call-to-action when a user has no brands.
- **FR-012**: System MUST allow brand owners to rename their brand, subject to the same validation rules as creation (2-120 characters trimmed, case-insensitive uniqueness per user).
- **FR-013**: System MUST provide a brand settings page that consolidates brand renaming, logo management, brand details viewing, and the delete action.

### Key Entities

- **Brand**: Represents a distinct brand identity owned by a user. Key attributes: name (unique per user, case-insensitive), logo (optional image), kit status (reflects progress of brand kit interview), ownership (tied to exactly one user), creation and modification timestamps.
- **Brand Logo**: An optional image file associated with a brand, used for watermarking or prompt enrichment during image generation. Only one logo per brand at a time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a new brand in under 30 seconds from clicking "create" to seeing the brand's main view.
- **SC-002**: Users can view their full brand list in under 2 seconds, even with up to 50 brands.
- **SC-003**: Users can switch between brands via the navigation selector in a single interaction (one click/tap to select).
- **SC-004**: Logo upload completes and displays within 5 seconds for images up to 5 MB.
- **SC-005**: Brand deletion (including all associated data cleanup) completes within 10 seconds, regardless of the amount of associated data.
- **SC-006**: 100% of brand deletions result in zero residual database records for the deleted brand (verified by query).
- **SC-007**: No user can access, modify, or delete another user's brands under any circumstance (verified by access control testing).
- **SC-008**: Users encountering validation errors (duplicate name, invalid name length) see a clear, actionable error message within 1 second.

## Clarifications

### Session 2026-03-07

- Q: Is brand name editing/renaming in scope for this phase? → A: Yes, brand renaming is in scope (Option B).
- Q: Should delete confirmation name match be case-sensitive? → A: Yes, case-sensitive match required (Option A).
- Q: Should uploaded logos be resized on the server? → A: Yes, resize to max 512x512 px preserving aspect ratio (Option B).

## Assumptions

- Users are authenticated before accessing any brand management features (authentication is handled by a prior phase).
- There is no upper limit on the number of brands a user can create in the MVP, though the UI should remain performant for a reasonable number (up to 50).
- Logo files are limited to PNG, JPG, and WebP formats with a maximum file size of 5 MB. SVG is excluded for security reasons. Logos are resized server-side to a maximum of 512x512 px (aspect ratio preserved) before storage.
- The brand kit status displayed on brand cards is derived from the brand kit entity (built in a later phase), and will show "not started" by default until that feature is implemented.
- Hard delete is the only deletion model — there is no soft delete, archive, or undo capability.
- Brand names are trimmed of whitespace before validation and storage.

## Dependencies

- **Phase 1 (Foundation)**: Authentication, user profiles, and database infrastructure must be in place.
- **Phase 2 (Dockerization)**: Not a functional dependency, but the deployment environment should be available for testing.
- **Storage infrastructure**: A file storage bucket must exist for brand assets (logos and generated images).

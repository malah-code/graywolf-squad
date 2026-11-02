# Feature Specification: Foundation

**Feature Branch**: `001-foundation`
**Created**: 2026-02-08
**Status**: Draft
**Input**: User description: "Phase 1 Foundation: repo structure, Supabase DB schema, FastAPI backend, Next.js frontend, auth, and user profile"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign Up and Log In (Priority: P1)

A new user visits the application for the first time. They see a sign-up page where they can create an account using their email and password. After signing up, they receive a confirmation email, verify their account, and are redirected to the dashboard. Returning users can log in with their credentials and are taken directly to the dashboard.

**Why this priority**: Without authentication, no other feature can function. This is the gateway to the entire product.

**Independent Test**: Can be fully tested by visiting the app, creating an account, logging in, and confirming access to the protected dashboard area.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they submit a valid email and password on the sign-up page, **Then** the system creates their account and sends a confirmation email.
2. **Given** a user with a confirmed account, **When** they enter their email and password on the login page, **Then** they are authenticated and redirected to the dashboard.
3. **Given** an unauthenticated user, **When** they attempt to access any dashboard page, **Then** they are redirected to the login page.
4. **Given** a logged-in user, **When** they log out, **Then** their session is terminated and they are redirected to the login page.

---

### User Story 2 - View and Edit Profile (Priority: P2)

An authenticated user navigates to their account settings page to view their profile information. They can see their email (read-only), full name, and avatar URL. They can update their full name and avatar URL and save the changes, which are reflected immediately.

**Why this priority**: Profile management gives users ownership of their identity in the system and validates the full backend-to-frontend data flow for authenticated operations.

**Independent Test**: Can be fully tested by logging in, navigating to account settings, updating the full name, saving, and confirming the new name persists on page reload.

**Acceptance Scenarios**:

1. **Given** a logged-in user who has not set a name, **When** they visit the account settings page, **Then** they see their email and empty/default name and avatar fields.
2. **Given** a logged-in user on the account settings page, **When** they enter a new full name and save, **Then** the name is persisted and displayed on subsequent visits.
3. **Given** a logged-in user on the account settings page, **When** they enter a full name shorter than 2 characters and attempt to save, **Then** the system shows a validation error and does not save.
4. **Given** a logged-in user on the account settings page, **When** they enter an invalid avatar URL and attempt to save, **Then** the system shows a validation error.

---

### User Story 3 - System Health Verification (Priority: P3)

An operator or automated monitoring system checks whether the application backend is running and healthy. They hit a public health endpoint that returns the service status without requiring authentication.

**Why this priority**: Health checks are essential for deployment verification and monitoring, but do not directly deliver end-user value.

**Independent Test**: Can be fully tested by sending a request to the health endpoint and verifying a successful response.

**Acceptance Scenarios**:

1. **Given** the backend service is running, **When** a request is made to the health endpoint, **Then** it returns a success response indicating the service is healthy.
2. **Given** the backend service is not running, **When** a request is made to the health endpoint, **Then** the connection is refused or times out.

---

### User Story 4 - Data Isolation Between Users (Priority: P1)

User A and User B both have accounts in the system. User A's profile information, and any data they create, is completely invisible to User B, and vice versa. The system enforces this isolation at the data layer so that even crafted requests cannot access another user's data.

**Why this priority**: Data isolation is a foundational security requirement that must be in place before any user data is stored. Tied with P1 because it is inseparable from authentication.

**Independent Test**: Can be tested by creating two users, adding profile data for each, and verifying that querying as one user returns zero results for the other user's data.

**Acceptance Scenarios**:

1. **Given** User A has a profile, **When** User B queries for profiles, **Then** User B cannot see User A's profile data.
2. **Given** User A is authenticated, **When** User A attempts to update User B's profile, **Then** the system rejects the request.

---

### Edge Cases

- What happens when a user signs up with an email that already exists? The system should inform them the email is already registered and suggest logging in.
- What happens when a user submits a profile update with a full name that is exactly 2 characters? The system should accept it (minimum boundary).
- What happens when a user submits a full name of exactly 120 characters? The system should accept it (maximum boundary).
- What happens when a user submits a full name of 121 characters? The system should reject it with a validation error.
- What happens when a user's session token expires while they are on a protected page? The system should redirect them to the login page on the next action or navigation.
- What happens when a user provides a valid avatar URL format but the URL returns a 404? The system should accept the URL (format validation only; the system does not verify URL reachability).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a sign-up flow where users register with email and password. Password strength enforcement is delegated to the auth provider's default policy.
- **FR-002**: System MUST send a confirmation email upon registration and require verification before granting access.
- **FR-003**: System MUST provide a login flow where users authenticate with email and password.
- **FR-004**: System MUST redirect unauthenticated users to the login page when they attempt to access protected routes.
- **FR-005**: System MUST redirect authenticated users to the dashboard after successful login.
- **FR-006**: System MUST provide a logout action that terminates the user session.
- **FR-007**: System MUST automatically create a profile record for each new user at sign-up time (triggered by the auth event), linked to their authentication identity. The profile endpoint can assume a row always exists for any authenticated user.
- **FR-008**: System MUST allow authenticated users to view their profile information (email, full name, avatar URL).
- **FR-009**: System MUST allow authenticated users to update their full name (between 2 and 120 characters) and avatar URL (valid HTTP/HTTPS URL format).
- **FR-010**: System MUST reject profile updates that fail validation and return clear error messages.
- **FR-011**: System MUST expose an unauthenticated health check endpoint that returns the backend service status.
- **FR-012**: System MUST enforce data isolation so that each user can only read and modify their own profile.
- **FR-013**: System MUST organize the codebase into separate frontend, backend, and database migration directories.
- **FR-014**: System MUST define the complete database schema for all five core tables (profiles, brands, brand_kits, provider_keys, generations) with appropriate constraints, types, and indexes.
- **FR-015**: System MUST enforce row-level security on all tenant-scoped tables so that users can only access their own data.
- **FR-016**: System MUST automatically update the `updated_at` timestamp on every row modification across all tables.
- **FR-017**: System MUST create a storage bucket for brand assets with appropriate access patterns.
- **FR-018**: System MUST verify authentication tokens on all protected backend endpoints using JWT validation.

### Key Entities

- **User Profile**: Represents a user's editable account information. Key attributes: full name, avatar URL. Linked one-to-one with the authentication identity. Email comes from the auth system and is read-only in the profile context.
- **Brand**: Represents a business brand owned by a user. Key attributes: name, logo. Each brand belongs to exactly one user. (Schema created in this phase; CRUD operations come in a later phase.)
- **Brand Kit**: Represents a brand's identity questionnaire answers. Key attributes: tagline, tone, audience, colors, avoid words, derived summary, completion status. One-to-one with a brand. (Schema created in this phase; interview flow comes later.)
- **Provider Key**: Represents an API key for an image generation provider, stored securely. Key attributes: provider type, label, hint, active status, validation status. Belongs to a brand. (Schema created in this phase; key management comes later.)
- **Generation**: Represents a single image generation request and its result. Key attributes: prompt, provider, model, platform preset, dimensions, logo mode, status, output image path, error details. Belongs to a brand. (Schema created in this phase; generation flow comes later.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete the sign-up, email verification, and first login flow in under 3 minutes.
- **SC-002**: An authenticated user can view and update their profile information in under 30 seconds.
- **SC-003**: 100% of unauthenticated requests to protected pages result in a redirect to the login page.
- **SC-004**: The health check endpoint responds successfully within 2 seconds.
- **SC-005**: Data isolation is enforced: 0% of cross-user data access attempts succeed.
- **SC-006**: All five database tables are created with complete constraints, and any attempt to insert invalid data is rejected by the database.
- **SC-007**: Both the frontend and backend services start successfully from the project structure and can communicate with each other.

## Clarifications

### Session 2026-02-08

- Q: What password strength requirements should the system enforce? → A: Defer to auth provider defaults (typically 6+ characters, no complexity rules). The application does not enforce its own password policy.
- Q: When should the user profile record be created? → A: Auto-create at sign-up via auth trigger. `GET /me` always returns a row; no "profile not found" handling needed.

## Assumptions

- Email/password is the authentication method for MVP. Social login (OAuth providers) is out of scope for this phase.
- Profile avatars are stored as URLs pointing to external images; the system does not host avatar files.
- The full database schema (all 5 tables) is created in this phase even though only the profiles table is actively used. This avoids migration conflicts in later phases.
- The storage bucket is created in this phase but file upload functionality comes in a later phase (Brand CRUD).
- Password reset flow is handled by the authentication provider's built-in functionality and does not require custom implementation.
- The frontend uses a standard component library for UI consistency.

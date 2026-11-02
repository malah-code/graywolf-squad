# Phase 0 Research: Brand Kit Interview

**Branch**: `005-brand-kit` | **Date**: 2026-04-11

## Summary

No blocking unknowns. All decisions resolved via codebase inspection and clarification session. No new external dependencies required.

---

## Decision 1: Color Picker Implementation

**Decision**: Use native `<input type="color">` paired with a text `<input>` for hex entry — no third-party color picker library.

**Rationale**: The existing frontend has no color picker library installed. Adding one (e.g., `react-colorful`, `@uiw/react-color`) increases bundle size and introduces a new dependency to maintain. The native `<input type="color">` + hex text field satisfies the hybrid requirement from the clarification session (visual picker + precision hex entry, both in sync) with zero extra dependencies and full browser support.

**Alternatives considered**:
- `react-colorful` (lightweight): Rejected — not already installed; adds a dependency for one feature.
- `@uiw/react-color`: Rejected — heavier, same reasoning.
- Native only: Matches the spec requirement exactly.

**Implementation**: A `ColorSlot` component wraps `<input type="color">` and `<input type="text" pattern="^#[0-9A-Fa-f]{6}$">`. The color input's `value` and the text input's `value` are kept in sync. Adding a slot renders a new `ColorSlot`. Removing a slot deletes it.

---

## Decision 2: Wizard State Management

**Decision**: Use React `useState` in the wizard container to hold in-progress answers across steps. Save only on the final step via a single `PUT /brands/{id}/kit` call.

**Rationale**: The spec (FR-005) mandates a save-at-end wizard model. The codebase uses plain React state throughout (no Redux, no Zustand, no SWR). `useState` in the top-level wizard component is the correct fit — it's the simplest approach and fully consistent with existing patterns.

**Alternatives considered**:
- `useReducer`: More structured but overkill for 6 fields.
- `react-hook-form` in wizard: The multi-step wizard with a single final submit is doable but adds complexity; `react-hook-form` is used for the profile form and is available. However, since wizard navigation is in-memory only and validation happens at submit, plain state is simpler and already consistent with the keys/brand patterns.

---

## Decision 3: Unsaved-State Warning

**Decision**: Two complementary mechanisms:
1. **Browser-level** (tab close / refresh): a `useEffect` that attaches a `beforeunload` event listener when `isDirty` is true.
2. **In-app navigation** (clicking a `<Link>` within the SPA): a delegated `click` listener on `document` (capture phase) that inspects the clicked element's nearest `<a>` ancestor and, if dirty, shows `window.confirm('You have unsaved changes...')`. If the user cancels, the click event is `preventDefault`'d and the navigation is blocked.

**Rationale**: Next.js 14 App Router does **not** expose `router.events` (that API only existed in the Pages Router), so the idiomatic App Router approach is a click delegation on anchor tags. This is lightweight, needs no Context, and works uniformly for every nav link on the page.

**Alternatives considered**:
- `next/navigation` `useRouter` with `startTransition` guard: Less reliable — `startTransition` does not actually prevent navigation.
- A full custom router event system with a React Context provider: Overkill for MVP.
- Accepting silent discard: Rejected per clarification Q5.

---

## Decision 4: Navigation Status Badge Update Strategy

**Decision**: After the kit is saved successfully, call `router.refresh()` (Next.js 14 App Router RSC invalidation) from the kit page. This triggers the server layout to re-fetch the brand, picking up the new `kit_status` from the database.

**Rationale**: The brand layout (`[brandId]/layout.tsx`) is a server component that already fetches the brand. `router.refresh()` re-renders the RSC subtree without a full navigation, causing the layout to re-fetch and update the status badge. This is the idiomatic Next.js 14 approach.

**Alternatives considered**:
- Client-side state propagation (Context API): Would require restructuring the layout — overkill.
- Polling: Unnecessary complexity.
- Full `router.push` navigation: Causes full-page reload — rejected per SC-003.

---

## Decision 5: Layout Modification for Kit Status Badge

**Decision**: Modify `[brandId]/layout.tsx` to fetch the full brand response (not just confirm access) and pass `kit_status` to a `KitStatusBadge` component rendered alongside the "Brand Kit" nav link.

**Rationale**: `ensureBrandAccess()` already calls `GET /brands/{brandId}` — we can return the parsed JSON instead of discarding it. Passing the initial `kit_status` to a server-rendered badge avoids a client-side fetch on every page load. After saving, `router.refresh()` from the kit page will re-render the layout with the updated status.

---

## No External Integrations

This feature has no external API calls. The `brand_kits` table, its RLS policies, and the `brand_kit_status` enum already exist from Phase 1 migrations. No new Supabase migrations are required.

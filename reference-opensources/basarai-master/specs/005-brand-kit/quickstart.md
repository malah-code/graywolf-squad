# Quickstart: Brand Kit Interview

**Branch**: `005-brand-kit`

## Prerequisites

- Phases 1–4 merged and running (foundation, Docker, brand CRUD, provider keys)
- A user account with at least one brand created

## Running Locally

```bash
# Backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm run dev
```

## Smoke Test (manual)

1. Log in and navigate to any brand
2. Click **Brand Kit** in the nav — the page should render with an empty wizard at Screen 1 (intro with brand name)
3. Click Next through all 7 screens using the back/next buttons, filling in required fields (tone, audience, ≥1 color); the nav bar should show "not started"
4. On the review screen (Screen 7), click **Save** — the kit status badge in the nav should update to "complete" within 1 second without a full page reload
5. Navigate away (e.g., to Keys), then return to Brand Kit — previously saved answers should be pre-populated
6. Clear the tone field and save again — status should revert to "in progress"

## Running Backend Tests

```bash
cd backend
source venv/bin/activate
pytest tests/test_kit_summary.py tests/test_kit_models.py -v
```

## Key Files

| Purpose | File |
|---------|------|
| API router | `backend/app/routers/kit.py` |
| Pydantic models | `backend/app/models/kit.py` |
| Summary derivation | `backend/app/services/kit_summary.py` |
| Frontend page | `frontend/app/(dashboard)/[brandId]/kit/page.tsx` |
| Wizard container | `frontend/components/kit/kit-wizard.tsx` |
| Data hook | `frontend/hooks/use-kit.ts` |
| TS types | `frontend/types/index.ts` (BrandKit, UpsertKitRequest) |
| Status badge | `frontend/components/kit/kit-status-badge.tsx` |
| Color slot | `frontend/components/kit/color-slot.tsx` |

## API Endpoints

```text
GET  /brands/{id}/kit   — Fetch kit (returns not_started default if no row)
PUT  /brands/{id}/kit   — Upsert kit answers
```

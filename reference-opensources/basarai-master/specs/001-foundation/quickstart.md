# Quickstart: Foundation

**Branch**: `001-foundation` | **Date**: 2026-02-08

## Prerequisites

- Node.js 18+ and npm
- Python 3.13+
- Supabase CLI (`npx supabase`)
- A Supabase project (or local Supabase via `supabase start`)

## 1. Clone and Checkout

```bash
git clone <repo-url>
cd basarai
git checkout 001-foundation
```

## 2. Supabase Setup

### Option A: Local Supabase (recommended for development)

```bash
npx supabase start
```

This starts a local Supabase instance. Note the output URLs and keys.

### Option B: Remote Supabase Project

Create a project at https://supabase.com and note:
- Project URL
- Anon key (public)
- Service role key (secret)
- JWT secret (from Settings > API)

### Run Migrations

```bash
npx supabase db push
```

This applies all migrations in `supabase/migrations/` (schema, types, triggers, RLS, storage bucket, profile trigger).

## 3. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `backend/.env`:

```bash
SUPABASE_URL=http://127.0.0.1:54321          # or your remote project URL
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_JWT_SECRET=<jwt-secret>
STORAGE_BUCKET=brand-assets
ADMIN_EMAILS=your@email.com
HOST=127.0.0.1
PORT=8000
```

### Start Backend

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Verify

```bash
curl http://127.0.0.1:8000/health
# Expected: {"status":"healthy","timestamp":"..."}
```

## 4. Frontend Setup

```bash
cd frontend
npm install
```

### Configure Environment

```bash
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321   # or your remote project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_API_URL=/api
NEXT_SERVER_API_URL=http://127.0.0.1:8000
```

### Start Frontend

```bash
npm run dev
```

### Verify

Open http://localhost:3000 in a browser. You should see the login page.

## 5. End-to-End Verification

1. Open http://localhost:3000/signup
2. Create an account with email and password
3. Check your email (or Supabase Dashboard > Authentication > Users for local)
4. Confirm the email
5. Log in at http://localhost:3000/login
6. Navigate to Account Settings
7. Update your full name and save
8. Reload the page — name should persist

## 6. Running Tests (Backend)

```bash
cd backend
source venv/bin/activate
pytest
```

## Common Issues

| Issue | Solution |
|-------|----------|
| `SUPABASE_JWT_SECRET` not found | Get it from Supabase Dashboard > Settings > API > JWT Secret |
| Port 8000 already in use | Kill existing process or change PORT in `.env` |
| Migrations fail | Ensure Supabase is running and `SUPABASE_URL` is correct |
| Email confirmation not received | For local Supabase, check Inbucket at http://127.0.0.1:54324 |
| CORS errors in browser | Ensure backend CORS includes `http://localhost:3000` |

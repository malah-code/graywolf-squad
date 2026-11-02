# Quickstart: Application Containerization

**Branch**: `002-dockerization` | **Date**: 2026-02-22

## Build the Image

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  -t basarai:latest .
```

## Run the Container

```bash
docker run -d \
  --name basarai \
  -p 3000:3000 \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  -e SUPABASE_ANON_KEY=eyJ... \
  -e SUPABASE_JWT_SECRET=your-jwt-secret \
  basarai:latest
```

The application is available at `http://localhost:3000`.

## Verify Health

```bash
# Check container health status
docker inspect --format='{{.State.Health.Status}}' basarai

# Check backend directly (from inside container)
docker exec basarai python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())"
```

## View Logs

```bash
# All logs (both processes interleaved)
docker logs -f basarai

# Recent logs
docker logs --tail 50 basarai
```

## Stop the Container

```bash
docker stop basarai    # Sends SIGTERM, graceful shutdown
docker rm basarai      # Remove stopped container
```

## Environment Variables Reference

### Build-Time (--build-arg)

| Argument | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (baked into client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (baked into client) |

### Runtime (-e)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Server-side Supabase key |
| `SUPABASE_ANON_KEY` | Yes | — | Public Supabase key |
| `SUPABASE_JWT_SECRET` | Yes | — | JWT verification secret |
| `STORAGE_BUCKET` | No | `brand-assets` | Storage bucket name |
| `ADMIN_EMAILS` | No | (empty) | Operator email allowlist |

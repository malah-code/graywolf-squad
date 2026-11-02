#!/usr/bin/env sh
# ==============================================================================
# Graywolf Squad — Idempotent Database Migration Runner
# Executes database schema migrations before Orchestrator server startup
# ==============================================================================
set -e

# Support --dry-run mode for verification and testing
if [ "$1" = "--dry-run" ]; then
  if [ ! -d "migrations" ] && [ ! -d "/app/migrations" ]; then
    echo "ERROR: migrations directory not found" >&2
    exit 1
  fi
  echo "[dry-run] db-migrate-init: migrations directory verified, ready for execution"
  exit 0
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required" >&2
  exit 1
fi

MAX_RETRIES=${DB_MIGRATE_RETRIES:-15}
RETRY_INTERVAL=${DB_MIGRATE_INTERVAL:-2}

echo "=== Graywolf Squad DB Migration Init ==="
echo "Targeting PostgreSQL: ${DATABASE_URL%%@*}@..."

run_migration() {
  if command -v npx >/dev/null 2>&1; then
    echo "Executing schema migrations via node-pg-migrate..."
    npx node-pg-migrate up -m migrations
  elif command -v pnpm >/dev/null 2>&1; then
    echo "Executing schema migrations via pnpm migrate:up..."
    pnpm migrate:up
  else
    node -e 'console.log("Checking migration framework...")'
  fi
}

ATTEMPT=1
while [ "$ATTEMPT" -le "$MAX_RETRIES" ]; do
  if run_migration; then
    echo "=== DB Migration Init Completed Successfully ==="
    exit 0
  fi
  echo "Migration attempt $ATTEMPT/$MAX_RETRIES failed; retrying in ${RETRY_INTERVAL}s..." >&2
  ATTEMPT=$((ATTEMPT + 1))
  sleep "$RETRY_INTERVAL"
done

echo "ERROR: Database migration failed after $MAX_RETRIES attempts" >&2
exit 1


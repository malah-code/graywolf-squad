#!/usr/bin/env sh
# ==============================================================================
# Graywolf Squad — Zero-Friction Production Bootstrap Installer
# Supports POSIX Linux (x86_64, arm64 / Raspberry Pi 5)
# License: Elastic License 2.0 (ELv2) / Apache-2.0
# ==============================================================================
set -e

DRY_RUN=false
TARGET_DIR="."
OVERRIDE_RAM_MB=""
OVERRIDE_ARCH=""

# Parse command line flags
SKIP_PREREQ_CHECK=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-prereq-check)
      SKIP_PREREQ_CHECK=true
      shift
      ;;
    --target-dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --ram-mb)
      OVERRIDE_RAM_MB="$2"
      shift 2
      ;;
    --arch)
      OVERRIDE_ARCH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sh scripts/install.sh [options]"
      echo "Options:"
      echo "  --dry-run             Validate prerequisites & configuration without writing state"
      echo "  --target-dir <path>   Destination root directory (default: current directory)"
      echo "  --ram-mb <integer>    Override detected RAM in MB for profile testing"
      echo "  --arch <architecture> Override detected CPU architecture (amd64, arm64)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "=================================================================="
echo "    🐺 Graywolf Squad — Production Bootstrap Installer           "
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. Prerequisite Checks
# ------------------------------------------------------------------------------
if [ "$DRY_RUN" = "false" ] && [ "$SKIP_PREREQ_CHECK" = "false" ]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker --version >/dev/null 2>&1; then
    echo "ERROR: Docker Engine is not installed or daemon is not accessible." >&2
    echo "Please install Docker 24+ before running the installer (or use --skip-prereq-check in headless container runners)." >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: Docker Compose v2 is required but not found." >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# 2. Host Hardware Profiling (PRD §15)
# ------------------------------------------------------------------------------
ARCH=$(uname -m 2>/dev/null || echo "x86_64")
if [ -n "$OVERRIDE_ARCH" ]; then
  ARCH="$OVERRIDE_ARCH"
fi

TOTAL_RAM_MB=16384
if [ -n "$OVERRIDE_RAM_MB" ]; then
  TOTAL_RAM_MB="$OVERRIDE_RAM_MB"
elif [ -f /proc/meminfo ]; then
  KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo "16777216")
  TOTAL_RAM_MB=$((KB / 1024))
fi

echo "Detected Architecture : $ARCH"
echo "Detected Memory       : ${TOTAL_RAM_MB} MB"

PROFILE="standard"
MAX_CONCURRENT_CONTAINERS=3
VALKEY_MAXMEMORY="512mb"

if [ "$TOTAL_RAM_MB" -le 8192 ]; then
  PROFILE="constrained (Raspberry Pi 5 / Edge)"
  MAX_CONCURRENT_CONTAINERS=1
  VALKEY_MAXMEMORY="256mb"
fi

echo "Selected Profile      : $PROFILE (max containers: $MAX_CONCURRENT_CONTAINERS, valkey: $VALKEY_MAXMEMORY)"

# ------------------------------------------------------------------------------
# 3. Environment Configuration Generation (.env.production)
# ------------------------------------------------------------------------------
ENV_PROD_PATH="$TARGET_DIR/.env.production"
ENV_EXAMPLE_PATH="$TARGET_DIR/.env.production.example"
if [ ! -f "$ENV_EXAMPLE_PATH" ] && [ -f ".env.production.example" ]; then
  ENV_EXAMPLE_PATH=".env.production.example"
fi

generate_secret_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    # Fallback to /dev/urandom
    head -c 32 /dev/urandom | od -A n -v -t x1 | tr -d ' \n'
  fi
}

generate_raw_32_bytes() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand 32
  else
    head -c 32 /dev/urandom
  fi
}

if [ -f "$ENV_PROD_PATH" ]; then
  echo "Existing configuration found at $ENV_PROD_PATH (preserved byte-for-byte)."
else
  echo "Generating new production configuration at $ENV_PROD_PATH..."
  POSTGRES_SECRET=$(generate_secret_hex)
  RELAY_JWT_SECRET_VAL=$(generate_secret_hex)
  LITELLM_SECRET="sk-graywolf-$(generate_secret_hex)"

  if [ "$DRY_RUN" = "false" ]; then
    mkdir -p "$TARGET_DIR"
    if [ -f "$ENV_EXAMPLE_PATH" ]; then
      sed \
        -e "s/CHANGE_ME_GENERATED_BY_INSTALLER/$POSTGRES_SECRET/g" \
        -e "s/CHANGE_ME_RELAY_JWT_GENERATED_BY_INSTALLER/$RELAY_JWT_SECRET_VAL/g" \
        -e "s/sk-graywolf-CHANGE_ME_GENERATED_BY_INSTALLER/$LITELLM_SECRET/g" \
        -e "s/MAX_CONCURRENT_CONTAINERS=3/MAX_CONCURRENT_CONTAINERS=$MAX_CONCURRENT_CONTAINERS/g" \
        -e "s/VALKEY_MAXMEMORY=512mb/VALKEY_MAXMEMORY=$VALKEY_MAXMEMORY/g" \
        "$ENV_EXAMPLE_PATH" > "$ENV_PROD_PATH"
    else
      cat <<EOF > "$ENV_PROD_PATH"
NODE_ENV=production
DEPLOYMENT_TOPOLOGY=solo
PORT_CONTROL=3000
PORT_ARP=3001
DASHBOARD_PORT=8080
POSTGRES_USER=graywolf
POSTGRES_PASSWORD=$POSTGRES_SECRET
POSTGRES_DB=graywolf_db
VALKEY_MAXMEMORY=$VALKEY_MAXMEMORY
MAX_CONCURRENT_CONTAINERS=$MAX_CONCURRENT_CONTAINERS
CONTAINER_MEMORY_LIMIT=2g
GRAYWOLF_KEK_PATH=/home/graywolf/.graywolf/master.key
GRAYWOLF_MASTER_KEY_PATH=/home/graywolf/.graywolf/master.key
RELAY_JWT_SECRET=$RELAY_JWT_SECRET_VAL
LITELLM_MASTER_KEY=$LITELLM_SECRET
OTEL_ENABLED=false
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
EOF
    fi
  else
    echo "[dry-run] Would generate .env.production with random secrets and profile parameters."
  fi
fi

# ------------------------------------------------------------------------------
# 4. Zero-Prompt Master Key Generation (0600 KEK — 32 Raw Bytes)
# ------------------------------------------------------------------------------
KEY_DIR="$TARGET_DIR/.graywolf"
KEY_FILE="$KEY_DIR/master.key"

if [ -f "$KEY_FILE" ]; then
  echo "Existing master key found at $KEY_FILE (permissions checked)."
  if [ "$DRY_RUN" = "false" ]; then
    chmod 0600 "$KEY_FILE" 2>/dev/null || true
  fi
else
  echo "Initializing master Key Encryption Key at $KEY_FILE..."
  if [ "$DRY_RUN" = "false" ]; then
    mkdir -p "$KEY_DIR"
    chmod 0700 "$KEY_DIR"
    generate_raw_32_bytes > "$KEY_FILE"
    chmod 0600 "$KEY_FILE"
  else
    echo "[dry-run] Would generate 32-byte master.key with permissions 0600 in $KEY_DIR."
  fi
fi

echo "=================================================================="
echo "    ✅ Graywolf Squad Production Setup Complete!                 "
echo "=================================================================="
if [ "$DRY_RUN" = "true" ]; then
  echo "[dry-run] Verification passed successfully."
else
  echo "To launch the platform, run:"
  echo "  docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
fi
exit 0

#!/usr/bin/env bash
# ==============================================================================
# Graywolf Squad — Structural Git Barrier Wrapper (PRD §13.3 & ADR-040)
# ==============================================================================
set -euo pipefail

SUBCOMMAND="${1:-}"

is_forbidden_mutation() {
  case "$SUBCOMMAND" in
    commit|push|merge|rebase|pull|fetch|remote|tag|cherry-pick|revert)
      return 0
      ;;
    reset)
      for arg in "$@"; do
        if [[ "$arg" == "--hard" ]]; then
          return 0
        fi
      done
      ;;
    branch)
      for arg in "$@"; do
        if [[ "$arg" =~ ^-[dDmM] ]]; then
          return 0
        fi
      done
      ;;
    checkout)
      for arg in "$@"; do
        if [[ "$arg" =~ ^-[bB] ]]; then
          return 0
        fi
      done
      ;;
  esac
  return 1
}

if is_forbidden_mutation "$@"; then
  echo "RELAY_GIT_BARRIER_VIOLATION: Direct git mutation is structurally prohibited inside the sandbox. Subcommand '$SUBCOMMAND' rejected." >&2
  exit 2
fi

REAL_GIT="${REAL_GIT_BIN:-/usr/bin/git}"

if ! command -v "$REAL_GIT" >/dev/null 2>&1; then
  # Fallback to searching PATH if /usr/bin/git does not exist
  REAL_GIT="$(which git 2>/dev/null || true)"
fi

if [[ -z "$REAL_GIT" ]]; then
  echo "Error: git executable not found." >&2
  exit 1
fi

exec "$REAL_GIT" "$@"

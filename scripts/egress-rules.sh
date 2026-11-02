#!/usr/bin/env bash
# ==============================================================================
# Graywolf Squad — Sandbox Network Egress Firewall Rules (PRD §13.3)
# ==============================================================================
set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]] || [[ "${DRY_RUN:-0}" == "1" ]]; then
  DRY_RUN=1
fi

RUNNER_BRIDGE="${RUNNER_BRIDGE:-br-runner-net}"
ORCHESTRATOR_HOST="${ORCHESTRATOR_HOST:-orchestrator}"
LITELLM_HOST="${LITELLM_HOST:-litellm-proxy}"

execute_or_print() {
  local cmd="$*"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY-RUN] $cmd"
  else
    eval "$cmd"
  fi
}

echo "Applying egress firewall rules for runner network bridge: ${RUNNER_BRIDGE} (dry-run: ${DRY_RUN})"

# 1. Allow already established and related connections
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# 2. Allow DNS resolution (UDP/TCP 53)
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p udp --dport 53 -j ACCEPT
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p tcp --dport 53 -j ACCEPT

# 3. Explicitly DROP access to sensitive internal control plane and database services (MUST precede general outbound rules)
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p tcp --dport 3000 -j DROP
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p tcp --dport 5432 -j DROP
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p tcp --dport 6379 -j DROP

# 4. Allow ARP WebSocket connection to Orchestrator on port 3001
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -d "${ORCHESTRATOR_HOST}" -p tcp --dport 3001 -j ACCEPT

# 5. Allow LiteLLM Proxy traffic on port 4000
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -d "${LITELLM_HOST}" -p tcp --dport 4000 -j ACCEPT

# 6. Allow outbound HTTPS (443) for package registries and Git operations
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -p tcp --dport 443 -j ACCEPT

# 7. Default DROP for all other forwarded traffic from runner containers
execute_or_print iptables -A DOCKER-USER -i "${RUNNER_BRIDGE}" -j DROP

echo "Egress firewall rules configured successfully."

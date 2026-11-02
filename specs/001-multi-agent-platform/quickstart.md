# Quickstart Guide: Autonomous Multi-Agent Software Engineering Platform

- **Feature**: `001-multi-agent-platform`
- **Status**: Complete
- **Date**: 2026-09-09

---

## 1. Prerequisites

Ensure your development environment meets the following requirements:
- **Node.js**: v20.10.0+ (`node --version`)
- **pnpm**: v9+ (`pnpm --version`)
- **Docker**: Docker Engine 24+ with `/var/run/docker.sock` accessible to the current user
- **Git**: Git 2.40+ (`git --version`)
- **Python**: Python 3.11+ (for LiteLLM Proxy and Guard AST tools)

---

## 2. Environment Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Configure your upstream LLM API keys:
   ```dotenv
   ANTHROPIC_API_KEY=sk-ant-...
   DEEPSEEK_API_KEY=sk-...
   OPENAI_API_KEY=sk-...
   LITELLM_MASTER_KEY=sk-proxy-master-secret
   PORT=4000
   DASHBOARD_PORT=3000
   ```

---

## 3. Starting the Platform

### Step 1: Launch the Governance Gateway & Valkey
```bash
docker compose -f packages/gateway/docker-compose.yml up -d
```
Verifies LiteLLM proxy is healthy at `http://localhost:4000/health`.

### Step 2: Start the Orchestrator Daemon & Dashboard
```bash
pnpm install
pnpm dev
```
- Orchestrator Backend runs at `http://localhost:4000` (Fastify REST + WebSocket).
- Dashboard Web UI opens at `http://localhost:3000`.

---

## 4. Delegating Your First Task

1. Create a task brief in the file-based state store:
   ```bash
   mkdir -p .agents/tasks/TASK-001-INIT
   cat << 'EOF' > .agents/tasks/TASK-001-INIT/brief.md
   ---
   id: "TASK-001-INIT"
   title: "Scaffold initial fastify server structure"
   status: "QUEUED"
   priority: "P1"
   assignedRole: "agent-coder"
   spendLimitUSD: 1.50
   targetFiles:
     - "packages/orchestrator/src/index.ts"
   ---

   # Objective
   Scaffold the Fastify HTTP and WebSocket server with health check endpoints.
   EOF
   ```

2. Watch the Dashboard at `http://localhost:3000`:
   - The filesystem watcher detects the new task card in real-time.
   - The orchestrator provisions a Git worktree (`worktree-task-001`) and boots an ephemeral Docker sandbox.
   - The agent writes code via `relay.mjs` without committing to Git.
   - Reactive guards evaluate the generated diff.
   - Once verified, the card moves to `HUMAN_REVIEW_GATE` with the unified diff ready for your approval!

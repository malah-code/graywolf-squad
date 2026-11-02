# Graywolf Squad — Deep-Dive Architecture: Local Development Topology & Network Segmentation

## 1. Executive Summary & Security Threat Model

In Graywolf Squad, local development (`docker compose up`) must replicate the exact security posture, isolation boundaries, and network segmentation of the production platform. 

The local development topology addresses two critical security failure modes:
1. **Host Takeover via Docker Socket**: A naive implementation mounts `/var/run/docker.sock` directly into the orchestrator so it can spawn ephemeral runner containers. This allows any process inside the orchestrator to issue raw Docker API calls, mount the host's `/` root directory, and achieve full root execution on the developer's workstation.
2. **Flat Bridge Lateral Movement**: Placing all services on a single bridge network allows an untrusted, prompt-injected LLM or malicious post-install npm script running inside `runner-{TASK_ID}` to `curl http://orchestrator:3000/api/...`, directly access `postgres-shared:5432`, or extract API keys from `litellm-proxy:4000`.

To eliminate these vulnerabilities, **ADR-040** establishes a **Four-Network Segmented Topology** powered by a **Scoped Docker Socket Proxy** (`tecnativa/docker-socket-proxy`, MIT).

---

## 2. Multi-Bridge Network Architecture

```
                                    HOST WORKSTATION (Developer)
                                                 │
                                 ┌───────────────┴───────────────┐
                                 │ HTTP :5173         HTTP :3000 │
                                 ▼                               ▼
═══════════════════════════════════════════════════════════════════════════════════════════════════
  edge-net (Public / Bridge — Published Ports Only)
    ├── dashboard (React / Vite on Nginx — :5173 -> :80)
    └── orchestrator (Fastify REST Gateway — :3000 -> :3000)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  control-net (Internal Bridge: internal: true — NO OUTSIDE ROUTE, NO RUNNER ROUTE)
    ├── orchestrator (Client on Port 3000)
    ├── postgres-shared (Port 5432 — Control Plane DB & Tier 1 Shared Sandboxes)
    ├── valkey (Port 6379 — Session Cache, Proper-Lockfile, BullMQ)
    └── litellm-proxy (Port 4000 — Model Provider Routing & Spend Ceilings)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  daemon-net (Internal Bridge: internal: true — 2 MEMBERS ONLY)
    ├── docker-proxy (Port 2375 — Scoped Docker Daemon TCP Socket)
    └── orchestrator (Client accessing Docker API via http://docker-proxy:2375)
═══════════════════════════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════════════════════════
  runner-net (Isolated Bridge — Untrusted Execution Plane)
    ├── orchestrator:3001 (ARP-ONLY WebSocket Port — Dedicated Listener)
    ├── runner-{TASK_ID} (Ephemeral Task Sandbox running relay.mjs)
    └── postgres-{TASK_ID} (Optional Tier 2 Ephemeral Database Sandbox)
═══════════════════════════════════════════════════════════════════════════════════════════════════
```

### 2.1 Network Segmentation Rules & Isolation Table

| Network Name | `internal: true` | Attached Containers | Permitted Communication | Prohibited Routes |
| :--- | :---: | :--- | :--- | :--- |
| **`edge-net`** | No | `dashboard`, `orchestrator` | Host browser access to Web UI and REST API. | Cannot reach `postgres-shared`, `valkey`, `litellm-proxy`, or `docker-proxy`. |
| **`control-net`** | **Yes** | `orchestrator`, `postgres-shared`, `valkey`, `litellm-proxy` | Inter-service control plane traffic (Fastify to DB, Cache, LLM Proxy). | **Physically isolated from runners.** No ephemeral container can attach here. |
| **`daemon-net`** | **Yes** | `docker-proxy`, `orchestrator` | Orchestrator issues container lifecycle API calls to proxy. | Isolated from all other services, host, and runners. |
| **`runner-net`** | No (Egress allowed for npm/pip/git) | `orchestrator:3001` (ARP WebSocket), `runner-*`, `postgres-*` | Runners connect **exclusively** to `orchestrator:3001` via WebSocket. | **Zero route to Port 3000, 5432, 6379, 4000, or 2375.** |

---

## 3. Scoped Docker Socket Proxy (`docker-proxy`)

The `docker-proxy` sidecar is configured via environment variables to allow only container provisioning actions while explicitly disabling dangerous Docker API capabilities:

```yaml
  docker-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: graywolf-docker-proxy
    restart: unless-stopped
    environment:
      # Permitted Operations
      - CONTAINERS=1    # Allow create, start, stop, rm, inspect
      - POST=1          # Allow POST requests (container creation)
      - NETWORKS=1      # Allow attaching containers to runner-net
      
      # Explicitly Blocked High-Risk Operations
      - EXEC=0          # Disallow docker exec into arbitrary containers
      - VOLUMES=0       # Disallow creating new host volume mounts
      - IMAGES=1        # Allow listing and pulling base runner images
      - SWARM=0         # Disable swarm management
      - SERVICES=0      # Disable services
      - INFO=0          # Block system info leaks
      - AUTH=0          # Block credential manipulation
      - SECRETS=0       # Block secret manipulation
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - daemon-net
```

### Security Benefits:
- **No Direct Socket Access**: The `orchestrator` container does not mount `/var/run/docker.sock`.
- **Read-Only Host Socket**: Even the proxy container mounts the host socket with `:ro`.
- **Restricted Privileges**: Even if the `orchestrator` container is compromised via a code injection or dependency CVE, the attacker cannot execute arbitrary commands into running host containers (`EXEC=0`) or mount arbitrary host directories (`VOLUMES=0`).

### 3.1 Topology Gates & Residual Risk Governance (ADR-040)

To avoid letting "accepted residual risks" become permanent production security debt, Graywolf establishes **strict architectural trigger conditions**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY A: Local / Solo Developer Mode (docker-compose.yml)           │
│ Allowed: IMAGES=1 (convenience) + Direct runner-net egress             │
│ Boundary: Single developer machine, non-sensitive local playground.    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         TRIGGER CONDITION MET:
                         - Any team member invited (Team Mode enabled)
                         - First customer / production codebase mounted
                         - Deployed as Enterprise Self-Hosted (Topology B)
                         - Deployed as BYOC / Hybrid SaaS (Topology C)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGIES B & C: Production & Multi-User Topologies (MANDATORY GATE)  │
│ 1. Immutable Digest Pinning: IMAGES=0 on proxy; runner images pinned   │
│    to verified SHA-256 digests (image@sha256:...) from internal mirror.│
│ 2. ADR-028 Egress Proxy: Direct egress on runner-net disabled. All     │
│    outbound requests routed through egress proxy with domain allowlist │
│    (npm, PyPI, verified Git remote, LiteLLM) to prevent exfiltration.  │
└────────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Production Gate Invariant**: Before any external team collaborator joins a workspace or any commercial customer codebase touches a runner sandbox, the deployment environment **MUST** activate digest pinning and ADR-028 egress proxying.


---

## 4. Dual-Port Fastify Listener Design

To guarantee physical network isolation between the management plane and the execution sandboxes, the Fastify Orchestrator initializes **two independent HTTP/WebSocket servers**:

```typescript
// 1. Management & Control Plane Server (Port 3000)
// Bound to control-net and edge-net
const controlServer = fastify({ logger: true });
await controlServer.register(authRoutes);      // /api/v1/auth
await controlServer.register(workspaceRoutes); // /api/v1/workspaces
await controlServer.register(taskRoutes);      // /api/v1/tasks
await controlServer.listen({ port: 3000, host: '0.0.0.0' });

// 2. Agent Relay Protocol Server (Port 3001)
// Bound to runner-net ONLY
const arpServer = fastify({ logger: true });
await arpServer.register(fastifyWebsocket);
arpServer.get('/arp', { websocket: true }, (connection, req) => {
  handleRelayWebSocketConnection(connection, req); // Validates containerToken
});
await arpServer.listen({ port: 3001, host: '0.0.0.0' });
```

In `docker-compose.yml`, the orchestrator defines network-specific port bindings:
- Port 3000 is accessible from `edge-net` and `control-net`.
- Port 3001 is accessible from `runner-net`.
- `runner-net` has **no port 3000 mapping**, meaning `curl http://orchestrator:3000` from inside a runner fails with `Connection Refused`.

---

## 5. Persistent Volume Mounts & Directory Hierarchy

Graywolf preserves application state across container lifecycles using structured Docker named volumes:

```
HOST STORAGE
  ├── graywolf_pgdata       ➔ /var/lib/postgresql/data (PostgreSQL 16 + pgvector)
  ├── graywolf_valkeydata   ➔ /data (Valkey append-only persistence)
  ├── graywolf_litellm      ➔ /root/.local/share/litellm (LiteLLM spend tracking)
  ├── graywolf_task_storage ➔ /app/storage/tasks (Task briefs, reviews, patches)
  └── graywolf_cache_npm    ➔ /home/graywolf/.npm (Tier 1 Package Cache, UID 10001)
```

---

## 6. Cold-Boot Orchestration & Health Checks

To achieve the sub-2-second target and prevent cascading boot failures, services define tight, prioritized health checks:

1. **Phase 1 (Datastores)**: `postgres-shared` and `valkey` initialize.
   - Postgres health check: `pg_isready -U graywolf -d graywolf_db` (interval: 2s, timeout: 2s, retries: 10).
   - Valkey health check: `valkey-cli ping` (interval: 1s, timeout: 1s, retries: 5).
2. **Phase 2 (Proxies & Services)**:
   - `docker-proxy`: TCP ping on port 2375.
   - `litellm-proxy`: HTTP `GET http://localhost:4000/health/liveliness`.
3. **Phase 3 (Application Core)**:
   - `orchestrator`: Depends on `postgres-shared: service_healthy`, `valkey: service_healthy`, `docker-proxy: service_started`, and `litellm-proxy: service_healthy`.
4. **Phase 4 (Frontend)**:
   - `dashboard`: Starts and connects to `orchestrator:3000`.

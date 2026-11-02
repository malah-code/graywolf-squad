# Graywolf Squad — Deep-Dive Architecture: Multi-Tenancy, Team Collaboration & SaaS Deployment

## 1. Executive Summary & Vision

Graywolf Squad is designed with a **"Local-First, SaaS-Ready from Day 1"** topology. 

Rather than building a single-user desktop app that must be thrown away when enterprise teams adopt it, or a bloated cloud SaaS that frightens security-conscious enterprises with source code privacy concerns, Graywolf adopts a **decoupled Control Plane vs. Execution Plane architecture**:

1. **Zero-Friction Solo Mode**: Boots in `< 1` second with zero authentication, seeding a default `Personal Workspace` and auto-logging in the local admin.
2. **Dashboard-Driven Team Upgrade**: A one-click toggle in Settings upgrades a personal workspace into an authenticated team workspace with instant invite links—no server restarts or `.env` file editing.
3. **Tenant Isolation from Day 1**: Every relational table and vector index is strictly scoped by `org_id` and `workspace_id`. PostgreSQL Row-Level Security (RLS) guarantees that multi-tenant SaaS deployment requires zero architectural redesign later.
4. **Hybrid SaaS & BYOC (Bring Your Own Compute)**: Supports full self-hosted single-box deployment, multi-tenant cloud SaaS, and Enterprise Hybrid where the web UI is hosted on cloud SaaS while task execution sandboxes run inside the customer's private VPC/local network.

---

## 2. Decoupled Architecture: Control Plane vs. Execution Plane

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CONTROL PLANE (Web & Core)                              │
│  - Fastify API Server & WebSockets                                                     │
│  - React Flow Kanban & assistant-ui Chat Cockpit                                       │
│  - PostgreSQL 16 + pgvector (Multi-Tenant Schema with RLS)                             │
│  - LiteLLM Spend Governance & Key Management                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                    gRPC / WebSocket Agent Relay Protocol (Encrypted)
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXECUTION PLANE (Task Runners)                            │
│  - Ephemeral Docker Sandbox Containers (Runner Base Image)                             │
│  - Git Worktree Clones & non-committing relay.mjs                                      │
│  - Ephemeral PostgreSQL Template DB Clones (< 300ms copy-on-write)                     │
│  - Playwright Headless Browser & Artifact Exporters                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Three Supported Deployment Topologies

| Topology | Control Plane Location | Execution Plane Location | Target Audience |
| :--- | :--- | :--- | :--- |
| **A. Local / Solo Self-Hosted** | Localhost / Laptop / Raspberry Pi | Local Docker Engine | Solo developers, open-source hackers, vibe coders |
| **B. Enterprise Team Self-Hosted** | Company internal VM / Office Server | Internal Docker / Kubernetes Node | Small teams, startups, private enterprises |
| **C. Hybrid SaaS (BYOC Runner)** | Graywolf Managed Cloud SaaS | Customer Private VPC / Local Runner | Enterprises requiring code privacy without self-hosting UI/DB |

---

## 3. Tenant Isolation from Day 1: Schema & Data Model

To prevent cross-tenant data leaks and eliminate future tech debt, all core entities enforce composite tenancy keys.

### 3.1 Relational Schema (`PostgreSQL 16`)

```sql
-- 1. Organizations (Top-level workspace & token budget governance boundary)
-- Note: Graywolf is 100% free open source. plan_tier reflects self-managed feature flags,
-- and spend limits refer exclusively to user safety caps on third-party model token consumption.
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'community', -- 'community' | 'team' | 'enterprise'
    mode VARCHAR(32) NOT NULL DEFAULT 'personal',       -- 'personal' | 'team'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Workspaces (Sub-compartments within an organization)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, slug)
);

-- 3. Users & Memberships
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'developer', -- 'owner' | 'lead_dev' | 'developer' | 'viewer'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- 4. Projects (Bound to Workspace & Git Remote)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'brownfield', -- 'greenfield' | 'brownfield'
    git_remote_url TEXT NOT NULL,
    git_provider VARCHAR(32) NOT NULL DEFAULT 'github', -- 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'gitea'
    config_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, slug)
);

-- 5. Tasks (Scoped by Project, Workspace, and Org)
CREATE TABLE tasks (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'TASK-101'
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(512) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'BACKLOG',
    priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    blocked_by TEXT[] DEFAULT '{}',
    writable_scope TEXT[] DEFAULT '{}',
    spend_usd NUMERIC(10, 4) DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.2 Row-Level Security (RLS) Enforcement & Hardening

PostgreSQL Row-Level Security is strictly enabled and forced on every tenant-scoped table:

```sql
-- Enforce RLS unconditionally even for table owners or superuser connection pools
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE code_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_symbols FORCE ROW LEVEL SECURITY;

ALTER TABLE project_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_lessons FORCE ROW LEVEL SECURITY;
```

Before any transaction or API route executes, the Fastify authentication hook sets both the workspace and organization context:
```typescript
await pgClient.query(`
  SET LOCAL app.current_org_id = $1;
  SET LOCAL app.current_workspace_id = $2;
`, [currentOrgId, currentWorkspaceId]);
```

### 3.3 The Sanctioned Bridge Gate: Organization Memory Isolation (ADR-051)

Because `is_org_wide = true` lessons cross workspace boundaries by design, they represent a sanctioned bridge. To prevent cross-customer data leaks in multi-tenant deployments:

1. **Strict Organization Scoping**: Org-wide lessons are **NEVER instance-wide**. Every org lesson retains an immutable `org_id REFERENCES organizations(id)`.
2. **The Two-Tier RLS Policy**:
   ```sql
   CREATE POLICY tenant_and_org_lesson_isolation ON project_lessons
       FOR ALL
       USING (
           (workspace_id = current_setting('app.current_workspace_id')::UUID)
           OR
           (is_org_wide = true AND org_id = current_setting('app.current_org_id')::UUID)
       )
       WITH CHECK (
           workspace_id = current_setting('app.current_workspace_id')::UUID
           AND org_id = current_setting('app.current_org_id')::UUID
       );
   ```
   **Probe Invariant**: If Organization A promotes a lesson matching `trigger_scope: ['cmd/**']`, and Organization B queries lessons in its Go workspace, PostgreSQL evaluates `org_id = 'ORG_B'` $\rightarrow$ **zero rows returned, zero context injection**.

### 3.4 Defense-in-Depth Against Agent SQL & Error Sanitization

1. **Network Segregation**: Task runner containers run on `runner-net`. The Control Plane PostgreSQL (port 5432) runs exclusively on `control-net`, rendering direct database connections physically unreachable from the sandbox.
2. **Sanitized Error Payloads (No Prompt Fuel)**: If an agent probes API endpoints with foreign UUIDs (e.g. attempting an IDOR on `/api/v1/projects/{foreign_uuid}`), the orchestrator:
   - Evaluates the query under RLS, returning an empty set.
   - Responds with a generic HTTP 404 `RESOURCE_NOT_FOUND`.
   - Never leaks database error strings, table names, foreign keys, or schema constraints into the response payload or event stream. This prevents the LLM from using error text as prompt engineering material to map cross-tenant topologies.

### 3.5 Shared `pgvector` HNSW Search: SQL-Level Predication

In a shared vector index, application-level post-filtering (e.g. fetching top-20 nearest vectors and filtering by tenant in Node.js) is strictly prohibited because:
- A missing `if` statement leaks cross-tenant embeddings.
- It leaks timing and result-count side channels.
- Dense neighbor clusters from Tenant A can push Tenant B's results out of the top-$k$ window.

**Normative SQL Predication**:
All semantic similarity queries against `pgvector` MUST execute with tenant constraints directly in the SQL `WHERE` clause:
```sql
SELECT id, summary, rule_content, 1 - (embedding <=> $query_vector) AS similarity
FROM project_lessons
WHERE (
    workspace_id = current_setting('app.current_workspace_id')::UUID
    OR (is_org_wide = true AND org_id = current_setting('app.current_org_id')::UUID)
)
AND status = 'active'
ORDER BY embedding <=> $query_vector
LIMIT 5;
```
Combined with `FORCE ROW LEVEL SECURITY`, PostgreSQL enforces this predicate at the storage engine layer regardless of caller syntax.

### 3.6 Per-Project Cache, Storage & Webhook Scoping

1. **Cache Volume Isolation**:
   - Package manager caches are mounted from discrete Docker named volumes named `pkg-cache-{project_id}`.
   - `project_id` is validated as a strict UUID regex before container creation, preventing path traversal.
   - Containers run as unprivileged `graywolf` user (`uid=1000`) without write access to host volume roots.
2. **Hierarchical Artifact Storage**:
   - Task review artifacts on host storage follow the strict path hierarchy:
     `/storage/artifacts/{org_id}/{workspace_id}/{project_id}/{task_id}/`
   - Artifact download routes enforce session tenant verification before streaming files.
3. **Escalation Webhooks**:
   - Outbound webhooks (Slack, Email, Discord) are stored in `workspace_integrations` and scoped by `workspace_id`.
   - Escalation events and review decision memos dispatch exclusively to the target workspace's registered webhook endpoints.


---

## 4. Dashboard-Driven Team Mode (Zero-Config to Team)

### 4.1 First Boot: Zero-Config Solo Mode
- On initial launch (`docker compose up`), the system runs a database migration seed:
  - Creates a default organization: `Personal Org` (`mode: 'personal'`).
  - Creates a default workspace: `Default Workspace`.
  - Creates a local admin user: `Admin User`.
  - Generates a local persistent session cookie.
- The developer opens `http://localhost:3000` and sees their projects and tasks immediately—no sign-up, no email verification, no friction.

### 4.2 Upgrading to Team Mode via Dashboard
When the developer wants to invite collaborators:
1. Navigates to **Settings $\rightarrow$ Team & Collaboration**.
2. Clicks the button: **`[ Enable Team Workspace ]`**.
3. A modal opens with 2 configuration items:
   - **Authentication Method**: Local email/password OR OAuth (GitHub, GitLab, Google).
   - **Invite Expiration**: 24 hours, 7 days, or permanent.
4. Clicking **Save** updates the database flag:
   ```sql
   UPDATE organizations SET mode = 'team' WHERE id = :org_id;
   ```
5. The UI instantly reveals the **Shareable Invite Link**:
   `http://localhost:3000/invite/join?token=<RAW_32_BYTE_TOKEN>`
   *(Note: The server stores only the `SHA-256` hash of this token in `workspace_invites` with expiration and role binding, per ADR-039).*
6. Teammates open the link, authenticate (via email/password or OAuth), and Better-Auth validates the hash, creating a stateful Valkey-cached session with the assigned `developer` or `viewer` role.
7. **Zero container reboots or `.env` modifications required.**


---

## 5. Role-Based Access Control (RBAC) Matrix

| Action / Permission | Owner / Admin | Lead Developer | Developer | Viewer / Client |
| :--- | :---: | :---: | :---: | :---: |
| **Manage Model API Keys & Token Spend Limits (LiteLLM)** | ✅ | ❌ | ❌ | ❌ |
| **Manage Team Members & Roles** | ✅ | ❌ | ❌ | ❌ |
| **Create Projects & Define Blast-Radius Boundaries** | ✅ | ✅ | ❌ | ❌ |
| **Override Mandatory Human Review Gates** | ✅ | ✅ | ❌ | ❌ |
| **Approve Pull Requests & Merge to Git Remote** | ✅ | ✅ | ❌ | ❌ |
| **Create Tasks & Reorder Kanban Backlog** | ✅ | ✅ | ✅ | ❌ |

| **Chat with Active Control Plane Cockpit** | ✅ | ✅ | ✅ | ❌ |
| **Answer Blocking Clarification Subtasks** | ✅ | ✅ | ✅ | ❌ |
| **View Kanban Board, Live Logs & Visual Artifacts** | ✅ | ✅ | ✅ | ✅ |

---

## 6. Hybrid SaaS & Bring Your Own Compute (BYOC)

For enterprise security and cloud commercialization, Graywolf supports the **BYOC Runner Model** (identical to GitHub Actions self-hosted runners or Datadog agents):

```
┌─────────────────────────────────────────────────────────────┐
│                    GRAYWOLF CLOUD SAAS                      │
│  - Hosted Web Application & Real-Time Collaboration         │
│  - Global Task State, DAG Scheduling & Kanban Board         │
│  - Organization Billing & Multi-Provider LiteLLM Proxy      │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Secure Outbound WebSocket Connection
                               │ (TLS 1.3 / mTLS, No inbound ports required)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               CUSTOMER INTERNAL VPC / RUNNER                │
│  - `graywolf-runner` Docker daemon / Kubernetes agent       │
│  - Clones Git repository locally within customer network   │
│  - Executes task sandboxes, ephemeral DBs, & Playwright     │
│  - Returns verified patch diff + screenshots back to SaaS   │
│  🔒 GRAYWOLF SAAS NEVER STORES CUSTOMER SOURCE CODE         │
└─────────────────────────────────────────────────────────────┘
```

### Security Benefits of BYOC:
1. **Zero Source Code Ingestion by Graywolf**: Graywolf SaaS never stores, indexes, or retains the customer's proprietary source code on its own infrastructure—only the ephemeral patch diff and test status report pass through the WebSocket relay.
2. **Zero Internal Network Exposure**: The runner connects outbound to the SaaS via WebSocket. The customer never opens inbound firewall ports.
3. **Local Database Safety**: In brownfield mode, the runner connects to internal staging databases that are completely inaccessible from the public internet.
4. **Model Data Residency Policy**: LLM inference calls may send code snippets to external model providers depending on the configured Data Residency Tier. See [`data-residency-and-byoc.md`](file:///home/tarikelmallah/Projects/GraywolfSquad/docs/architecture/data-residency-and-byoc.md) and ADR-027 for the three-tier policy (Sovereign / Private VPC / Public Cloud).

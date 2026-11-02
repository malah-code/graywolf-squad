# Graywolf Squad — Deep-Dive Architecture: Execution Sandbox & Real-World Testing

## 1. Problem Statement

An agent that writes a full-stack feature (database migration + API endpoint + React UI) must be able to **prove its work is correct** before a human or AI-PM reviewer ever sees it. Doing this wrong causes either:
- **State Pollution**: Schema migrations from concurrent tasks corrupt each other's test data.
- **False Confidence**: Shallow mocked tests pass in isolation but fail in integration.
- **Cost Explosion**: Provisioning a full cloud database per task burns budget and adds 30–60 seconds to every task startup.

The solution is an **Adaptive Sandbox Matrix** where the orchestrator selects the minimum viable isolation level required by each task, with the human retaining full override authority.

---

## 2. Industry Art Survey

| Platform | Sandbox Strategy | Lesson Extracted |
| :--- | :--- | :--- |
| **Devin (Cognition Labs)** | Full persistent cloud VM per session | Expensive; great for long sessions but overkill per-task |
| **OpenHands (OpenDevin)** | Docker container per task + terminal; optional remote backend | Proves ephemeral containers + in-process terminals are sufficient |
| **Daytona / Gitpod** | Pre-built dev environment snapshots (Dev Container spec); fast clone | Pre-warmed base images drastically reduce cold-start time |
| **GitHub Actions** | Service containers (real Postgres/Redis sidecars); ephemeral per workflow run | Ephemeral sidecar databases are reliable for CI and agent testing |
| **Railway / Render PR Envs** | Temporary environment per Git branch including full DB clone | Postgres `CREATE DATABASE ... TEMPLATE` pattern works at real scale |

**Synthesis**: Best systems combine fast ephemeral containers (OpenHands) + pre-warmed images (Gitpod) + real sidecar databases only when needed (GitHub Actions).

---

## 3. The Adaptive Sandbox Matrix

### 3.1 Three-Tier Database Isolation Strategy

```
                   [Task Dispatched to Orchestrator]
                                  │
                                  ▼
            ┌──────────────────────────────────────────┐
            │   Pre-Flight Isolation Analyzer           │
            │   Inspects:                               │
            │   • plan.md touched file paths            │
            │   • Migration file pattern matches        │
            │   • Task tags (e.g. "db-migration")      │
            │   • project.config.json overrides        │
            └──────────────────────────────────────────┘
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
  ISOLATION TIER 0: MOCK       ISOLATION TIER 1: SHARED       ISOLATION TIER 2: ISOLATED
  No DB attached.              Connects to shared dev DB      Dedicated DB per-task.
  Pure unit test               with per-task schema           Dropped on exit.
  mock stubs only.             namespace.                     

  Triggers:                    Triggers:                      Triggers:
  • Frontend-only tasks        • Read/CRUD queries            • Any migration file
  • Docs, styles               • No schema changes            • Schema alterations
  • Pure algorithm tasks       • Stateless API calls          • Extension installs

### 3.1.2 Provisioning Engines (For Tier 2 Isolation)
When Tier 2 (Isolated) is required, Graywolf provisions the database using one of two engines:
1. **Fast-Clone Engine**: Native snapshot/template capabilities (e.g., PostgreSQL `CREATE DATABASE ... TEMPLATE`). Sub-300ms boot. Default if the target stack uses Postgres.
2. **Generic Engine**: Uses Testcontainers to provision a fresh container. Used for MongoDB, MySQL, Redis, Kafka, etc. Slower boot (seconds) but universal Docker support.
```

### 3.2 The Fast-Clone Engine (Postgres Template Cloning)

PostgreSQL ships a native, battle-tested feature — **template databases**:

```sql
-- Done ONCE during project onboarding:
CREATE DATABASE graywolf_template WITH TEMPLATE template0;
\i schema/baseline.sql  -- apply all migrations to template

-- Per task at container start (~150–300ms):
CREATE DATABASE task_abc123 TEMPLATE graywolf_template;

-- At container teardown:
DROP DATABASE task_abc123;
```

**Properties**:
- **Speed**: Complete clone in under 300ms (filesystem-level copy inside PostgreSQL).
- **Fidelity**: 100% real PostgreSQL including `pgvector`, JSONB, triggers, custom types.
- **Cost**: Zero external cloud cost — runs inside a Postgres sidecar on the host Docker network.

### 3.3 The Generic Engine (Testcontainers + Pluggable Providers)

For any database engine lacking a native sub-300ms template-clone feature (MongoDB, MySQL, Redis, Kafka), Graywolf adopts **Testcontainers** as the generic provisioning backbone. Rather than building a bespoke lifecycle manager for every possible tech stack, Graywolf provides an adapter from Testcontainers into the sandbox lifecycle.

**Provider Plugin Manifest**:
A unified Plugin system handles this (ADR-046). Providers are defined in `.agents/sandbox-providers/`:
- **Built-ins**: Postgres, MySQL, MongoDB, Redis (scrutinized, digest-pinned).
- **Custom**: Developers can drop a manifest defining the Docker image, wait-strategy/healthcheck, seed hook, and clone strategy (`template` | `fresh`). Community plugins undergo strict supply-chain scrutiny (same as Skills).

### 3.4 Zero-Friction Onboarding (Configuration Schema)

The genericity does not compromise first-run simplicity:
1. **Auto-Detect**: Brownfield Recon's Phase 1 parses `docker-compose.yml`. If it finds `mongo`, it maps it to the built-in Mongo Provider Plugin. The developer does nothing.
2. **Tier 0 Default**: If there is no compose file and no `.agents/project.config.json` override, the system defaults to Isolation Tier 0 (Mock, no DB) to avoid assuming Postgres.
3. **Ambiguity Fallback**: Only if recon is ambiguous does the UI onboarding wizard ask what the app depends on.

```jsonc
{
  "sandbox": {
    "defaultDbTier": "auto",          // "auto" | "mock" | "fast-clone" | "generic"
    "providers": ["mongodb", "redis"], // Auto-detected from docker-compose.yml
    "allowAgentDecision": true
  }
}
```

---

## 4. Playwright Headless E2E Testing in the Sandbox

### 4.1 Why Headless E2E Testing Is Non-Negotiable

An agent that only runs unit tests before submitting is like a developer who writes code without refreshing the browser. Full-stack features break in ways unit tests never catch:
- React component renders blank because the API response shape changed.
- A modal closes unexpectedly due to CSS `z-index` conflict after branch merge.
- A form submission silently fails on HTTP 422 with no user-facing error.

Playwright inside the sandbox catches **all of these before any human ever sees the code**.

### 4.2 Multi-Language Runner Image Composition

The Phase 1 Brownfield Recon detects manifests (e.g., `package.json`, `go.mod`, `Cargo.toml`) in the target repository. If a polyglot stack is detected (e.g., Node + Go), the orchestrator dynamically composes a custom multi-toolchain runner image on the fly, caching the result.

This ensures tools like `npm run lint`, `go test -race`, and `cargo clippy` can execute side-by-side in a single sandbox without falling back to host execution. 

Playwright and its Chromium binary are pre-installed in the base image layer to eliminate 400MB downloads per task:

```dockerfile
# Dynamically Composed Polyglot Image (e.g. Node + Go)
FROM node:20-slim AS base
RUN npx -y playwright@latest install-deps chromium
RUN npx -y playwright@latest install chromium

# Re-layered based on detected manifests (go.mod detected)
COPY --from=golang:1.22-alpine /usr/local/go/ /usr/local/go/
ENV PATH="/usr/local/go/bin:${PATH}"

# ... rg, git, tree-sitter, relay.mjs
```

### 4.3 Full-Stack E2E Test Flow Inside the Container

When a task is tagged `ui-change` or `api-change`, **Dev-Level-2 (Reviewer)** executes the full-stack validation loop. Rather than assuming hardcoded npm scripts, dev-server commands and readiness probes are read dynamically from `.agents/project.config.json`:

```json
// .agents/project.config.json (Polyglot Example: Go REST API + Vite/React Frontend)
{
  "devServers": {
    "backend": {
      "command": "go run ./cmd/server",
      "cwd": ".",
      "readinessProbe": { "type": "http", "url": "http://127.0.0.1:8080/health", "timeoutMs": 30000 }
    },
    "frontend": {
      "command": "npm run dev",
      "cwd": "./web",
      "readinessProbe": { "type": "stdout_match", "regex": "ready in [0-9]+", "timeoutMs": 15000 }
    }
  },
  "e2e": {
    "command": "npx playwright test tests/e2e/ --reporter=json,html"
  }
}
```

The in-container orchestration flow executes:

```
1. Boot backend server (if declared in devServers.backend):
   $ ${devServers.backend.command} &
   (poll readinessProbe.url → 200 OK, or wait for stdout_match, timeout from config)

2. Boot frontend server (if declared in devServers.frontend):
   $ ${devServers.frontend.command} &
   (poll readinessProbe.url or listen for stdout_match, e.g. Vite "ready in Xms")

3. Run Playwright suite:
   $ ${e2e.command}

4. Collect artifacts into Review Packet:
   .agents/tasks/<TASK_ID>/review/
   ├── changes.patch
   ├── result.json
   ├── review-signoff.md
   ├── playwright-report/index.html
   ├── test-results/*.webm          (video recordings)
   └── screenshots/
       ├── feature_happy_path.png
       └── edge_case_validation.png
```

### 4.4 The Review Packet: Visual Proof for Humans and AI-PM

When the task reaches the Gate (human, AI-PM, or auto-approve), the reviewer sees:
- **Code diff** (`changes.patch`) — what changed
- **Test results** — pass/fail counts, duration, coverage delta
- **Embedded screenshots** of actual UI states after the change
- **Video playback** of the automated user flow for complex features

This is the same proven pattern used by **Chromatic** (Storybook visual diffing), **Percy.io**, and **Argos CI** — all of which embed visual diffs directly into PR review workflows.

### 4.5 Agent-Written vs. Pre-Existing E2E Tests

| Mode | Behavior |
| :--- | :--- |
| **Pre-existing tests exist** | Agent runs `tests/e2e/` as-is. Failures block task completion. |
| **No E2E tests for the feature** | Dev-Level-3 writes a Playwright spec covering the happy-path user flow. Dev-Level-2 runs and validates it. |

**Rule**: The agent always writes E2E tests for any `ui-change` tagged task if none exist.

---

## 5. QA Agent Persona (Extension Point)

The architecture natively supports a **QA Specialist Agent** (`Dev-Level-4: QA`) that:
- Generates adversarial Playwright scenarios (invalid inputs, race conditions, auth edge cases).
- Runs accessibility audits via `@axe-core/playwright`.
- Produces visual regression diffs against baseline screenshots using `pixelmatch`.

Invoked on tasks tagged `qa-intensive` or configured as mandatory for release-blocking features.

---

## 6. Open-Source Foundation

| Responsibility | Library | License |
| :--- | :--- | :--- |
| Generic Database Provisioning | `testcontainers` | MIT / Apache 2.0 |
| Ephemeral Postgres template cloning | Native PostgreSQL `CREATE DATABASE ... TEMPLATE` | PostgreSQL License |
| Container lifecycle management | `dockerode` | Apache 2.0 |
| Headless browser testing | `@playwright/test` | Apache 2.0 |
| Accessibility testing | `@axe-core/playwright` | MPL 2.0 |
| Visual regression diffing | `pixelmatch` | MIT |

---

## 7. Docker Network Topology (ADR-040 Segmentation)

```
Multi-Bridge Network Segmentation (ADR-040 / local-development-topology.md):

├── edge-net (Bridge — Host published ports only)
│   ├── dashboard (React UI :5173 / :80)
│   └── orchestrator (Fastify Client REST API :3000)
│
├── control-net (Internal Bridge: internal: true — No runner route)
│   ├── orchestrator (Control plane Fastify core)
│   ├── postgres-shared (Postgres 16 + pgvector :5432 — Tier 1)
│   ├── valkey (BullMQ / Session Cache :6379)
│   └── litellm-proxy (Model gateway :4000)
│
├── daemon-net (Internal Bridge: internal: true — 2 members only)
│   ├── orchestrator
│   └── docker-proxy (tecnativa/docker-socket-proxy :2375)
│
└── runner-net (Isolated Execution Plane — Per-Task ephemeral sandboxes)
    ├── orchestrator:3001 (ARP WebSocket listener ONLY — no route to :3000)
    ├── runner-{TASK_ID}
    │   ├── /workspace → git worktree (read-write)
    │   ├── /app.readonly → source mount (read-only, brownfield)
    │   └── relay.mjs (non-commit harness)
    └── postgres-{TASK_ID} (Tier 2 only)
        └── DB: task_{TASK_ID} (cloned from graywolf_template)
```

---

## 8. Permanent CI Adversarial Regression Suite (`relay.mjs` & Sandbox Security)

To prevent security regressions and ensure the physical guarantees of ADR-047 and ADR-048 remain intact, every PR touching the runner container image, `relay.mjs`, or Git interceptors MUST pass the following automated test suite (`tests/security/sandbox-regression.spec.ts`):

```typescript
describe('Sandbox & Relay Adversarial Regression Suite', () => {
  // 1. PATH bypass attempt
  it('T01: denies direct execution of /usr/bin/git.real commit with EROFS', async () => {
    const res = await execInSandbox('/usr/bin/git.real commit -m "bypass"');
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/Read-only file system|prohibited/);
  });

  // 2. Global flag obfuscation
  it('T02: denies flag-obfuscated git -c user.name=evil commit', async () => {
    const res = await execInSandbox('git -c user.name=evil commit -m "bypass"');
    expect(res.exitCode).toBe(128);
    expect(res.stderr).toContain('SECURITY_BLOCKED');
  });

  // 3. Stash commit block
  it('T03: denies git stash as a ref-updating commit operation', async () => {
    const res = await execInSandbox('git stash');
    expect(res.exitCode).toBe(128);
    expect(res.stderr).toContain('SECURITY_BLOCKED');
  });

  // 4. Safe staging via three-variable tmpfs
  it('T04: allows git add without EROFS by writing loose objects to tmpfs', async () => {
    await execInSandbox('echo "hello" > test.txt');
    const res = await execInSandbox('git add test.txt');
    expect(res.exitCode).toBe(0);
    const indexStat = await statInSandbox('/tmp/graywolf/git/index');
    expect(indexStat.size).toBeGreaterThan(0);
  });

  // 5. Composite patch capture
  it('T05: generates unified changes.patch covering both staged and unstaged edits via git diff HEAD', async () => {
    await execInSandbox('echo "staged" > staged.txt && git add staged.txt');
    await execInSandbox('echo "unstaged" > unstaged.txt');
    const patch = await execInSandbox('git diff HEAD');
    expect(patch.stdout).toContain('staged.txt');
    expect(patch.stdout).toContain('unstaged.txt');
  });

  // 6. Emergency budget flush
  it('T06: flushes emergency patch and checkpoint on budget_exceeded', async () => {
    const result = await simulateTaskBreach({ limitUsd: 0.10 });
    expect(result.status).toBe('budget_exceeded');
    expect(result.checkpointAvailable).toBe(true);
    expect(result.patchSaved).toBe(true);
  });

  // 7. Token-class IDOR defense on resumption
  it('T07: rejects /resume calls authenticated with RELAY_AUTH_TOKEN (HTTP 403)', async () => {
    const res = await request(app)
      .post('/api/v1/tasks/task-123/resume')
      .set('Authorization', `Bearer ${RELAY_AUTH_TOKEN}`)
      .send({ additionalSpendLimitUSD: 5.00 });
    expect(res.status).toBe(403);
  });

  // 8. Governor hard ceiling on resumes
  it('T08: rejects a 3rd consecutive task resume with maxResumesPerTask limit', async () => {
    await resumeTask('task-123', 1);
    await resumeTask('task-123', 2);
    const res = await resumeTask('task-123', 3);
    expect(res.status).toBe(429);
  });

  // 9. Polyglot route prefix concatenation
  it('T09: reconstructs canonical route from nested chi/gin route groups', async () => {
    const symbols = await parseFileSymbols('testdata/chi_routes.go');
    expect(symbols.routes).toContain('/api/v1/orgs/:id/members');
  });

  // 10. Container security posture verification
  it('T10: enforces no-new-privileges and drops all Linux capabilities', async () => {
    const inspect = await docker.getContainer('runner-test').inspect();
    expect(inspect.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    expect(inspect.HostConfig.CapDrop).toContain('ALL');
  });
});
```

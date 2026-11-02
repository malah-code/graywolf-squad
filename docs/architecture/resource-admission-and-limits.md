# Graywolf Squad — Deep-Dive Architecture: Resource Admission Control & Constrained Hardware Profiles

## 1. Executive Summary & The Edge Paradox

Graywolf Squad explicitly supports **Topology A: Local / Solo Self-Hosted** running on developer laptops, small cloud VMs, and single-board computers like the **Raspberry Pi 5 (8GB)**. 

At the same time, Graywolf mandates high-fidelity validation including **ephemeral PostgreSQL template database clones** and **headless Playwright Chromium browser runs**.

Running three concurrent Docker sandboxes, each spawning Chromium and a PostgreSQL clone alongside the Control Plane (Fastify, PostgreSQL 16 + `pgvector`, Valkey, BullMQ), easily demands **12GB–16GB of RAM**. On an 8GB Raspberry Pi or budget VPS, naive execution results in immediate kernel Out-Of-Memory (OOM) panics, frozen tasks, and system crashes.

Graywolf resolves this through **Dynamic Host Profiling & Resource Admission Control**.

---

## 2. Dynamic Host Hardware Profiler

Upon orchestrator boot, the platform probes host hardware metrics via Node's `os` subsystem and Docker Engine capabilities:

```typescript
export interface HostCapacity {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  cpuCores: number;
  hardwareProfile: 'constrained' | 'standard' | 'enterprise';
  maxResourceTokens: number;
  defaultConcurrencyCap: number;
}
```

### 2.1 Hardware Profile Matrix

| Hardware Tier | Memory / CPU Threshold | Profile Key | Max Concurrent Tasks | Playwright Strategy | Default Container Limits |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Constrained** | $\le$ 8GB RAM or $\le$ 4 vCPUs | `constrained` | **1** | Serialized; Headless with `--single-process --disable-gpu` or mock API tests unless tagged `mandatory-e2e` | `--memory=2.0g --cpus=1.5` |
| **Standard** | 16GB – 32GB RAM & 6–12 vCPUs | `standard` | **3** | Full parallel Chromium E2E suites | `--memory=4.0g --cpus=2.0` |
| **Enterprise** | $\ge$ 64GB RAM & 16+ vCPUs | `enterprise` | **8+** | Distributed multi-browser parallel matrix | `--memory=8.0g --cpus=4.0` |

---

## 3. Weighted Resource Admission Scheduler

Tasks do not consume identical resources. A documentation update or frontend style tweak (Tier 0) consumes negligible CPU and RAM, whereas a full database migration with automated Playwright UI recording (Tier 2) requires substantial memory.

Graywolf introduces a **Token-Bucket Admission Scheduler**:

```
                                  [Task Queued for Dispatch]
                                              │
                                              ▼
                             ┌──────────────────────────────────┐
                             │ Pre-Flight Resource Evaluator    │
                             │ Calculates required Task Tokens  │
                             └────────────────┬─────────────────┘
                                              │
                                              ▼
                      ┌─────────────────────────────────────────────────┐
                      │ Host Admission Gatekeeper                       │
                      │ Checks: (ActiveTokens + TaskTokens) <= MaxTokens│
                      └───────────────────────┬─────────────────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
                 [CAPACITY AVAILABLE]                     [CAPACITY SATURATED]
                         │                                         │
                         ▼                                         ▼
            Acquire Tokens & Launch Docker            Keep in QUEUED / READY State
            Sandbox with cgroup limits                Wait for active task to release
```

### 3.1 Task Token Weights

```typescript
export function calculateTaskTokens(task: TaskBrief, config: ProjectConfig): number {
  let tokens = 1.0; // Base: Worktree + Node.js/Python relay

  // Database Weight
  if (task.dbTier === 'isolated') {
    tokens += 1.0; // Template DB clone overhead
  }

  // Visual E2E Browser Weight
  if (task.tags.includes('ui-change') || task.tags.includes('mandatory-e2e')) {
    tokens += 1.5; // Chromium headless process allocation
  }

  return tokens;
}
```

- On a **Constrained Host (Max Tokens = 2.5)**:
  - A Tier 0 frontend task (1.0 token) and a documentation task (1.0 token) can run concurrently.
  - A full Tier 2 task with Playwright (3.5 tokens) will run strictly solo, and the scheduler temporarily throttles background lockfile cache-baking until the task completes.

---

## 4. Container cgroup Enforcement (OOM Containment)

To ensure an unruly build script (e.g. `npm build` running out of memory during Webpack bundle optimization) never crashes the host OS:
1. **Hard Memory Caps**: Every ephemeral container is spawned with `--memory` and `--memory-swap` set identically to prevent host thrashing.
2. **PID Limits**: `--pids-limit=512` prevents fork bombs during test iterations.
3. **Graceful OOM Handling**: If a task hits an OOM error (Docker exit code `137`), `relay.mjs` catches the SIGKILL signal and emits a structured `result.json` noting:
   > *"Container exceeded memory ceiling (2.0GB). Task halted gracefully. Recommend splitting into smaller modules or increasing host memory allocation."*

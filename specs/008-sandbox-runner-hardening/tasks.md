---

description: "Detailed step-by-step task list for Phase 6 — Hardened Docker Sandbox Runner & Resource Admission"
---

# Tasks: 008-sandbox-runner-hardening

**Input**: Design documents from `/specs/008-sandbox-runner-hardening/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/docker-admission-egress.md`, `quickstart.md`

**Tests**: Included per `spec.md` (`SC-001`–`SC-004`) and `docs/implementation-plan-detailed.md` Phase 6 verification requirements (`tests/unit/docker-runner.test.ts`, `tests/unit/admission.test.ts`, and `bash -n scripts/egress-rules.sh`).

**Organization**: Tasks are grouped by user story (`US1`–`US3`) and written with explicit signatures, exact field names, and implementation instructions so any fast/lightweight coding model can execute each task deterministically without guessing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ensure target directories (`config/`, `docker/runner/`, `scripts/`) exist before writing Phase 6 artifacts.

- [x] T001 Create `config/`, `docker/runner/`, and `scripts/` directories if not present (`mkdir -p config docker/runner scripts`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend `TaskSandboxOptions` in `src/orchestrator/runner/IRunnerProvider.ts` with optional Phase 6 fields so `DockerRunnerProvider` and `orchestrator.ts` share strongly typed sandbox options without breaking existing callers.

**⚠️ CRITICAL**: Complete before starting User Story 1 (`T003`–`T006`).

- [x] T002 Extend `TaskSandboxOptions` in `src/orchestrator/runner/IRunnerProvider.ts` by adding optional fields `projectId?: string`, `worktreePath?: string`, `parentGitDir?: string`, `pkgCacheDir?: string`, `relayDir?: string`, and `memoryBytes?: number` while keeping all existing fields (`taskId`, `image`, `bindMounts`, `env`, `networkMode`, `command`) unchanged

**Checkpoint**: `IRunnerProvider.ts` foundation ready — User Stories 1, 2, and 3 can now be implemented.

---

## Phase 3: User Story 1 - Seccomp Profile & Hardened `DockerRunnerProvider` (Priority: P1) 🎯 MVP

**Goal**: Author `config/seccomp.json` blocking dangerous Linux kernel syscalls and implement `DockerRunnerProvider` in `src/orchestrator/runner/docker.ts` generating hardened Dockerode `CreateContainerOptions` (`User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt`, `Tmpfs`, bind mounts) and mapping exit code `137` to `SANDBOX_OOM_KILLED`.

**Independent Test**: Run `pnpm test tests/unit/docker-runner.test.ts` verifying `config/seccomp.json` syscall deny rules, generated `CreateContainerOptions`, `startSandbox` / `teardownSandbox` / `waitForExit` (including exit code `137` -> `SANDBOX_OOM_KILLED` and proxy unreachable -> `SANDBOX_DOCKER_PROXY_UNREACHABLE`), and `pruneDanglingTaskContainers()`.

### Implementation for User Story 1

- [x] T003 [P] [US1] Create `config/seccomp.json` with valid JSON structure: `{ "defaultAction": "SCMP_ACT_ALLOW", "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_AARCH64"], "syscalls": [{ "names": ["ptrace", "bpf", "chroot", "mount", "umount2", "unshare", "setns", "kexec_load", "init_module"], "action": "SCMP_ACT_ERRNO", "args": [] }] }`
- [x] T004 [US1] Implement `DockerRunnerProvider` constructor, Docker host URL parser (`tcp://host:port` -> `{ host, port, protocol: 'http' }` or unix socket `{ socketPath }`), and `buildContainerCreateOptions(options: TaskSandboxOptions): Docker.ContainerCreateOptions` in `src/orchestrator/runner/docker.ts` with exact settings:
  - Container `name`: `` `gw-task-${options.taskId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}` ``
  - `Image`: `options.image || 'graywolf-runner:latest'`
  - `User`: `'10001:10001'`
  - `Cmd`: `options.command ?? ['node', '/relay/relay.mjs']`
  - `Env`: convert `options.env` record to `['KEY=VALUE']` array
  - `Labels`: `{ 'graywolf.managed': 'true', 'graywolf.taskId': options.taskId }`
  - `HostConfig.ReadonlyRootfs`: `true`
  - `HostConfig.CapDrop`: `['ALL']`
  - `HostConfig.SecurityOpt`: `['no-new-privileges:true', `seccomp=${seccompJsonCompactString}`]` (reading `config/seccomp.json` from disk)
  - `HostConfig.NetworkMode`: `options.networkMode ?? env.RUNNER_DOCKER_NETWORK`
  - `HostConfig.Memory`: `options.memoryBytes ?? 4 * 1024 * 1024 * 1024`
  - `HostConfig.Tmpfs`: `{ '/tmp': 'rw,noexec,nosuid,size=512m', '/scratch/spill': 'rw,noexec,nodev,size=2g' }`
  - `HostConfig.Binds`: build array containing:
    1. If `options.worktreePath`: `` `${path.resolve(options.worktreePath)}:/workspace:rw` ``
    2. If `options.parentGitDir`: `` `${path.resolve(options.parentGitDir)}:${path.resolve(options.parentGitDir)}:ro` ``
    3. Package cache: `` `${options.pkgCacheDir ? path.resolve(options.pkgCacheDir) : `pkg-cache-${options.projectId ?? 'default'}`}:/home/graywolf/.npm:rw` ``
    4. Relay harness: `` `${path.resolve(options.relayDir ?? 'src/relay')}:/relay:ro` ``
    5. Any additional entries from `options.bindMounts` formatted as `` `${m.source}:${m.target}:${m.readonly ? 'ro' : 'rw'}` `` (deduplicated)
- [x] T005 [US1] Implement `startSandbox`, `teardownSandbox`, `waitForExit`, and `pruneDanglingTaskContainers` in `src/orchestrator/runner/docker.ts`:
  - `startSandbox(options)`: calls `this.docker.createContainer(createOpts)` and `await container.start()`, stores `container.id` in an internal `Map<string, string>` keyed by `taskId`, and returns `{ containerId: container.id }`. If the error message/code contains `ECONNREFUSED`, `ENOENT`, or `EHOSTUNREACH`, throw `new GraywolfAppError('SANDBOX_DOCKER_PROXY_UNREACHABLE', ...)` (503); otherwise throw `new GraywolfAppError('SANDBOX_PROVISIONING_FAILED', ...)` (500).
  - `teardownSandbox(taskId)`: looks up container by `taskId` (or container name `gw-task-${taskId.toLowerCase()}`), calls `container.remove({ force: true, v: true })` (ignoring 404 Not Found), and deletes from map.
  - `waitForExit(taskId)`: calls `await container.wait()`, extracts `StatusCode` (default `0`), and if `StatusCode === 137`, throws `new GraywolfAppError('SANDBOX_OOM_KILLED', `Container for task '${taskId}' was killed due to Out-Of-Memory (exit code 137)`, { taskId, exitCode: 137 })`; otherwise returns `StatusCode`.
  - `pruneDanglingTaskContainers()`: lists containers with `all: true`, filters for names starting with `/gw-task-` or `gw-task-` (or label `graywolf.managed=true`), force-removes them, and returns their removed container names/IDs.
- [x] T006 [US1] Create unit test suite in `tests/unit/docker-runner.test.ts` testing:
  1. `config/seccomp.json` parses as valid JSON and blocks all 9 required syscalls (`ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, `init_module`) with `SCMP_ACT_ERRNO`.
  2. `buildContainerCreateOptions` sets `User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `no-new-privileges:true`, `seccomp=`, `Tmpfs` (`/tmp` and `/scratch/spill`), and all 4 required bind mounts (`/workspace:rw`, parent `.git:ro`, `/home/graywolf/.npm:rw`, `/relay:ro`).
  3. `startSandbox` creates and starts a container via mocked `dockerode` client and maps `ECONNREFUSED` to `SANDBOX_DOCKER_PROXY_UNREACHABLE` (503).
  4. `waitForExit` returns normal exit codes (`0`, `1`) and throws `GraywolfAppError('SANDBOX_OOM_KILLED')` (500) when `StatusCode === 137`.
  5. `teardownSandbox` and `pruneDanglingTaskContainers` remove `gw-task-*` containers cleanly.

**Checkpoint**: User Story 1 is complete and independently verified by `tests/unit/docker-runner.test.ts`.

---

## Phase 4: User Story 2 - Hardware Profiler & Weighted Admission Token Bucket (PRD §15) (Priority: P1)

**Goal**: Profile host hardware (`os.totalmem()`, `os.cpus()`) to distinguish `Constrained Profile` (≤8GB RAM: 1 container, 2GB RAM limit, `--single-process --disable-gpu`) from `Standard Profile` (≥16GB RAM: 3 containers, 4GB RAM limit) and enforce a weighted token bucket (`tier-0-mock` = `1.0`, `tier-1-shared-db` = `2.0`, `tier-2-isolated-db` = `3.0`, + `0.5` for E2E).

**Independent Test**: Run `pnpm test tests/unit/admission.test.ts` testing 8GB vs 16GB hardware profiles, task weight calculation (`1.0`, `1.5`, `2.0`, `2.5`, `3.0`, `3.5`), and token bucket admission/release queueing.

### Implementation for User Story 2

- [x] T007 [P] [US2] Implement `profileHostHardware` and `calculateTaskAdmissionWeight` in `src/orchestrator/runner/admission.ts`:
  - `profileHostHardware(overrides?: { totalMemBytes?: number; cpuCount?: number }): HardwareProfile`:
    - `totalMemBytes = overrides?.totalMemBytes ?? os.totalmem()`
    - `cpuCount = overrides?.cpuCount ?? os.cpus().length`
    - `EIGHT_GB = 8 * 1024 * 1024 * 1024` (`8589934592`)
    - If `totalMemBytes <= EIGHT_GB`: return `{ profile: 'constrained', totalMemBytes, cpuCount, maxConcurrentContainers: 1, containerMemoryBytes: 2 * 1024 * 1024 * 1024, maxTokenBudget: 3.5, playwrightFlags: ['--single-process', '--disable-gpu'] }`
    - Else: return `{ profile: 'standard', totalMemBytes, cpuCount, maxConcurrentContainers: 3, containerMemoryBytes: 4 * 1024 * 1024 * 1024, maxTokenBudget: 6.0, playwrightFlags: ['--disable-dev-shm-usage'] }`
  - `calculateTaskAdmissionWeight(input: { dbTier: SandboxDbTier; requiresBrowserE2E?: boolean }): number`:
    - Base weight: `'tier-0-mock'` -> `1.0`, `'tier-1-shared-db'` -> `2.0`, `'tier-2-isolated-db'` -> `3.0`
    - Add `0.5` if `input.requiresBrowserE2E === true`
    - Return total (e.g. `tier-2-isolated-db` + `requiresBrowserE2E: true` = `3.5`)
- [x] T008 [US2] Implement `AdmissionController` class in `src/orchestrator/runner/admission.ts`:
  - Constructor accepts optional `HardwareProfile` (defaults to `profileHostHardware()`).
  - Maintains `activeTickets = new Map<string, { taskId: string; weight: number; dbTier: SandboxDbTier; requiresBrowserE2E: boolean; acquiredAt: number }>()`.
  - `getProfile()`, `getActiveCount()`, `getConsumedTokens()` (sums `weight` of all active tickets).
  - `canAdmit(input: { taskId: string; dbTier: SandboxDbTier; requiresBrowserE2E?: boolean })`:
    - If `activeTickets.has(input.taskId)` return `true` (idempotent).
    - If `this.getActiveCount() >= this.profile.maxConcurrentContainers` return `false`.
    - Compute `weight = calculateTaskAdmissionWeight(input)`.
    - If `this.getActiveCount() === 0` return `true` (always allow a single task when idle so a 3.5-token task never deadlocks).
    - Return `this.getConsumedTokens() + weight <= this.profile.maxTokenBudget`.
  - `tryAcquire(input)`: checks `canAdmit(input)`; if `false`, returns `{ admitted: false, weight, reason: ... }`; if `true`, stores ticket in `activeTickets` and returns `{ admitted: true, weight }`.
  - `release(taskId: string): boolean`: deletes `taskId` from `activeTickets`.
- [x] T009 [US2] Create unit test suite in `tests/unit/admission.test.ts` testing:
  1. `profileHostHardware` with 4GB and 8GB RAM returns `profile: 'constrained'`, `maxConcurrentContainers: 1`, `containerMemoryBytes: 2147483648` (`2g`), and `playwrightFlags: ['--single-process', '--disable-gpu']`.
  2. `profileHostHardware` with 16GB and 32GB RAM returns `profile: 'standard'`, `maxConcurrentContainers: 3`, and `containerMemoryBytes: 4294967296` (`4g`).
  3. `calculateTaskAdmissionWeight` returns `1.0` (Tier 0), `1.5` (Tier 0 + E2E), `2.0` (Tier 1), `2.5` (Tier 1 + E2E), `3.0` (Tier 2), and `3.5` (Tier 2 + E2E).
  4. `AdmissionController` enforces `maxConcurrentContainers = 1` on Constrained profile and token budget ceiling (`6.0`) on Standard profile (e.g., two Tier 2 tasks = `6.0` tokens admitted, third task rejected until `release()` is called).

**Checkpoint**: User Story 2 is complete and independently verified by `tests/unit/admission.test.ts`.

---

## Phase 5: User Story 3 - Sandbox Network Egress Firewall Script & Runner Dockerfile (PRD §13.3) (Priority: P1)

**Goal**: Provide `docker/runner/Dockerfile` (Node 20 + Git + `ripgrep` + `ast-grep` + `gitleaks` + `osv-scanner` + Playwright Chromium + non-root user `graywolf` `10001:10001`) and `scripts/egress-rules.sh` configuring `DOCKER-USER` iptables rules for `runner-net`.

**Independent Test**: Run `bash -n scripts/egress-rules.sh && bash scripts/egress-rules.sh --dry-run` and verify `tests/unit/docker-runner.test.ts` checks both `docker/runner/Dockerfile` and `scripts/egress-rules.sh`.

### Implementation for User Story 3

- [x] T010 [P] [US3] Create `docker/runner/Dockerfile` based on `node:20-bookworm-slim` that installs `git`, `ripgrep`, `ca-certificates`, `curl`, `ast-grep`, `gitleaks`, `osv-scanner`, and Playwright Chromium (`npx playwright install --with-deps chromium`), creates group and user `graywolf` with `UID 10001` and `GID 10001` (`groupadd -g 10001 graywolf && useradd -m -u 10001 -g 10001 -s /bin/bash graywolf`), creates `/workspace` and `/relay`, and sets `USER 10001:10001` and `WORKDIR /workspace`
- [x] T011 [P] [US3] Create executable `scripts/egress-rules.sh` (`chmod +x scripts/egress-rules.sh`) supporting `--dry-run` (or `DRY_RUN=1`) that outputs/applies `DOCKER-USER` iptables rules for `runner-net`:
  - Allow `ESTABLISHED,RELATED` traffic
  - Allow TCP to `orchestrator` port `3001` (ARP WebSocket)
  - Allow TCP to `litellm-proxy` port `4000` (LiteLLM Gateway)
  - Allow UDP/TCP port `53` (DNS)
  - Explicitly `DROP` TCP to `orchestrator` port `3000` (Control Plane REST API), port `5432` (PostgreSQL), and port `6379` (Valkey)
  - Allow HTTPS (`443`) to allowlisted package registries / Git remotes
  - Default `DROP` all other outbound traffic from `runner-net`
- [x] T012 [US3] Add test cases in `tests/unit/docker-runner.test.ts` executing `bash -n scripts/egress-rules.sh` and `bash scripts/egress-rules.sh --dry-run` (verifying `DOCKER-USER`, `3001`, `4000`, and `DROP` rules for `3000`/`5432`/`6379`) and asserting `docker/runner/Dockerfile` contains `10001:10001`, `playwright`, `ripgrep`, `ast-grep`, `gitleaks`, and `osv-scanner`

**Checkpoint**: User Story 3 is complete and verified by `bash -n scripts/egress-rules.sh` and `tests/unit/docker-runner.test.ts`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Wire `AdmissionController` into `src/orchestrator/workers/orchestrator.ts` (optional pre-flight admission hook) and run full verification.

- [x] T013 Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, and `bash -n scripts/egress-rules.sh`, and mark Tasks 6.1–6.3 `[x]` in `docs/implementation-plan-detailed.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1: T001)**: No dependencies — starts immediately.
- **Foundational (Phase 2: T002)**: Depends on T001.
- **User Story 1 (Phase 3: T003–T006)**: Depends on T002.
- **User Story 2 (Phase 4: T007–T009)**: Independent of US1; can run in parallel after T001.
- **User Story 3 (Phase 5: T010–T012)**: `T010` and `T011` can run in parallel after T001; `T012` appends to `tests/unit/docker-runner.test.ts` after `T006`.
- **Polish (Phase 6: T013)**: Depends on `T001`–`T012` completing.

### Parallel Opportunities

- `T003` (`config/seccomp.json`), `T007` (`src/orchestrator/runner/admission.ts`), `T010` (`docker/runner/Dockerfile`), and `T011` (`scripts/egress-rules.sh`) touch completely separate files and can be executed in parallel.

---

## Parallel Example: Phase 6 Artifacts

```bash
# Execute independent files in parallel:
Task T003: "Create config/seccomp.json"
Task T007: "Implement profileHostHardware and calculateTaskAdmissionWeight in src/orchestrator/runner/admission.ts"
Task T010: "Create docker/runner/Dockerfile"
Task T011: "Create scripts/egress-rules.sh"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (`T001`) and Phase 2 (`T002`).
2. Complete Phase 3 (`T003`–`T006`) and verify `pnpm test tests/unit/docker-runner.test.ts`.

### Incremental Delivery

1. Add Hardware Profiler & Weighted Admission Token Bucket (`T007`–`T009`) → Verify with `pnpm test tests/unit/admission.test.ts`.
2. Add Runner Dockerfile & Egress Firewall Script (`T010`–`T012`) → Verify with `bash -n scripts/egress-rules.sh` and `pnpm test tests/unit/docker-runner.test.ts`.
3. Run full verification (`T013`).

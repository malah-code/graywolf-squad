# Feature Specification: 008-sandbox-runner-hardening

**Feature Branch**: `008-sandbox-runner-hardening`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 6 — Hardened Docker Sandbox Runner & Resource Admission (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 6 (`specs/008-sandbox-runner-hardening/`); `docs/PRD.md` §13.3, §15; `docs/architecture/sandbox-and-testing.md`; ADR-040, ADR-042

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seccomp Profile & Hardened `DockerRunnerProvider` (`IRunnerProvider`) (Priority: P1)

Every agent task executes inside an isolated, OS-hardened ephemeral Docker container managed through `DockerRunnerProvider` (`src/orchestrator/runner/docker.ts`, implementing `IRunnerProvider` from ADR-040) over the restricted Docker Socket Proxy (`env.DOCKER_HOST`). To prevent container breakouts or privilege escalation:
1. **Seccomp Profile (`config/seccomp.json`)**: Explicitly blocks dangerous Linux kernel syscalls (`ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, `init_module`).
2. **Hardened Container Spec (`DockerRunnerProvider`)**:
   - Runs as non-root user `'10001:10001'` (`graywolf`).
   - Enforces `HostConfig.ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt: ['no-new-privileges:true', 'seccomp=...']`, and `NetworkMode: env.RUNNER_DOCKER_NETWORK` (`graywolf-squad_runner-net`).
   - Mounts writable bounded `Tmpfs` volumes at `/tmp:rw,noexec,nosuid,size=512m` and `/scratch/spill:rw,noexec,nodev,size=2g`.
   - Configures bind mounts for the task worktree (`/workspace:rw`), parent `.git` directory (`:ro`), project package cache (`pkg-cache-<projectId>` -> `/home/graywolf/.npm:rw`), and relay harness (`src/relay` -> `/relay:ro`).
   - Detects container exit code `137` in `waitForExit` and throws `GraywolfAppError('SANDBOX_OOM_KILLED')` (HTTP 500, retryable: false).

**Why this priority**: Enforces defense-in-depth container isolation so untrusted LLM-generated code cannot escalate privileges, mutate the root filesystem, or access the host Docker socket (Constitution Principle 1).

**Independent Test**: Run `tests/unit/docker-runner.test.ts` inspecting the generated Dockerode `CreateContainerOptions` (`User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, seccomp security options, tmpfs mounts, bind mounts) and verifying exit code `137` maps to `SANDBOX_OOM_KILLED`.

**Acceptance Scenarios**:

1. **Given** `config/seccomp.json`, **When** parsed, **Then** it contains a valid seccomp rule blocking `ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, and `init_module` with `SCMP_ACT_ERRNO`.
2. **Given** a task sandbox request, **When** `DockerRunnerProvider.startSandbox` builds Dockerode `CreateContainerOptions`, **Then** `User` is `'10001:10001'`, `HostConfig.ReadonlyRootfs` is `true`, `HostConfig.CapDrop` is `['ALL']`, `SecurityOpt` includes `no-new-privileges:true` and the seccomp profile, and `Tmpfs` mounts `/tmp` (`512m`) and `/scratch/spill` (`2g`).
3. **Given** a running sandbox container that exits with code `137` (SIGKILL / OOM), **When** `waitForExit` resolves, **Then** it throws `GraywolfAppError('SANDBOX_OOM_KILLED')`.

---

### User Story 2 - Hardware Profiler & Weighted Admission Token Bucket (PRD §15) (Priority: P1)

To support both edge devices (e.g., Raspberry Pi 5 with 8GB RAM) and standard developer workstations (16GB+ RAM) without exhausting host memory, the Hardware Profiler & Admission Controller (`src/orchestrator/runner/admission.ts`):
1. **Profiles Host Hardware**: Inspects `os.totalmem()` and `os.cpus()` (or injected hardware overrides for deterministic testing).
   - **Constrained Profile (RAM ≤ 8GB)**: Caps `maxConcurrentContainers = 1`, container memory limit `2g` (`2 * 1024 * 1024 * 1024` bytes), and Playwright browser launch flags `['--single-process', '--disable-gpu']`.
   - **Standard Profile (RAM ≥ 16GB, or > 8GB)**: Sets default `maxConcurrentContainers = 3`, container memory limit `4g` (`4 * 1024 * 1024 * 1024` bytes), and standard Playwright flags.
2. **Weighted Admission Token Bucket**: Assigns each task a resource weight based on its database isolation tier and E2E browser requirement:
   - `tier-0-mock` = `1.0` token
   - `tier-1-shared-db` = `2.0` tokens
   - `tier-2-isolated-db` = `3.0` tokens
   - `+ 0.5` tokens when `requiresBrowserE2E: true` (e.g., `tier-2-isolated-db` + E2E = `3.5` tokens).
   Enforces token capacity so tasks exceeding available budget wait in queue until active tasks release their tokens.

**Why this priority**: Prevents host OOM crashes when running heavy Tier 2 + Playwright tasks concurrently on constrained or standard hardware.

**Independent Test**: Run `tests/unit/admission.test.ts` testing 8GB (`Constrained Profile`) vs 16GB (`Standard Profile`) hardware detection, task weight calculation (`1.0`, `2.0`, `3.0`, `3.5`), and token bucket acquisition/release queueing.

**Acceptance Scenarios**:

1. **Given** host RAM of 8GB (`8 * 1024 ** 3`), **When** `profileHostHardware` runs, **Then** it returns `profile: 'constrained'`, `maxConcurrentContainers: 1`, `containerMemoryBytes: 2147483648` (`2g`), and `playwrightFlags: ['--single-process', '--disable-gpu']`.
2. **Given** host RAM of 16GB (`16 * 1024 ** 3`), **When** `profileHostHardware` runs, **Then** it returns `profile: 'standard'`, `maxConcurrentContainers: 3`, and `containerMemoryBytes: 4294967296` (`4g`).
3. **Given** a `tier-2-isolated-db` task with `requiresBrowserE2E: true`, **When** `calculateTaskAdmissionWeight` runs, **Then** it returns `3.5` tokens.

---

### User Story 3 - Sandbox Network Egress Firewall Script & Runner Dockerfile (PRD §13.3) (Priority: P1)

To ensure sandboxed containers cannot access the Control Plane REST API (`orchestrator:3000`), PostgreSQL (`5432`), Valkey (`6379`), or arbitrary internet hosts:
1. **Runner Image (`docker/runner/Dockerfile`)**: Defines a hardened Node 20 base image with `git`, `ripgrep`, `ast-grep`, `gitleaks`, `osv-scanner`, Playwright Chromium, and non-root user `graywolf` (`UID 10001`, `GID 10001`).
2. **Egress Firewall (`scripts/egress-rules.sh`)**: Configures `DOCKER-USER` iptables rules for the `runner-net` bridge allowing outbound traffic **only** to `orchestrator:3001` (ARP WebSocket), `litellm-proxy:4000` (LLM Gateway), DNS (`53`), and explicitly allowlisted package registries / Git remotes, while dropping all other traffic (specifically blocking `orchestrator:3000`, PostgreSQL `5432`, and Valkey `6379`).

**Why this priority**: Enforces network-level isolation so a compromised agent container cannot bypass the ARP gateway or query the tenant database directly (PRD §13.3).

**Independent Test**: Run `bash -n scripts/egress-rules.sh` syntax validation and unit tests in `tests/unit/docker-runner.test.ts` verifying the generated iptables rules and `docker/runner/Dockerfile` hardening directives.

**Acceptance Scenarios**:

1. **Given** `scripts/egress-rules.sh`, **When** `bash -n scripts/egress-rules.sh` and `--dry-run` execute, **Then** syntax validation exits `0` and outputs `DOCKER-USER` rules allowing `3001` (ARP) and `4000` (LiteLLM) while dropping `3000` (Control Plane), `5432` (Postgres), `6379` (Valkey), and default egress.
2. **Given** `docker/runner/Dockerfile`, **When** inspected, **Then** it creates user `graywolf` with `10001:10001` and switches to `USER 10001:10001`.

---

### Edge Cases

- **Docker Socket Proxy Unreachable**: When `dockerode` fails to connect to `env.DOCKER_HOST` (`ECONNREFUSED` / `ENOENT`), `DockerRunnerProvider.startSandbox` maps the error to `GraywolfAppError('SANDBOX_DOCKER_PROXY_UNREACHABLE')` (HTTP 503, retryable: true).
- **Single Heavy Task on Constrained Host**: If a single task requires `3.5` tokens (Tier 2 + E2E) on a host whose total token capacity is smaller (e.g., `3.0` tokens on Constrained Profile) and `0` tasks are currently running, the admission bucket allows that single task to execute when the active queue is empty (`activeCount === 0`) so heavy tasks never deadlock on an 8GB device.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide `config/seccomp.json` blocking `ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, and `init_module`.
- **FR-002**: System MUST implement `DockerRunnerProvider` (`implements IRunnerProvider`) in `src/orchestrator/runner/docker.ts` using `dockerode` with `User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt: ['no-new-privileges:true', seccomp]`, `NetworkMode: env.RUNNER_DOCKER_NETWORK`, `Tmpfs` (`/tmp` 512m, `/scratch/spill` 2g), bind mounts (`/workspace:rw`, parent `.git:ro`, `pkg-cache-<projectId>` -> `/home/graywolf/.npm:rw`, `src/relay` -> `/relay:ro`), and exit code `137` -> `SANDBOX_OOM_KILLED` mapping.
- **FR-003**: System MUST implement the Hardware Profiler and Weighted Admission Token Bucket in `src/orchestrator/runner/admission.ts` profiling host RAM/CPUs (`Constrained Profile` ≤8GB: `maxConcurrentContainers = 1`, `2g` memory, `--single-process --disable-gpu`; `Standard Profile` ≥16GB: `maxConcurrentContainers = 3`, `4g` memory) and enforcing task token weights (Tier 0 = `1.0`, Tier 1 = `2.0`, Tier 2 = `3.0`, + `0.5` for E2E).
- **FR-004**: System MUST provide `scripts/egress-rules.sh` (configuring `DOCKER-USER` iptables rules for `runner-net` allowing `orchestrator:3001`, `litellm-proxy:4000`, and allowlisted endpoints while dropping `orchestrator:3000`, Postgres `5432`, Valkey `6379`, and all other outbound traffic) and `docker/runner/Dockerfile` (Node 20 + CLI guards + Playwright Chromium + UID `10001:10001`).

### Key Entities

- **HardwareProfile**: `{ profile: 'constrained' | 'standard'; totalMemBytes: number; cpuCount: number; maxConcurrentContainers: number; containerMemoryBytes: number; maxTokenBudget: number; playwrightFlags: string[] }`.
- **AdmissionTicket**: `{ taskId: string; weight: number; tier: SandboxDbTier; requiresBrowserE2E: boolean; acquiredAt: number }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `DockerRunnerProvider` generates Dockerode `CreateContainerOptions` with `10001:10001`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, seccomp profile, tmpfs mounts, and maps exit code `137` to `SANDBOX_OOM_KILLED` in `tests/unit/docker-runner.test.ts`.
- **SC-002**: `src/orchestrator/runner/admission.ts` accurately classifies 8GB (`Constrained Profile`) vs 16GB (`Standard Profile`) hardware, computes weights (`1.0`, `2.0`, `3.0`, `3.5`), and enforces token bucket admission in `tests/unit/admission.test.ts`.
- **SC-003**: `bash -n scripts/egress-rules.sh` exits `0`, `--dry-run` emits valid `DOCKER-USER` iptables rules, and `docker/runner/Dockerfile` defines `10001:10001`.
- **SC-004**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` pass with 0 errors and 0 warnings.

## Assumptions

- `dockerode` (`^5.0.1`) and `@types/dockerode` (`^4.0.1`) are already installed in `package.json`.
- `scripts/egress-rules.sh` supports a `--dry-run` / `--print-rules` mode so unit tests can validate generated iptables commands without requiring root `CAP_NET_ADMIN` privileges during `pnpm test`.

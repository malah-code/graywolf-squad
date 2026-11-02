# Phase 0 Research: 008-sandbox-runner-hardening

**Feature Branch**: `008-sandbox-runner-hardening`  
**Date**: 2026-10-18  
**Status**: Complete (0 unknowns remaining)

## 1. Seccomp Profile & Hardened `DockerRunnerProvider` (`config/seccomp.json`, `src/orchestrator/runner/docker.ts`)

- **Decision**:
  - Author `config/seccomp.json` with default action `SCMP_ACT_ALLOW` (or standard container seccomp baseline) and an explicit `SCMP_ACT_ERRNO` deny rule blocking `ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, and `init_module`.
  - Implement `DockerRunnerProvider implements IRunnerProvider` (`src/orchestrator/runner/docker.ts`) using `dockerode` pointed at `env.DOCKER_HOST`:
    - `name`: `gw-task-${taskId.toLowerCase()}`
    - `User`: `'10001:10001'`
    - `HostConfig`:
      - `ReadonlyRootfs: true`
      - `CapDrop: ['ALL']`
      - `SecurityOpt: ['no-new-privileges:true', `seccomp=${seccompJsonString}`]`
      - `NetworkMode: options.networkMode ?? env.RUNNER_DOCKER_NETWORK`
      - `Memory`: memory limit from `HardwareProfile` (`2g` on Constrained ≤8GB, `4g` on Standard ≥16GB)
      - `Tmpfs`: `{ '/tmp': 'rw,noexec,nosuid,size=512m', '/scratch/spill': 'rw,noexec,nodev,size=2g' }`
      - `Binds`: worktree -> `/workspace:rw`, parent `.git` -> `:ro`, `pkg-cache-<projectId>` -> `/home/graywolf/.npm:rw`, `src/relay` -> `/relay:ro` (merged with any custom `options.bindMounts`).
    - In `waitForExit(taskId)`: inspect exit status code; if `StatusCode === 137`, throw `new GraywolfAppError('SANDBOX_OOM_KILLED', ...)` (HTTP 500, `retryable: false`).
    - On connection errors (`ECONNREFUSED`, `ENOENT`, `EHOSTUNREACH`) when talking to `docker-proxy`, throw `new GraywolfAppError('SANDBOX_DOCKER_PROXY_UNREACHABLE', ...)` (HTTP 503, `retryable: true`).
- **Rationale**: Satisfies PRD §13.3, ADR-040 (`IRunnerProvider`), and ADR-042 (`SANDBOX_*` error codes) with deterministic unit testability via `buildContainerCreateOptions`.
- **Alternatives Considered**:
  - Running containers with `--privileged` or root UID `0` (rejected: violates Constitution Principle 1 and PRD §13.3).

## 2. Hardware Profiler & Weighted Admission Token Bucket (`src/orchestrator/runner/admission.ts`)

- **Decision**:
  - Implement `profileHostHardware(overrides?: { totalMemBytes?: number; cpuCount?: number })`:
    - Reads `os.totalmem()` and `os.cpus().length` (or `overrides`).
    - If `totalMemBytes <= 8 * 1024 ** 3` (≤8GB RAM, `Constrained Profile`, e.g., Raspberry Pi 5):
      - `profile: 'constrained'`
      - `maxConcurrentContainers: 1`
      - `containerMemoryBytes: 2 * 1024 ** 3` (`2g`)
      - `maxTokenBudget: 3.5` (or `1` container slot; allows a single task up to 3.5 tokens when `activeCount === 0`)
      - `playwrightFlags: ['--single-process', '--disable-gpu']`
    - Else (`Standard Profile`, >8GB / ≥16GB RAM):
      - `profile: 'standard'`
      - `maxConcurrentContainers: 3`
      - `containerMemoryBytes: 4 * 1024 ** 3` (`4g`)
      - `maxTokenBudget: 6.0`
      - `playwrightFlags: ['--disable-dev-shm-usage']`
  - Implement `calculateTaskAdmissionWeight({ dbTier, requiresBrowserE2E })`:
    - `tier-0-mock` = `1.0`
    - `tier-1-shared-db` = `2.0`
    - `tier-2-isolated-db` = `3.0`
    - `+ 0.5` if `requiresBrowserE2E === true` (so `tier-2-isolated-db` + E2E = `3.5`).
  - Implement `AdmissionController` managing active task tickets, concurrency ceiling (`maxConcurrentContainers`), and weighted token bucket capacity (`canAdmit`, `acquireAdmission`, `releaseAdmission`).
- **Rationale**: Prevents host OOM crashes on edge 8GB devices and multi-container workstations alike (PRD §15).
- **Alternatives Considered**:
  - Simple unweighted task count limit (rejected: 3 concurrent Tier 2 + Chromium tasks would consume ~12GB RAM, whereas 3 Tier 0 tasks consume <1.5GB).

## 3. Sandbox Network Egress Firewall Script & Runner Dockerfile (`scripts/egress-rules.sh`, `docker/runner/Dockerfile`)

- **Decision**:
  - Author `docker/runner/Dockerfile` based on `node:20-bookworm-slim` installing `git`, `ripgrep`, `ast-grep`, `gitleaks`, `osv-scanner`, Playwright Chromium dependencies, creating non-root user `graywolf` (`UID 10001`, `GID 10001`), and setting `USER 10001:10001`.
  - Author `scripts/egress-rules.sh` supporting `--dry-run` (prints generated `iptables` rules without executing) and live execution mode:
    - Configures `DOCKER-USER` chain for `runner-net` bridge:
      - `ACCEPT` `ESTABLISHED,RELATED`
      - `ACCEPT` TCP to `orchestrator:3001` (ARP WebSocket)
      - `ACCEPT` TCP to `litellm-proxy:4000` (LiteLLM Gateway)
      - `ACCEPT` UDP/TCP port `53` (DNS resolution)
      - `DROP` TCP to `orchestrator:3000` (Control Plane REST API)
      - `DROP` TCP to port `5432` (PostgreSQL) and `6379` (Valkey)
      - `ACCEPT` TCP `443` to allowlisted package registries / Git remotes
      - `DROP` all remaining outbound traffic from `runner-net`.
- **Rationale**: Enforces PRD §13.3 network isolation while remaining testable in unprivileged CI environments via `bash -n` and `--dry-run`.
- **Alternatives Considered**:
  - Relying solely on application-level URL checks inside `relay.mjs` (rejected: defense-in-depth requires host `DOCKER-USER` iptables enforcement).

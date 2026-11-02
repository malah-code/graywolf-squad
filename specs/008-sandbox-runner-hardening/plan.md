# Implementation Plan: 008-sandbox-runner-hardening

**Branch**: `008-sandbox-runner-hardening` | **Date**: 2026-10-18 | **Spec**: [specs/008-sandbox-runner-hardening/spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-sandbox-runner-hardening/spec.md` and Phase 6 of `docs/implementation-plan-detailed.md`

## Summary

Implement the Phase 6 Hardened Docker Sandbox Runner, Seccomp Profile, Hardware Profiler & Weighted Admission Token Bucket, Runner Dockerfile, and Sandbox Network Egress Firewall Script:
1. **Seccomp Profile & Hardened `DockerRunnerProvider` (`config/seccomp.json`, `src/orchestrator/runner/docker.ts`)**: Author `config/seccomp.json` blocking dangerous syscalls (`ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, `init_module`) and implement `DockerRunnerProvider implements IRunnerProvider` using `dockerode` pointed at `env.DOCKER_HOST` with `User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt: ['no-new-privileges:true', seccomp]`, `NetworkMode: env.RUNNER_DOCKER_NETWORK`, `Tmpfs` (`/tmp` 512m, `/scratch/spill` 2g), bind mounts (`/workspace:rw`, parent `.git:ro`, `pkg-cache-<projectId>` -> `/home/graywolf/.npm:rw`, `src/relay` -> `/relay:ro`), and exit code `137` -> `SANDBOX_OOM_KILLED` mapping.
2. **Hardware Profiler & Weighted Admission Token Bucket (`src/orchestrator/runner/admission.ts`)**: Profile host hardware via `os.totalmem()` and `os.cpus()` (`Constrained Profile` ≤8GB RAM: `maxConcurrentContainers = 1`, `--memory=2g`, Playwright `--single-process --disable-gpu`; `Standard Profile` ≥16GB RAM: `maxConcurrentContainers = 3`, `--memory=4g`) and implement weighted token bucket admission (`tier-0-mock` = `1.0`, `tier-1-shared-db` = `2.0`, `tier-2-isolated-db` = `3.0`, + `0.5` for E2E browser tasks).
3. **Sandbox Network Egress Firewall Script & Runner Dockerfile (`scripts/egress-rules.sh`, `docker/runner/Dockerfile`)**: Author `docker/runner/Dockerfile` (Node 20 + Git + `ripgrep` + `ast-grep` + `gitleaks` + `osv-scanner` + Playwright Chromium + non-root user `graywolf` `10001:10001`) and `scripts/egress-rules.sh` configuring `DOCKER-USER` iptables rules for `runner-net` allowing only `orchestrator:3001` (ARP), `litellm-proxy:4000`, DNS, and allowlisted package registries / Git remotes while dropping `orchestrator:3000`, Postgres `5432`, Valkey `6379`, and all other outbound traffic.

## Technical Context

**Language/Version**: TypeScript 5.8+ on Node.js 20+ (`commonjs`) + Bash (`scripts/egress-rules.sh`) + Dockerfile  
**Primary Dependencies**: `dockerode` (`^5.0.1`), `node:os`, `node:fs`, `node:path`  
**Storage**: Ephemeral tmpfs (`/tmp`, `/scratch/spill`) and scoped Docker bind mounts (`/workspace:rw`, `.git:ro`, `/home/graywolf/.npm:rw`, `/relay:ro`)  
**Testing**: Vitest (`tests/unit/docker-runner.test.ts`, `tests/unit/admission.test.ts`) + `bash -n scripts/egress-rules.sh`  
**Target Platform**: Linux / Docker Engine via `docker-socket-proxy` (`tcp://docker-proxy:2375`)  
**Project Type**: Multi-Agent Orchestrator Sandbox Runtime & Admission Layer  
**Performance Goals**: Instantaneous (<1ms) hardware profiling and weighted token bucket admission checks  
**Constraints**: Non-root UID/GID `10001:10001`, `--read-only` rootfs, `--cap-drop=ALL`, seccomp profile enforcement, default-deny egress (`DOCKER-USER` iptables), ADR-040 `IRunnerProvider` interface compliance, and ADR-042 `SANDBOX_*` error codes  
**Scale/Scope**: Phase 6 of `docs/implementation-plan-detailed.md` (Tasks 6.1–6.3)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle 1 (Human Sovereignty & Non-Committing Relay Contract)**: ✅ PASS — Parent `.git` directory is mounted `:ro` (read-only) and `/relay` is mounted `:ro`, structurally preventing in-container agents from tampering with `.git/objects` or the relay harness.
- **Principle 2 & 9 (Zero Runtime Lock-In & Permissive Open Source)**: ✅ PASS — Uses `dockerode` (Apache-2.0) and standard Linux kernel namespaces/seccomp/iptables.
- **Principle 8 (Blast-Radius and Dependency Integrity)**: ✅ PASS — Provides `pruneDanglingTaskContainers()` for `pruneStaleResourcesOnBoot()` and enforces weighted admission limits so containers never exhaust host RAM.

## Project Structure

### Documentation (this feature)

```text
specs/008-sandbox-runner-hardening/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── docker-admission-egress.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
config/
└── seccomp.json                       # Task 6.1: Seccomp syscall deny profile

docker/
└── runner/
    └── Dockerfile                     # Task 6.3: Hardened Node 20 + CLI guards + Chromium runner image (10001:10001)

scripts/
└── egress-rules.sh                    # Task 6.3: DOCKER-USER iptables egress firewall script

src/orchestrator/runner/
├── IRunnerProvider.ts                 # ADR-040 interface
├── docker.ts                          # Task 6.1: Hardened DockerRunnerProvider (dockerode)
└── admission.ts                       # Task 6.2: Hardware profiler & weighted admission token bucket

tests/unit/
├── docker-runner.test.ts              # Task 6.1 & 6.3 verification
└── admission.test.ts                  # Task 6.2 verification
```

**Structure Decision**: Matches the exact file paths and module boundaries specified in `docs/implementation-plan-detailed.md` Phase 6 (Tasks 6.1–6.3).

## Complexity Tracking

No constitution violations or complexity exemptions required.

# Quickstart & Validation Guide: 008-sandbox-runner-hardening

**Feature Branch**: `008-sandbox-runner-hardening`  
**Date**: 2026-10-18

## Prerequisites

- Node.js 20+ and `pnpm`
- Bash shell (`bash`) for `scripts/egress-rules.sh` syntax and dry-run verification

## Validation Commands

1. **Seccomp & Hardened `DockerRunnerProvider` Unit Tests**:
   ```bash
   pnpm test tests/unit/docker-runner.test.ts
   ```
   - Verifies `config/seccomp.json` syscall deny list (`ptrace`, `bpf`, `chroot`, `mount`, `umount2`, `unshare`, `setns`, `kexec_load`, `init_module`), generated Dockerode `CreateContainerOptions` (`User: '10001:10001'`, `ReadonlyRootfs: true`, `CapDrop: ['ALL']`, `SecurityOpt`, `Tmpfs`, bind mounts), exit code `137` -> `SANDBOX_OOM_KILLED`, and `docker/runner/Dockerfile` + `scripts/egress-rules.sh --dry-run`.

2. **Hardware Profiler & Weighted Admission Token Bucket Unit Tests**:
   ```bash
   pnpm test tests/unit/admission.test.ts
   ```
   - Verifies 8GB (`Constrained Profile`: `maxConcurrentContainers = 1`, `2g` RAM, `--single-process --disable-gpu`) vs 16GB (`Standard Profile`: `maxConcurrentContainers = 3`, `4g` RAM) profiling, weight calculation (`1.0`, `2.0`, `3.0`, `3.5`), and token bucket admission/release queueing.

3. **Egress Firewall Script Syntax Check**:
   ```bash
   bash -n scripts/egress-rules.sh && bash scripts/egress-rules.sh --dry-run
   ```

4. **Full Build, Lint, and Typecheck Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm build
   pnpm test
   ```

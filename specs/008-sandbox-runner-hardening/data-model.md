# Data Model: 008-sandbox-runner-hardening

**Feature Branch**: `008-sandbox-runner-hardening`  
**Date**: 2026-10-18

## 1. Seccomp Profile (`config/seccomp.json`)

| Field | Type | Value | Description |
|---|---|---|---|
| `defaultAction` | `string` | `'SCMP_ACT_ALLOW'` | Permits standard user-space syscalls |
| `architectures` | `string[]` | `['SCMP_ARCH_X86_64', 'SCMP_ARCH_AARCH64']` | Supports x86_64 workstations and ARM64 (Raspberry Pi 5) |
| `syscalls[0].names` | `string[]` | `['ptrace', 'bpf', 'chroot', 'mount', 'umount2', 'unshare', 'setns', 'kexec_load', 'init_module']` | Explicitly blocked kernel/namespace syscalls |
| `syscalls[0].action` | `string` | `'SCMP_ACT_ERRNO'` | Returns `EPERM` on blocked syscall invocation |

## 2. Hardware Profile & Admission Entities (`src/orchestrator/runner/admission.ts`)

### 2.1 `HardwareProfile`
| Field | Type | Constrained (≤8GB RAM) | Standard (>8GB / ≥16GB RAM) |
|---|---|---|---|
| `profile` | `'constrained' \| 'standard'` | `'constrained'` | `'standard'` |
| `totalMemBytes` | `number` | `<= 8 * 1024^3` | `> 8 * 1024^3` |
| `cpuCount` | `number` | Host CPU cores | Host CPU cores |
| `maxConcurrentContainers` | `number` | `1` | `3` |
| `containerMemoryBytes` | `number` | `2147483648` (`2g`) | `4294967296` (`4g`) |
| `maxTokenBudget` | `number` | `3.5` | `6.0` |
| `playwrightFlags` | `string[]` | `['--single-process', '--disable-gpu']` | `['--disable-dev-shm-usage']` |

### 2.2 `TaskAdmissionRequest` & `AdmissionTicket`
| Field | Type | Description |
|---|---|---|
| `taskId` | `string` | Task identifier (`TASK-601`) |
| `dbTier` | `SandboxDbTier` | `'tier-0-mock'` (`1.0`), `'tier-1-shared-db'` (`2.0`), `'tier-2-isolated-db'` (`3.0`) |
| `requiresBrowserE2E` | `boolean` | Adds `+0.5` tokens when `true` |
| `weight` | `number` | Computed weight (`1.0`, `1.5`, `2.0`, `2.5`, `3.0`, or `3.5`) |
| `acquiredAt` | `number` | Epoch ms when admission was granted |

## 3. Hardened Container Configuration (`src/orchestrator/runner/docker.ts`)

### 3.1 `ExtendedTaskSandboxOptions` (extends `TaskSandboxOptions` from `IRunnerProvider.ts`)
| Field | Type | Default | Description |
|---|---|---|---|
| `taskId` | `string` | Required | Task ID |
| `projectId` | `string \| undefined` | `'default'` | Used for `pkg-cache-<projectId>` mount |
| `worktreePath` | `string \| undefined` | Optional | Mounted to `/workspace:rw` |
| `parentGitDir` | `string \| undefined` | Optional | Mounted `:ro` so relative `.git` pointer resolves |
| `relayDir` | `string \| undefined` | `path.resolve('src/relay')` | Mounted to `/relay:ro` |
| `memoryBytes` | `number \| undefined` | From `HardwareProfile` | `HostConfig.Memory` ceiling |

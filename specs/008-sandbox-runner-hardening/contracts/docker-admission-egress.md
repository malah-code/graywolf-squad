# Interface Contracts: 008-sandbox-runner-hardening

**Feature Branch**: `008-sandbox-runner-hardening`  
**Date**: 2026-10-18

## 1. Hardened `DockerRunnerProvider` Contract (`src/orchestrator/runner/docker.ts`)

```typescript
import Docker, { ContainerCreateOptions } from 'dockerode';
import { IRunnerProvider, TaskSandboxOptions } from './IRunnerProvider';

export interface HardenedSandboxOptions extends TaskSandboxOptions {
  projectId?: string;
  worktreePath?: string;
  parentGitDir?: string;
  pkgCacheDir?: string;
  relayDir?: string;
  memoryBytes?: number;
}

export class DockerRunnerProvider implements IRunnerProvider {
  constructor(options?: {
    dockerClient?: Docker;
    dockerHost?: string;
    networkMode?: string;
    seccompProfilePath?: string;
    defaultMemoryBytes?: number;
  });

  public buildContainerCreateOptions(
    options: HardenedSandboxOptions
  ): ContainerCreateOptions;

  public startSandbox(
    options: HardenedSandboxOptions
  ): Promise<{ containerId: string }>;

  public teardownSandbox(taskId: string): Promise<void>;

  public waitForExit(taskId: string): Promise<number>;

  public pruneDanglingTaskContainers(): Promise<string[]>;
}
```

## 2. Hardware Profiler & Weighted Admission Token Bucket Contract (`src/orchestrator/runner/admission.ts`)

```typescript
import { SandboxDbTier } from '../db/sandbox-db';

export interface HardwareProfile {
  profile: 'constrained' | 'standard';
  totalMemBytes: number;
  cpuCount: number;
  maxConcurrentContainers: number;
  containerMemoryBytes: number;
  maxTokenBudget: number;
  playwrightFlags: string[];
}

export function profileHostHardware(overrides?: {
  totalMemBytes?: number;
  cpuCount?: number;
}): HardwareProfile;

export function calculateTaskAdmissionWeight(input: {
  dbTier: SandboxDbTier;
  requiresBrowserE2E?: boolean;
}): number;

export class AdmissionController {
  constructor(profile?: HardwareProfile);

  public getProfile(): HardwareProfile;
  public getActiveCount(): number;
  public getConsumedTokens(): number;
  public canAdmit(input: {
    taskId: string;
    dbTier: SandboxDbTier;
    requiresBrowserE2E?: boolean;
  }): boolean;
  public tryAcquire(input: {
    taskId: string;
    dbTier: SandboxDbTier;
    requiresBrowserE2E?: boolean;
  }): { admitted: boolean; weight: number; reason?: string };
  public release(taskId: string): boolean;
}
```

## 3. Egress Firewall Script Contract (`scripts/egress-rules.sh`)

- CLI flags:
  - `--dry-run`: Prints the exact `iptables` rules for `DOCKER-USER` without executing privileged kernel mutations.
  - Environment overrides: `RUNNER_BRIDGE` (default `br-runner-net`), `ORCHESTRATOR_IP` (default `orchestrator`), `LITELLM_IP` (default `litellm-proxy`).

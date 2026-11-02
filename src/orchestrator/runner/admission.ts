import os from 'node:os';
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

export interface AdmissionTicket {
  taskId: string;
  weight: number;
  dbTier: SandboxDbTier;
  requiresBrowserE2E: boolean;
  acquiredAt: number;
}

const EIGHT_GB = 8 * 1024 * 1024 * 1024; // 8589934592 bytes

export function profileHostHardware(overrides?: {
  totalMemBytes?: number;
  cpuCount?: number;
}): HardwareProfile {
  const totalMemBytes = overrides?.totalMemBytes ?? os.totalmem();
  const cpuCount = overrides?.cpuCount ?? os.cpus().length;

  if (totalMemBytes <= EIGHT_GB) {
    return {
      profile: 'constrained',
      totalMemBytes,
      cpuCount,
      maxConcurrentContainers: 1,
      containerMemoryBytes: 2 * 1024 * 1024 * 1024, // 2 GB
      maxTokenBudget: 3.5,
      playwrightFlags: ['--single-process', '--disable-gpu'],
    };
  }

  return {
    profile: 'standard',
    totalMemBytes,
    cpuCount,
    maxConcurrentContainers: 3,
    containerMemoryBytes: 4 * 1024 * 1024 * 1024, // 4 GB
    maxTokenBudget: 6.0,
    playwrightFlags: ['--disable-dev-shm-usage'],
  };
}

export function calculateTaskAdmissionWeight(input: {
  dbTier: SandboxDbTier;
  requiresBrowserE2E?: boolean;
}): number {
  let baseWeight: number;

  switch (input.dbTier) {
    case 'tier-0-mock':
      baseWeight = 1.0;
      break;
    case 'tier-1-shared-db':
      baseWeight = 2.0;
      break;
    case 'tier-2-isolated-db':
      baseWeight = 3.0;
      break;
    default:
      baseWeight = 1.0;
  }

  if (input.requiresBrowserE2E) {
    baseWeight += 0.5;
  }

  return baseWeight;
}

export class AdmissionController {
  private readonly profile: HardwareProfile;
  private readonly activeTickets = new Map<string, AdmissionTicket>();

  constructor(profile?: HardwareProfile) {
    this.profile = profile ?? profileHostHardware();
  }

  public getProfile(): HardwareProfile {
    return this.profile;
  }

  public getActiveCount(): number {
    return this.activeTickets.size;
  }

  public getConsumedTokens(): number {
    let sum = 0;
    for (const ticket of this.activeTickets.values()) {
      sum += ticket.weight;
    }
    return sum;
  }

  public canAdmit(input: {
    taskId: string;
    dbTier: SandboxDbTier;
    requiresBrowserE2E?: boolean;
  }): boolean {
    if (this.activeTickets.has(input.taskId)) {
      return true; // Already admitted (idempotent)
    }

    if (this.getActiveCount() >= this.profile.maxConcurrentContainers) {
      return false;
    }

    const weight = calculateTaskAdmissionWeight(input);

    // If completely idle, always admit at least 1 task even if weight matches/equals ceiling
    if (this.getActiveCount() === 0) {
      return weight <= this.profile.maxTokenBudget;
    }

    return this.getConsumedTokens() + weight <= this.profile.maxTokenBudget;
  }

  public tryAcquire(input: {
    taskId: string;
    dbTier: SandboxDbTier;
    requiresBrowserE2E?: boolean;
  }): { admitted: boolean; weight: number; reason?: string } {
    const weight = calculateTaskAdmissionWeight(input);

    if (this.activeTickets.has(input.taskId)) {
      return { admitted: true, weight };
    }

    if (this.getActiveCount() >= this.profile.maxConcurrentContainers) {
      return {
        admitted: false,
        weight,
        reason: `Max concurrent containers reached (${this.profile.maxConcurrentContainers})`,
      };
    }

    if (this.getActiveCount() > 0 && this.getConsumedTokens() + weight > this.profile.maxTokenBudget) {
      return {
        admitted: false,
        weight,
        reason: `Token budget exceeded (current: ${this.getConsumedTokens()}, required: ${weight}, budget: ${this.profile.maxTokenBudget})`,
      };
    }

    if (this.getActiveCount() === 0 && weight > this.profile.maxTokenBudget) {
      return {
        admitted: false,
        weight,
        reason: `Task weight (${weight}) exceeds total profile budget (${this.profile.maxTokenBudget})`,
      };
    }

    this.activeTickets.set(input.taskId, {
      taskId: input.taskId,
      weight,
      dbTier: input.dbTier,
      requiresBrowserE2E: Boolean(input.requiresBrowserE2E),
      acquiredAt: Date.now(),
    });

    return { admitted: true, weight };
  }

  public release(taskId: string): boolean {
    return this.activeTickets.delete(taskId);
  }
}

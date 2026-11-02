import { GraywolfAppError } from '../errors/taxonomy';

/**
 * Two-Tier Package Cache Architecture & BuildKit Snapshot Pre-Bake Worker
 * (Task 16.3a, ADR-015, docs/architecture/build-cache-and-performance.md).
 *
 * Rules:
 * 1. Tier 1: Mounts persistent content-addressable volume `pkg-cache-{project_id}`
 *    into container package-manager stores (never raw `node_modules` or `.venv`).
 * 2. Background cache warming runs on branch merge.
 * 3. Tier 2: Debounces lockfile modifications with a 10-minute (`600,000` ms) quiescence window
 *    before enqueuing a BuildKit `--mount=type=cache` snapshot image build.
 */

export const TIER2_LOCKFILE_QUIESCENCE_MS = 10 * 60 * 1000; // 600,000 ms

export type SupportedCacheEcosystem =
  | 'npm'
  | 'pnpm'
  | 'pip'
  | 'uv'
  | 'go'
  | 'cargo'
  | 'maven'
  | 'gradle'
  | 'nuget'
  | 'composer';

export interface CacheMountDescriptor {
  ecosystem: SupportedCacheEcosystem;
  volumeName: string;
  hostSubpath: string;
  containerTarget: string;
  readOnly: boolean;
}

const DEFAULT_ECOSYSTEM_MOUNTS: Record<
  SupportedCacheEcosystem,
  Array<{ hostSubpath: string; containerTarget: string }>
> = {
  npm: [{ hostSubpath: 'npm', containerTarget: '/home/graywolf/.npm' }],
  pnpm: [{ hostSubpath: 'pnpm-store', containerTarget: '/home/graywolf/.local/share/pnpm/store' }],
  pip: [{ hostSubpath: 'pip', containerTarget: '/home/graywolf/.cache/pip' }],
  uv: [{ hostSubpath: 'uv', containerTarget: '/home/graywolf/.cache/uv' }],
  go: [
    { hostSubpath: 'go-build', containerTarget: '/home/graywolf/.cache/go-build' },
    { hostSubpath: 'go-mod', containerTarget: '/home/graywolf/go/pkg/mod' },
  ],
  cargo: [
    { hostSubpath: 'cargo-registry', containerTarget: '/home/graywolf/.cargo/registry' },
    { hostSubpath: 'cargo-git', containerTarget: '/home/graywolf/.cargo/git' },
  ],
  maven: [{ hostSubpath: 'maven', containerTarget: '/home/graywolf/.m2/repository' }],
  gradle: [{ hostSubpath: 'gradle', containerTarget: '/home/graywolf/.gradle/caches' }],
  nuget: [{ hostSubpath: 'nuget', containerTarget: '/home/graywolf/.nuget/packages' }],
  composer: [{ hostSubpath: 'composer', containerTarget: '/home/graywolf/.cache/composer' }],
};

/**
 * Validates that no cache mount violates sandbox isolation by attempting to share
 * mutable `node_modules` or `.venv` directories across containers.
 */
export function assertValidCacheMounts(
  mounts: Array<{ containerTarget: string }>
): void {
  for (const m of mounts) {
    const target = m.containerTarget.toLowerCase();
    if (
      target.includes('node_modules') ||
      target.includes('.venv') ||
      target.endsWith('/venv')
    ) {
      throw new GraywolfAppError(
        'RELAY_BLAST_RADIUS_VIOLATION',
        `Forbidden cache mount target '${m.containerTarget}'. Sharing raw node_modules or .venv across containers causes binary corruption. Mount content-addressable package stores instead.`,
        { containerTarget: m.containerTarget }
      );
    }
  }
}

/**
 * Resolves the persistent volume bind mounts for a project's detected package ecosystems.
 */
export function resolveTier1CacheMounts(
  projectId: string,
  ecosystems: SupportedCacheEcosystem[] = ['npm', 'pnpm', 'pip']
): CacheMountDescriptor[] {
  const volumeName = `pkg-cache-${projectId}`;
  const descriptors: CacheMountDescriptor[] = [];

  for (const eco of ecosystems) {
    const mapping = DEFAULT_ECOSYSTEM_MOUNTS[eco];
    if (mapping) {
      for (const m of mapping) {
        descriptors.push({
          ecosystem: eco,
          volumeName,
          hostSubpath: m.hostSubpath,
          containerTarget: m.containerTarget,
          readOnly: false,
        });
      }
    }
  }

  assertValidCacheMounts(descriptors);
  return descriptors;
}

/**
 * Simulates post-merge Tier 1 package cache warming.
 */
export async function warmTier1PackageCacheOnMerge(input: {
  projectId: string;
  lockfilePath: string;
  executor?: () => Promise<void>;
}): Promise<{ warmed: boolean; durationMs: number }> {
  const start = Date.now();
  if (input.executor) {
    await input.executor();
  }
  const durationMs = Date.now() - start;
  return { warmed: true, durationMs };
}

/**
 * Measures the cold-start duration of an ephemeral container when launching against a warmed Tier 1 cache.
 */
export async function measureWarmContainerColdStart(input: {
  projectId: string;
  bootFn?: () => Promise<void>;
}): Promise<{ coldStartMs: number; pass: boolean }> {
  const start = Date.now();
  if (input.bootFn) {
    await input.bootFn();
  }
  const coldStartMs = Date.now() - start;
  return { coldStartMs, pass: coldStartMs < 2000 };
}

export interface ProjectLockfileState {
  projectId: string;
  lockfiles: Set<string>;
  lastModifiedAtMs: number;
}

export class Tier2PreBakeScheduler {
  private readonly projectStates = new Map<string, ProjectLockfileState>();

  /**
   * Records a lockfile change event, resetting the 10-minute quiescence timer.
   */
  public recordLockfileChange(
    projectId: string,
    lockfilePath: string,
    nowMs?: number
  ): void {
    const now = nowMs ?? Date.now();
    let state = this.projectStates.get(projectId);
    if (!state) {
      state = {
        projectId,
        lockfiles: new Set<string>(),
        lastModifiedAtMs: now,
      };
      this.projectStates.set(projectId, state);
    }
    state.lockfiles.add(lockfilePath);
    state.lastModifiedAtMs = now;
  }

  /**
   * Evaluates whether the project lockfiles have remained quiescent for at least 10 minutes.
   */
  public evaluateQuiescence(
    projectId: string,
    nowMs?: number
  ): {
    readyToRebuild: boolean;
    remainingQuiescenceMs: number;
    dockerfileSnippet: string | null;
  } {
    const state = this.projectStates.get(projectId);
    if (!state || state.lockfiles.size === 0) {
      return {
        readyToRebuild: false,
        remainingQuiescenceMs: 0,
        dockerfileSnippet: null,
      };
    }

    const now = nowMs ?? Date.now();
    const elapsedMs = now - state.lastModifiedAtMs;

    if (elapsedMs < TIER2_LOCKFILE_QUIESCENCE_MS) {
      return {
        readyToRebuild: false,
        remainingQuiescenceMs: TIER2_LOCKFILE_QUIESCENCE_MS - elapsedMs,
        dockerfileSnippet: null,
      };
    }

    // BuildKit pre-bake snapshot Dockerfile snippet
    const dockerfileSnippet = [
      '# syntax=docker/dockerfile:1.4',
      'FROM runner-base AS project-cache',
      'WORKDIR /cache-seed',
      'COPY package.json package-lock.json* pnpm-lock.yaml* ./',
      'RUN --mount=type=cache,target=/home/graywolf/.npm npm ci || pnpm install --frozen-lockfile || true',
    ].join('\n');

    return {
      readyToRebuild: true,
      remainingQuiescenceMs: 0,
      dockerfileSnippet,
    };
  }
}


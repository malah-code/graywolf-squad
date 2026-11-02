import { describe, expect, it } from 'vitest';
import {
  resolveTier1CacheMounts,
  assertValidCacheMounts,
  warmTier1PackageCacheOnMerge,
  measureWarmContainerColdStart,
  Tier2PreBakeScheduler,
} from '../../src/orchestrator/runner/cache';
import { ServiceOtel } from '../../src/orchestrator/ServiceOtel';
import { REDACTED_SECRET_REPLACEMENT } from '../../src/orchestrator/security/secret-scrubber';

describe('Two-Tier Package Cache, Quiescence Debounce & ServiceOtel (Task 16.3)', () => {
  it('Tier 1 cache mounts package stores into container and forbids sharing raw node_modules or .venv', () => {
    const mounts = resolveTier1CacheMounts('proj-alpha-123', [
      'npm',
      'pnpm',
      'pip',
      'cargo',
    ]);
    expect(mounts.length).toBeGreaterThanOrEqual(4);

    for (const m of mounts) {
      expect(m.volumeName).toBe('pkg-cache-proj-alpha-123');
      expect(m.readOnly).toBe(false);
      expect(m.containerTarget).not.toContain('node_modules');
      expect(m.containerTarget).not.toContain('.venv');
    }

    const npmMount = mounts.find((m) => m.containerTarget === '/home/graywolf/.npm');
    expect(npmMount).toBeDefined();

    const pnpmMount = mounts.find(
      (m) => m.containerTarget === '/home/graywolf/.local/share/pnpm/store'
    );
    expect(pnpmMount).toBeDefined();

    // Sharing raw node_modules or .venv must throw RELAY_BLAST_RADIUS_VIOLATION
    expect(() =>
      assertValidCacheMounts([
        { containerTarget: '/home/graywolf/app/node_modules' },
      ])
    ).toThrowError(/Forbidden cache mount target/);

    expect(() =>
      assertValidCacheMounts([
        { containerTarget: '/home/graywolf/app/.venv' },
      ])
    ).toThrowError(/Forbidden cache mount target/);
  });

  it('verifies sub-2s container cold-start on warmed cache and post-merge cache warming', async () => {
    const warmResult = await warmTier1PackageCacheOnMerge({
      projectId: 'proj-alpha-123',
      lockfilePath: 'pnpm-lock.yaml',
      executor: async () => {
        // Fast in-process warmed check
      },
    });
    expect(warmResult.warmed).toBe(true);

    const coldStartResult = await measureWarmContainerColdStart({
      projectId: 'proj-alpha-123',
      bootFn: async () => {
        // Simulates instant local SSD disk initialization
      },
    });
    expect(coldStartResult.coldStartMs).toBeLessThan(2000);
    expect(coldStartResult.pass).toBe(true);
  });

  it('Tier2PreBakeScheduler enforces 10-minute (600,000ms) lockfile quiescence debounce', () => {
    const scheduler = new Tier2PreBakeScheduler();
    const t0 = 1000000;

    scheduler.recordLockfileChange('proj-debounce-1', 'package-lock.json', t0);

    // After 5 minutes (300,000ms) -> not ready
    const at5m = scheduler.evaluateQuiescence('proj-debounce-1', t0 + 300000);
    expect(at5m.readyToRebuild).toBe(false);
    expect(at5m.remainingQuiescenceMs).toBe(300000);
    expect(at5m.dockerfileSnippet).toBeNull();

    // Rapid second modification at t = 5m resets the 10-minute timer
    scheduler.recordLockfileChange('proj-debounce-1', 'pnpm-lock.yaml', t0 + 300000);

    // At t = 10m (5m after second mod) -> still not ready
    const at10m = scheduler.evaluateQuiescence('proj-debounce-1', t0 + 600000);
    expect(at10m.readyToRebuild).toBe(false);
    expect(at10m.remainingQuiescenceMs).toBe(300000);

    // At t = 15m (10m after second mod) -> readyToRebuild becomes true
    const at15m = scheduler.evaluateQuiescence('proj-debounce-1', t0 + 900000);
    expect(at15m.readyToRebuild).toBe(true);
    expect(at15m.remainingQuiescenceMs).toBe(0);
    expect(at15m.dockerfileSnippet).toContain('FROM runner-base AS project-cache');
    expect(at15m.dockerfileSnippet).toContain('--mount=type=cache');
  });

  it('ServiceOtel defaults to disabled ($0 solo offline run) and scrubs secrets when enabled', () => {
    // 1. Disabled mode
    const disabledOtel = new ServiceOtel({ enabled: false });
    expect(disabledOtel.isEnabled()).toBe(false);

    const disabledRes = disabledOtel.recordGenAiSpan({
      taskId: 'TASK-101',
      tier: 'dev-level-3',
      model: 'qwen2.5-coder:32b',
      promptTokens: 120,
      completionTokens: 80,
      durationMs: 450,
      attributes: {
        'gen_ai.prompt_preview': 'prompt text with ghp_111122223333444455556666777788889999',
      },
    });
    expect(disabledRes.exported).toBe(false);
    expect(disabledRes.externalEgressBytes).toBe(0);

    // 2. Enabled mode with secret scrubber
    const enabledOtel = new ServiceOtel({
      enabled: true,
      endpoint: 'http://localhost:4318/v1/traces',
      vaultLiterals: ['secret-vault-db-pw-1234'],
    });
    expect(enabledOtel.isEnabled()).toBe(true);

    const enabledRes = enabledOtel.recordGenAiSpan({
      taskId: 'TASK-102',
      tier: 'dev-level-1',
      model: 'qwen2.5-coder:32b',
      promptTokens: 300,
      completionTokens: 150,
      durationMs: 900,
      attributes: {
        'gen_ai.response_preview': 'DB connection string: secret-vault-db-pw-1234 and ghp_111122223333444455556666777788889999',
      },
    });
    expect(enabledRes.exported).toBe(true);
    expect(enabledRes.externalEgressBytes).toBeGreaterThan(0);

    const attrs = (enabledRes.spanRecord.attributes as Record<string, string>) || {};
    expect(attrs['gen_ai.response_preview']).toContain(REDACTED_SECRET_REPLACEMENT);
    expect(attrs['gen_ai.response_preview']).not.toContain('secret-vault-db-pw-1234');
    expect(attrs['gen_ai.response_preview']).not.toContain('ghp_111122223333444455556666777788889999');
  });
});


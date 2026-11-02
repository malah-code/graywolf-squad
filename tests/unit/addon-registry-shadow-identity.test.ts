import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AddonRegistry,
  computeAddonBundleHash,
} from '../../src/orchestrator/addons/registry';
import { ShadowLifecycleManager } from '../../src/orchestrator/addons/shadow-lifecycle';
import {
  executeVerifiedHumanIntent,
  resolveAndVerifyExternalIdentity,
} from '../../src/orchestrator/addons/identity-binding';
import {
  type CockpitAddon,
  type GraywolfSignalEnvelope,
  type SignalAddon,
} from '../../src/orchestrator/addons/sdk';

describe('Two-Tier Addon Registry, Shadow Mode Lifecycle & External Identity Binding (Task 15.2, ADR-080)', () => {
  const createDummySignalAddon = (name: string): SignalAddon => ({
    meta: {
      name,
      version: '0.1.0',
      description: 'Test signal addon',
      requiredSecrets: [],
    },
    create: () => async () => {},
  });

  const createDummyCockpitAddon = (name: string): CockpitAddon => ({
    meta: {
      name,
      version: '0.1.0',
      description: 'Test cockpit addon',
      requiredSecrets: [],
      platform: 'discord',
    },
    create: () => async () => {},
  });

  it('enforces Topology A slot limits (max 3 SignalAddons + max 1 CockpitAddon -> ADDON_SLOT_LIMIT_EXCEEDED 429)', () => {
    const registry = new AddonRegistry();

    for (let i = 1; i <= 3; i++) {
      const pkg = `@graywolf/addon-sig-${i}`;
      registry.registerSignalAddon(createDummySignalAddon(pkg), {
        package: pkg,
        type: 'signal',
        tier: 'official',
        shadowState: 'shadow',
      });
    }

    // 4th SignalAddon throws ADDON_SLOT_LIMIT_EXCEEDED (429)
    expect(() =>
      registry.registerSignalAddon(createDummySignalAddon('@graywolf/addon-sig-4'), {
        package: '@graywolf/addon-sig-4',
        type: 'signal',
        tier: 'official',
        shadowState: 'shadow',
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'ADDON_SLOT_LIMIT_EXCEEDED',
        httpStatus: 429,
      })
    );

    // 1st CockpitAddon succeeds
    registry.registerCockpitAddon(createDummyCockpitAddon('@graywolf/addon-discord'), {
      package: '@graywolf/addon-discord',
      type: 'cockpit',
      tier: 'official',
      shadowState: 'graduated',
    });

    // 2nd CockpitAddon throws ADDON_SLOT_LIMIT_EXCEEDED (429)
    expect(() =>
      registry.registerCockpitAddon(createDummyCockpitAddon('@graywolf/addon-slack'), {
        package: '@graywolf/addon-slack',
        type: 'cockpit',
        tier: 'official',
        shadowState: 'shadow',
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'ADDON_SLOT_LIMIT_EXCEEDED',
        httpStatus: 429,
      })
    );
  });

  it('verifies Tier 2 community addon SHA-256 contentHash fail-closed (ADDON_HASH_MISMATCH 403) and blocks banned patterns', () => {
    const registry = new AddonRegistry();
    const bundleSource = 'export default function registerPlugin() { return true; }';
    const validHash = computeAddonBundleHash(bundleSource);

    // Valid Tier 2 hash succeeds
    registry.registerSignalAddon(
      createDummySignalAddon('community-jira-signal'),
      {
        package: 'community-jira-signal',
        type: 'signal',
        tier: 'community',
        shadowState: 'shadow',
        contentHash: validHash,
        approvedAt: '2026-11-01T10:00:00.000Z',
        approvedBy: 'lead-1',
      },
      bundleSource
    );

    // Tampered bundle source throws ADDON_HASH_MISMATCH (403)
    expect(() =>
      registry.registerSignalAddon(
        createDummySignalAddon('community-tampered'),
        {
          package: 'community-tampered',
          type: 'signal',
          tier: 'community',
          shadowState: 'shadow',
          contentHash: validHash,
          approvedAt: '2026-11-01T10:00:00.000Z',
        },
        'export default function tampered() { return false; }'
      )
    ).toThrowError(
      expect.objectContaining({
        code: 'ADDON_HASH_MISMATCH',
        httpStatus: 403,
      })
    );

    // Banned @sentry/node import or setInterval timer rejected
    expect(() =>
      registry.registerSignalAddon(
        createDummySignalAddon('@graywolf/addon-bad-timer'),
        {
          package: '@graywolf/addon-bad-timer',
          type: 'signal',
          tier: 'official',
          shadowState: 'shadow',
        },
        'setInterval(() => poll(), 1000);'
      )
    ).toThrowError(
      expect.objectContaining({
        code: 'ACI_VALIDATION_FAILED',
      })
    );
  });

  it('enforces Shadow Mode graduation (>= 20 runs, < 10% discard, lead_dev promotion) and auto-deprecates on 5 consecutive discards', () => {
    const lifecycle = new ShadowLifecycleManager();
    const pkg = 'community-pagerduty';
    lifecycle.registerAddon(pkg, 'shadow');

    const makeEnvelope = (idx: number): GraywolfSignalEnvelope => ({
      id: crypto.randomUUID(),
      source: pkg,
      kind: 'crash',
      title: `Alert ${idx}`,
      description: 'Alert body',
      links: [],
      severity: 'high',
      occurredAt: '2026-11-01T12:00:00.000Z',
      ingestedAt: '2026-11-01T12:00:01.000Z',
    });

    // Deliver 19 shadow runs -> cannot promote yet (< 20 runs)
    for (let i = 1; i <= 19; i++) {
      const res = lifecycle.recordSignalDelivery(pkg, makeEnvelope(i));
      expect(res.forwardedToKanban).toBe(false);
    }

    expect(() => lifecycle.promoteAddon(pkg, 'lead_dev', 'user-lead-1')).toThrowError(
      expect.objectContaining({ code: 'ACI_VALIDATION_FAILED' })
    );

    // Deliver 20th run (1 discarded out of 20 = 5% < 10%)
    const env20 = makeEnvelope(20);
    lifecycle.recordSignalDelivery(pkg, env20);
    lifecycle.recordOperatorFeedback(pkg, env20.id, 'discarded');

    // Developer role cannot promote (requires lead_dev or owner)
    expect(() => lifecycle.promoteAddon(pkg, 'developer', 'user-dev-1')).toThrowError(
      expect.objectContaining({ code: 'RBAC_INSUFFICIENT_ROLE', httpStatus: 403 })
    );

    // lead_dev promotion succeeds
    const promoted = lifecycle.promoteAddon(pkg, 'lead_dev', 'user-lead-1');
    expect(promoted.shadowState).toBe('graduated');
    expect(promoted.shadowDiscardRate).toBe(0.05);

    // In graduated mode, signals forward to Kanban
    const liveDelivery = lifecycle.recordSignalDelivery(pkg, makeEnvelope(21));
    expect(liveDelivery.forwardedToKanban).toBe(true);

    // 5 consecutive post-graduation discards auto-deprecate the addon
    for (let d = 1; d <= 5; d++) {
      const envD = makeEnvelope(100 + d);
      lifecycle.recordSignalDelivery(pkg, envD);
      lifecycle.recordOperatorFeedback(pkg, envD.id, 'discarded');
    }

    const postDeprecate = lifecycle.getAddonState(pkg);
    expect(postDeprecate.shadowState).toBe('deprecated');
    expect(
      lifecycle.recordSignalDelivery(pkg, makeEnvelope(200)).forwardedToKanban
    ).toBe(false);
  });

  it('enforces External Identity Binding in receiveHumanIntent (ADDON_UNLINKED_EXTERNAL_USER 403 for unlinked Discord/Slack users)', async () => {
    const linkedUsers = new Map<string, string>([
      ['ws-1:discord:discord-user-777', 'internal-user-uuid-1'],
    ]);

    const lookupOverride = async (q: {
      workspaceId: string;
      platform: string;
      actorExternalId: string;
    }) => linkedUsers.get(`${q.workspaceId}:${q.platform}:${q.actorExternalId}`) ?? null;

    // Unlinked Discord user throws ADDON_UNLINKED_EXTERNAL_USER (403)
    await expect(
      resolveAndVerifyExternalIdentity({
        workspaceId: 'ws-1',
        platform: 'discord',
        actorExternalId: 'unlinked-stranger-999',
        lookupOverride,
      })
    ).rejects.toMatchObject({
      code: 'ADDON_UNLINKED_EXTERNAL_USER',
      httpStatus: 403,
    });

    // Linked Discord user resolves actorUserId and parses intent + taskId
    const verifiedIntent = await executeVerifiedHumanIntent({
      workspaceId: 'ws-1',
      platform: 'discord',
      externalMessageId: 'msg-500',
      intentText: '/approve TASK-1502 looks great',
      actorExternalId: 'discord-user-777',
      lookupOverride,
    });

    expect(verifiedIntent).toEqual({
      taskId: 'TASK-1502',
      intent: 'approve',
      actorUserId: 'internal-user-uuid-1',
    });
  });
});


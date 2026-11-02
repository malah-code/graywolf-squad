import * as crypto from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { GraywolfAppError } from '../errors/taxonomy';
import {
  type AddonManifest,
  type CockpitAddon,
  type GraywolfRelayContext,
  type SignalAddon,
} from './sdk';

/**
 * Two-Tier Addon Registry, Topology A Slot Caps & SHA-256 Content-Hash Lock
 * (Task 15.2a, ADR-080, PRD §17, FR-004).
 *
 * Enforces:
 * 1. Topology A slot caps: `maxSignalAddons: 3`, `maxCockpitAddons: 1` -> `ADDON_SLOT_LIMIT_EXCEEDED` (429).
 * 2. Tier 2 (`tier === 'community'`) SHA-256 `contentHash` and `approvedAt` fail-closed verification ->
 *    `ADDON_HASH_MISMATCH` (403).
 * 3. Banned pattern guard: rejects addons importing `@sentry/node` or calling `setInterval(` / `setTimeout(`.
 */

export type ManifestAddonEntry = AddonManifest['installed'][number];

const BANNED_SENTRY_SDK_REGEX = /@sentry\/node\b/;
const BANNED_TIMER_REGEX = /\b(?:setInterval|setTimeout)\s*\(/;

/**
 * Computes the lowercase 64-character SHA-256 hex digest of an addon bundle source string.
 */
export function computeAddonBundleHash(bundleSource: string): string {
  return crypto.createHash('sha256').update(bundleSource, 'utf8').digest('hex');
}

/**
 * Inspects addon source or factory function string for banned patterns (`@sentry/node`, `setInterval`, `setTimeout`).
 */
export function assertNoBannedAddonPatterns(
  addonName: string,
  sourceOrFactoryText: string
): void {
  if (BANNED_SENTRY_SDK_REGEX.test(sourceOrFactoryText)) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Addon '${addonName}' imports banned SDK '@sentry/node'. Use TypeBox + HMAC webhook validation instead.`,
      { addonName, bannedPattern: '@sentry/node' }
    );
  }
  if (BANNED_TIMER_REGEX.test(sourceOrFactoryText)) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Addon '${addonName}' uses banned timer (setInterval/setTimeout). Use relay.scheduleRepeatableJob() instead.`,
      { addonName, bannedPattern: 'setInterval/setTimeout' }
    );
  }
}

/**
 * Verifies Tier 2 (`community`) contentHash and approval metadata fail-closed at startup.
 */
export function verifyAddonTierIntegrity(
  entry: ManifestAddonEntry,
  bundleSource?: string
): void {
  if (entry.tier === 'official') {
    if (!entry.package.startsWith('@graywolf/')) {
      throw new GraywolfAppError(
        'ADDON_HASH_MISMATCH',
        `Official Tier 1 addon '${entry.package}' must be scoped under '@graywolf/'`,
        { package: entry.package, tier: entry.tier }
      );
    }
    return;
  }

  // Tier 2 community addon — fail-closed checks
  if (!entry.contentHash || !/^[0-9a-f]{64}$/.test(entry.contentHash) || !entry.approvedAt) {
    throw new GraywolfAppError(
      'ADDON_HASH_MISMATCH',
      `Tier 2 community addon '${entry.package}' is missing locked SHA-256 contentHash or approvedAt timestamp`,
      {
        package: entry.package,
        tier: entry.tier,
        hasContentHash: Boolean(entry.contentHash),
        hasApprovedAt: Boolean(entry.approvedAt),
      }
    );
  }

  if (bundleSource === undefined) {
    throw new GraywolfAppError(
      'ADDON_HASH_MISMATCH',
      `Tier 2 community addon '${entry.package}' bundle source could not be loaded for SHA-256 verification`,
      { package: entry.package }
    );
  }

  const computedHash = computeAddonBundleHash(bundleSource);
  if (computedHash !== entry.contentHash) {
    throw new GraywolfAppError(
      'ADDON_HASH_MISMATCH',
      `Tier 2 community addon '${entry.package}' SHA-256 hash mismatch (expected ${entry.contentHash}, got ${computedHash})`,
      {
        package: entry.package,
        expectedHash: entry.contentHash,
        computedHash,
      }
    );
  }
}

export class AddonRegistry {
  private readonly maxSignalAddons: number;
  private readonly maxCockpitAddons: number;
  private readonly signalAddons = new Map<
    string,
    { addon: SignalAddon; entry: ManifestAddonEntry }
  >();
  private readonly cockpitAddons = new Map<
    string,
    { addon: CockpitAddon; entry: ManifestAddonEntry }
  >();

  constructor(options?: { maxSignalAddons?: number; maxCockpitAddons?: number }) {
    this.maxSignalAddons = Math.min(3, options?.maxSignalAddons ?? 3);
    this.maxCockpitAddons = Math.min(1, options?.maxCockpitAddons ?? 1);
  }

  /**
   * Validates an entire `AddonManifest` from `.agents/project.config.json` against Topology A slot limits
   * and Tier 2 SHA-256 content-hash locks.
   */
  public validateManifest(
    manifest: AddonManifest,
    bundleSourcesByPackage?: Record<string, string>
  ): void {
    const signalCap = Math.min(
      this.maxSignalAddons,
      manifest.maxSignalAddons ?? this.maxSignalAddons
    );
    const cockpitCap = Math.min(
      this.maxCockpitAddons,
      manifest.maxCockpitAddons ?? this.maxCockpitAddons
    );

    let signalCount = 0;
    let cockpitCount = 0;

    for (const entry of manifest.installed) {
      if (entry.type === 'signal') {
        signalCount += 1;
        if (signalCount > signalCap) {
          throw new GraywolfAppError(
            'ADDON_SLOT_LIMIT_EXCEEDED',
            `SignalAddon slot limit exceeded (${signalCount} > ${signalCap})`,
            { addonType: 'signal', limit: signalCap, attemptedPackage: entry.package }
          );
        }
      } else {
        cockpitCount += 1;
        if (cockpitCount > cockpitCap) {
          throw new GraywolfAppError(
            'ADDON_SLOT_LIMIT_EXCEEDED',
            `CockpitAddon slot limit exceeded (${cockpitCount} > ${cockpitCap})`,
            { addonType: 'cockpit', limit: cockpitCap, attemptedPackage: entry.package }
          );
        }
      }

      verifyAddonTierIntegrity(entry, bundleSourcesByPackage?.[entry.package]);
    }
  }

  public registerSignalAddon(
    addon: SignalAddon,
    entry: ManifestAddonEntry,
    bundleSource?: string
  ): void {
    if (this.signalAddons.size >= this.maxSignalAddons) {
      throw new GraywolfAppError(
        'ADDON_SLOT_LIMIT_EXCEEDED',
        `Maximum SignalAddon slots (${this.maxSignalAddons}) reached`,
        { addonType: 'signal', limit: this.maxSignalAddons, attemptedPackage: addon.meta.name }
      );
    }

    verifyAddonTierIntegrity(entry, bundleSource);
    const inspectionText = `${bundleSource ?? ''}\n${addon.create.toString()}`;
    assertNoBannedAddonPatterns(addon.meta.name, inspectionText);

    this.signalAddons.set(addon.meta.name, { addon, entry });
  }

  public registerCockpitAddon(
    addon: CockpitAddon,
    entry: ManifestAddonEntry,
    bundleSource?: string
  ): void {
    if (this.cockpitAddons.size >= this.maxCockpitAddons) {
      throw new GraywolfAppError(
        'ADDON_SLOT_LIMIT_EXCEEDED',
        `Maximum CockpitAddon slots (${this.maxCockpitAddons}) reached`,
        {
          addonType: 'cockpit',
          limit: this.maxCockpitAddons,
          attemptedPackage: addon.meta.name,
        }
      );
    }

    verifyAddonTierIntegrity(entry, bundleSource);
    const inspectionText = `${bundleSource ?? ''}\n${addon.create.toString()}`;
    assertNoBannedAddonPatterns(addon.meta.name, inspectionText);

    this.cockpitAddons.set(addon.meta.name, { addon, entry });
  }

  public async mountAll(
    fastify: FastifyInstance,
    contextFactory: (
      addonName: string,
      addonType: 'signal' | 'cockpit',
      requiredSecrets: string[],
      platform?: 'discord' | 'slack' | 'msteams' | 'custom'
    ) => GraywolfRelayContext
  ): Promise<void> {
    for (const { addon, entry } of this.signalAddons.values()) {
      if (entry.shadowState === 'deprecated') continue;
      const relay = contextFactory(
        addon.meta.name,
        'signal',
        addon.meta.requiredSecrets
      );
      await fastify.register(addon.create(relay));
    }

    for (const { addon, entry } of this.cockpitAddons.values()) {
      if (entry.shadowState === 'deprecated') continue;
      const relay = contextFactory(
        addon.meta.name,
        'cockpit',
        addon.meta.requiredSecrets,
        addon.meta.platform
      );
      await fastify.register(addon.create(relay));
    }
  }
}


import { GraywolfAppError } from '../errors/taxonomy';
import { type GraywolfSignalEnvelope } from './sdk';

/**
 * Shadow Mode Graduation & Auto-Deprecation Lifecycle Manager (Task 15.2b, ADR-080, PRD §17, FR-005).
 *
 * Rules:
 * 1. Newly registered addons start in `shadowState: 'shadow'` (recording signals in `auditLog` only;
 *    `forwardedToKanban: false`).
 * 2. Promotion to `'graduated'` requires ALL of:
 *    - `shadowRunCount >= 20`
 *    - `shadowDiscardRate = discardedShadowCount / shadowRunCount < 0.10` (< 10%)
 *    - Explicit promotion by `'lead_dev'` or `'owner'` (`RBAC_INSUFFICIENT_ROLE` 403 otherwise)
 * 3. Once `'graduated'`, signals are forwarded to Kanban (`forwardedToKanban: true`).
 * 4. If a `'graduated'` addon incurs `5` consecutive operator-discarded signals
 *    (`consecutivePostGradDiscards >= 5`), it automatically transitions to `'deprecated'`
 *    and stops creating Kanban cards.
 */

export type ShadowLifecycleState = 'shadow' | 'graduated' | 'deprecated';

export interface ShadowAuditLogEntry {
  signalId: string;
  recordedAt: string;
  discarded: boolean;
  forwardedToKanban: boolean;
}

export interface AddonShadowRecord {
  addonPackage: string;
  shadowState: ShadowLifecycleState;
  shadowRunCount: number;
  discardedShadowCount: number;
  shadowDiscardRate: number;
  consecutivePostGradDiscards: number;
  promotedAt: string | null;
  promotedBy: string | null;
  deprecatedAt: string | null;
  auditLog: ShadowAuditLogEntry[];
}

export class ShadowLifecycleManager {
  private readonly records = new Map<string, AddonShadowRecord>();

  public registerAddon(
    addonPackage: string,
    initialState: ShadowLifecycleState = 'shadow'
  ): AddonShadowRecord {
    const existing = this.records.get(addonPackage);
    if (existing) {
      return existing;
    }

    const record: AddonShadowRecord = {
      addonPackage,
      shadowState: initialState,
      shadowRunCount: 0,
      discardedShadowCount: 0,
      shadowDiscardRate: 0,
      consecutivePostGradDiscards: 0,
      promotedAt: null,
      promotedBy: null,
      deprecatedAt: null,
      auditLog: [],
    };
    this.records.set(addonPackage, record);
    return record;
  }

  public getAddonState(addonPackage: string): AddonShadowRecord {
    const record = this.records.get(addonPackage);
    if (!record) {
      return this.registerAddon(addonPackage, 'shadow');
    }
    return record;
  }

  /**
   * Records an inbound signal delivery for the specified addon.
   * Returns `forwardedToKanban: true` ONLY when `shadowState === 'graduated'`.
   */
  public recordSignalDelivery(
    addonPackage: string,
    envelope: GraywolfSignalEnvelope
  ): {
    forwardedToKanban: boolean;
    shadowState: ShadowLifecycleState;
  } {
    const record = this.getAddonState(addonPackage);
    const forwardedToKanban = record.shadowState === 'graduated';

    if (record.shadowState === 'shadow') {
      record.shadowRunCount += 1;
      record.shadowDiscardRate = Number(
        (record.discardedShadowCount / record.shadowRunCount).toFixed(4)
      );
    }

    record.auditLog.push({
      signalId: envelope.id,
      recordedAt: new Date().toISOString(),
      discarded: false,
      forwardedToKanban,
    });

    return {
      forwardedToKanban,
      shadowState: record.shadowState,
    };
  }

  /**
   * Records operator triage feedback (`accepted` or `discarded`) on a signal.
   * Updates `shadowDiscardRate` in `'shadow'` state, and tracks `consecutivePostGradDiscards`
   * in `'graduated'` state (auto-deprecating at >= 5 consecutive discards).
   */
  public recordOperatorFeedback(
    addonPackage: string,
    signalId: string,
    decision: 'accepted' | 'discarded'
  ): AddonShadowRecord {
    const record = this.getAddonState(addonPackage);
    const logEntry = record.auditLog.find((e) => e.signalId === signalId);
    if (logEntry) {
      logEntry.discarded = decision === 'discarded';
    }

    if (record.shadowState === 'shadow') {
      if (decision === 'discarded') {
        record.discardedShadowCount += 1;
      }
      if (record.shadowRunCount > 0) {
        record.shadowDiscardRate = Number(
          (record.discardedShadowCount / record.shadowRunCount).toFixed(4)
        );
      }
    } else if (record.shadowState === 'graduated') {
      if (decision === 'discarded') {
        record.consecutivePostGradDiscards += 1;
        if (record.consecutivePostGradDiscards >= 5) {
          record.shadowState = 'deprecated';
          record.deprecatedAt = new Date().toISOString();
        }
      } else {
        record.consecutivePostGradDiscards = 0;
      }
    }

    return record;
  }

  /**
   * Promotes an addon from `'shadow'` to `'graduated'`.
   * Requires `actorRole` in `['lead_dev', 'owner']`, `shadowRunCount >= 20`, and `shadowDiscardRate < 0.10`.
   */
  public promoteAddon(
    addonPackage: string,
    actorRole: 'owner' | 'lead_dev' | 'developer' | 'viewer',
    actorUserId: string
  ): AddonShadowRecord {
    if (actorRole !== 'owner' && actorRole !== 'lead_dev') {
      throw new GraywolfAppError(
        'RBAC_INSUFFICIENT_ROLE',
        `Role '${actorRole}' is not authorized to promote Shadow Mode addons; requires 'lead_dev' or 'owner'.`,
        { addonPackage, actorRole, actorUserId }
      );
    }

    const record = this.getAddonState(addonPackage);
    if (record.shadowRunCount < 20) {
      throw new GraywolfAppError(
        'ACI_VALIDATION_FAILED',
        `Addon '${addonPackage}' requires at least 20 shadow runs before graduation (current: ${record.shadowRunCount}).`,
        {
          addonPackage,
          shadowRunCount: record.shadowRunCount,
          requiredRuns: 20,
        }
      );
    }

    const discardRate =
      record.shadowRunCount > 0
        ? record.discardedShadowCount / record.shadowRunCount
        : 1;
    record.shadowDiscardRate = Number(discardRate.toFixed(4));

    if (discardRate >= 0.1) {
      throw new GraywolfAppError(
        'ACI_VALIDATION_FAILED',
        `Addon '${addonPackage}' discard rate (${(discardRate * 100).toFixed(1)}%) exceeds the < 10% graduation threshold.`,
        {
          addonPackage,
          shadowDiscardRate: record.shadowDiscardRate,
          maxAllowedDiscardRate: 0.1,
        }
      );
    }

    record.shadowState = 'graduated';
    record.consecutivePostGradDiscards = 0;
    record.promotedAt = new Date().toISOString();
    record.promotedBy = actorUserId;
    return record;
  }
}


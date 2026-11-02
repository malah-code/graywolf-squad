import * as crypto from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type FastifyPluginAsync } from 'fastify';
import { GraywolfAppError } from '../errors/taxonomy';
import { sanitizeSignalEnvelopeForPrompt } from './sanitization';

/**
 * `@graywolf/addon-sdk` Runtime Contracts, Scoped Relay Context & Valkey Signal Deduplication
 * (Task 15.1a/b, ADR-044, ADR-080, PRD §17, FR-001, FR-002).
 *
 * Productionizes `specs/002-addon-sdk/addon-interfaces.ts`:
 * 1. Canonical TypeBox schemas (`GraywolfSignalEnvelope`, `AddonManifest`, `SignalAddon`, `CockpitAddon`).
 * 2. Capability-scoped `GraywolfRelayContext` isolating `SignalAddon` vs `CockpitAddon` methods and
 *    restricting `readSecret(key)` to keys declared in `meta.requiredSecrets`.
 * 3. Valkey deduplication on `submitSignal` using `signal:{workspaceId}:{fingerprintHash}` (default 180s TTL).
 */

export const GraywolfSignalEnvelope = Type.Object({
  id: Type.String({ format: 'uuid' }),
  source: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal('crash'),
    Type.Literal('bug-report'),
    Type.Literal('feature'),
    Type.Literal('community'),
    Type.Literal('custom'),
  ]),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.String({ maxLength: 4096 }),
  links: Type.Array(
    Type.Object({
      label: Type.String(),
      url: Type.String({ format: 'uri' }),
    }),
    { maxItems: 10 }
  ),
  severity: Type.Union([
    Type.Literal('critical'),
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
    Type.Literal('unknown'),
  ]),
  occurredAt: Type.String({ format: 'date-time' }),
  ingestedAt: Type.String({ format: 'date-time' }),
  raw: Type.Optional(Type.String({ maxLength: 65536 })),
  meta: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
    )
  ),
});

export type GraywolfSignalEnvelope = Static<typeof GraywolfSignalEnvelope>;

export interface GraywolfRelayContext {
  // SignalAddon relay methods (available to SignalAddon only)
  submitSignal(
    envelope: GraywolfSignalEnvelope
  ): Promise<{ signalId: string; deduplicated?: boolean; xmlWrappedPayload?: string }>;

  scheduleRepeatableJob(opts: {
    jobKey: string;
    schedule: string | number;
    payload: Record<string, unknown>;
  }): Promise<void>;

  // CockpitAddon relay methods (available to CockpitAddon only)
  postTaskBrief(brief: {
    taskId: string;
    title: string;
    summaryMarkdown: string;
    severity: GraywolfSignalEnvelope['severity'];
    links: GraywolfSignalEnvelope['links'];
  }): Promise<void>;

  postEscalation(alert: {
    taskId: string;
    reason: string;
    evidenceLedgerUrl: string;
  }): Promise<void>;

  receiveHumanIntent(raw: {
    externalMessageId: string;
    intentText: string;
    actorExternalId: string;
  }): Promise<{
    taskId: string;
    intent: 'approve' | 'reject' | 'escalate' | 'unknown';
    actorUserId: string;
  }>;

  // Shared utility methods
  readSecret(key: string): Promise<string>;

  valkey: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
  };

  log: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}

export interface SignalAddonMeta {
  name: string;
  version: string;
  description: string;
  requiredSecrets: string[];
  requiresPolling?: boolean;
}

export type SignalAddon = {
  meta: SignalAddonMeta;
  create(relay: GraywolfRelayContext): FastifyPluginAsync;
};

export interface CockpitAddonMeta {
  name: string;
  version: string;
  description: string;
  requiredSecrets: string[];
  platform: 'discord' | 'slack' | 'msteams' | 'custom';
}

export type CockpitAddon = {
  meta: CockpitAddonMeta;
  create(relay: GraywolfRelayContext): FastifyPluginAsync;
};

export const AddonManifest = Type.Object({
  maxSignalAddons: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
  maxCockpitAddons: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
  installed: Type.Array(
    Type.Object({
      package: Type.String({ minLength: 1 }),
      type: Type.Union([Type.Literal('signal'), Type.Literal('cockpit')]),
      tier: Type.Union([Type.Literal('official'), Type.Literal('community')]),
      shadowState: Type.Union([
        Type.Literal('shadow'),
        Type.Literal('graduated'),
        Type.Literal('deprecated'),
      ]),
      shadowRunCount: Type.Optional(Type.Integer({ minimum: 0 })),
      shadowDiscardRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      contentHash: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
      approvedAt: Type.Optional(Type.String({ format: 'date-time' })),
      approvedBy: Type.Optional(Type.String()),
    })
  ),
});

export type AddonManifest = Static<typeof AddonManifest>;

/**
 * Normalizes a signal title by lowercasing and stripping timestamps, hex addresses, and digits
 * so identical crash events produce the same fingerprintHash.
 */
export function normalizeSignalTitleForFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes the deterministic SHA-256 hex fingerprint for a `GraywolfSignalEnvelope` (ADR-044, FR-002).
 * Formula: SHA-256("${source}|${kind}|${normalizedTitle}|${upstreamKey}")
 */
export function computeSignalFingerprint(envelope: GraywolfSignalEnvelope): string {
  const normalizedTitle = normalizeSignalTitleForFingerprint(envelope.title);
  const upstreamKey = String(
    envelope.meta?.fingerprint ?? envelope.links[0]?.url ?? ''
  ).trim();
  const payload = `${envelope.source}|${envelope.kind}|${normalizedTitle}|${upstreamKey}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function createInMemoryValkeyAdapter() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      store.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

function throwForbiddenCapability(addonName: string, capability: string): never {
  throw new GraywolfAppError(
    'RBAC_INSUFFICIENT_ROLE',
    `Addon '${addonName}' is forbidden from invoking capability '${capability}'`,
    {
      addonName,
      capability,
      reason: 'ADDON_FORBIDDEN_CAPABILITY',
    }
  );
}

/**
 * Validates a `GraywolfSignalEnvelope` (after truncating bounded fields) against TypeBox.
 */
export function validateAndNormalizeSignalEnvelope(
  envelope: GraywolfSignalEnvelope
): GraywolfSignalEnvelope {
  const normalized: GraywolfSignalEnvelope = {
    ...envelope,
    title: envelope.title.slice(0, 200),
    description: envelope.description.slice(0, 4096),
    ...(envelope.raw !== undefined ? { raw: envelope.raw.slice(0, 65536) } : {}),
  };

  const valid =
    typeof normalized.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      normalized.id
    ) &&
    normalized.source.trim().length > 0 &&
    normalized.title.trim().length > 0 &&
    normalized.links.length <= 10 &&
    Value.Check(
      Type.Omit(GraywolfSignalEnvelope, ['id', 'links', 'occurredAt', 'ingestedAt']),
      normalized
    );

  if (!valid) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      'Invalid GraywolfSignalEnvelope schema',
      { source: envelope.source, id: envelope.id }
    );
  }

  return normalized;
}

export interface CreateScopedRelayContextOptions {
  workspaceId: string;
  addonType: 'signal' | 'cockpit';
  addonName: string;
  requiredSecrets: string[];
  platform?: 'discord' | 'slack' | 'msteams' | 'custom';
  cooldownSeconds?: number; // default: 180
  valkeyStore?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
  };
  secretReader?: (key: string) => Promise<string>;
  onSignalAccepted?: (
    envelope: GraywolfSignalEnvelope,
    xmlWrappedPayload: string
  ) => Promise<void> | void;
  onRepeatableJobScheduled?: (opts: {
    jobKey: string;
    schedule: string | number;
    payload: Record<string, unknown>;
  }) => Promise<void> | void;
  onPostTaskBrief?: (brief: {
    taskId: string;
    title: string;
    summaryMarkdown: string;
    severity: GraywolfSignalEnvelope['severity'];
    links: GraywolfSignalEnvelope['links'];
  }) => Promise<void> | void;
  onPostEscalation?: (alert: {
    taskId: string;
    reason: string;
    evidenceLedgerUrl: string;
  }) => Promise<void> | void;
  onReceiveHumanIntent?: (raw: {
    externalMessageId: string;
    intentText: string;
    actorExternalId: string;
  }) => Promise<{
    taskId: string;
    intent: 'approve' | 'reject' | 'escalate' | 'unknown';
    actorUserId: string;
  }>;
}

/**
 * Creates a capability-scoped `GraywolfRelayContext` for a SignalAddon or CockpitAddon.
 */
export function createScopedRelayContext(
  options: CreateScopedRelayContextOptions
): GraywolfRelayContext {
  const allowedSecrets = new Set(options.requiredSecrets);
  const cooldownSeconds = options.cooldownSeconds ?? 180;
  const valkey = options.valkeyStore ?? createInMemoryValkeyAdapter();

  const log = {
    info: (_msg: string, _data?: Record<string, unknown>) => {},
    warn: (_msg: string, _data?: Record<string, unknown>) => {},
    error: (_msg: string, _data?: Record<string, unknown>) => {},
  };

  const readSecret = async (key: string): Promise<string> => {
    if (!allowedSecrets.has(key)) {
      throwForbiddenCapability(options.addonName, `readSecret:${key}`);
    }
    if (options.secretReader) {
      return options.secretReader(key);
    }
    return process.env[key] ?? '';
  };

  if (options.addonType === 'signal') {
    return Object.freeze({
      async submitSignal(envelope: GraywolfSignalEnvelope) {
        const validated = validateAndNormalizeSignalEnvelope(envelope);
        const sanitized = sanitizeSignalEnvelopeForPrompt(validated);
        const fingerprintHash = computeSignalFingerprint(sanitized.sanitizedEnvelope);
        const dedupKey = `signal:${options.workspaceId}:${fingerprintHash}`;

        const existingSignalId = await valkey.get(dedupKey);
        if (existingSignalId) {
          return {
            signalId: existingSignalId,
            deduplicated: true,
            xmlWrappedPayload: sanitized.xmlWrappedPayload,
          };
        }

        await valkey.set(dedupKey, sanitized.sanitizedEnvelope.id, cooldownSeconds);
        if (options.onSignalAccepted) {
          await options.onSignalAccepted(
            sanitized.sanitizedEnvelope,
            sanitized.xmlWrappedPayload
          );
        }

        return {
          signalId: sanitized.sanitizedEnvelope.id,
          deduplicated: false,
          xmlWrappedPayload: sanitized.xmlWrappedPayload,
        };
      },

      async scheduleRepeatableJob(opts: {
        jobKey: string;
        schedule: string | number;
        payload: Record<string, unknown>;
      }) {
        if (options.onRepeatableJobScheduled) {
          await options.onRepeatableJobScheduled(opts);
        }
      },

      async postTaskBrief() {
        return throwForbiddenCapability(options.addonName, 'postTaskBrief');
      },

      async postEscalation() {
        return throwForbiddenCapability(options.addonName, 'postEscalation');
      },

      async receiveHumanIntent() {
        return throwForbiddenCapability(options.addonName, 'receiveHumanIntent');
      },

      readSecret,
      valkey,
      log,
    });
  }

  // CockpitAddon context
  const cockpitContext: GraywolfRelayContext = {
    async submitSignal() {
      return throwForbiddenCapability(options.addonName, 'submitSignal');
    },

    async scheduleRepeatableJob() {
      return throwForbiddenCapability(options.addonName, 'scheduleRepeatableJob');
    },

    async postTaskBrief(brief: {
      taskId: string;
      title: string;
      summaryMarkdown: string;
      severity: GraywolfSignalEnvelope['severity'];
      links: GraywolfSignalEnvelope['links'];
    }) {
      if (options.onPostTaskBrief) {
        await options.onPostTaskBrief(brief);
      }
    },

    async postEscalation(alert: {
      taskId: string;
      reason: string;
      evidenceLedgerUrl: string;
    }) {
      if (options.onPostEscalation) {
        await options.onPostEscalation(alert);
      }
    },

    async receiveHumanIntent(raw: {
      externalMessageId: string;
      intentText: string;
      actorExternalId: string;
    }) {
      if (options.onReceiveHumanIntent) {
        return options.onReceiveHumanIntent(raw);
      }
      throw new GraywolfAppError(
        'ADDON_UNLINKED_EXTERNAL_USER',
        'No identity resolver configured for CockpitAddon'
      );
    },

    readSecret,
    valkey,
    log,
  };

  return Object.freeze(cockpitContext);
}

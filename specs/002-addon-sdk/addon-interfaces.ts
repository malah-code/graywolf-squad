/**
 * @graywolf/addon-sdk — TypeBox Interface Stubs
 *
 * Canonical reference schemas for the Pluggable Addon SDK (ADR-080).
 * These are NON-COMMITTING design stubs. They define the TypeBox validation
 * contracts that all SignalAddon and CockpitAddon implementations must satisfy.
 *
 * Spec: specs/002-addon-sdk/
 * ADR:  docs/decisions.md#adr-080
 * PRD:  docs/PRD.md#17-software-factory--pluggable-addon-ecosystem
 *
 * ⚠️  This file is a design reference only.
 *     Do NOT import from this path in production code until ADR-080 enters
 *     the implementation phase and a real package is scaffolded.
 */

import { Static, Type } from "@sinclair/typebox";
import { FastifyPluginAsync } from "fastify";

// ---------------------------------------------------------------------------
// 1. GraywolfSignalEnvelope
//    The canonical normalized signal shape produced by every SignalAddon.
//    All fields except `raw` must be populated before the envelope reaches
//    the Kanban engine.
// ---------------------------------------------------------------------------

export const GraywolfSignalEnvelope = Type.Object({
  /** Globally unique signal ID (UUID v7 — sortable by ingestion time) */
  id: Type.String({ format: "uuid" }),

  /** Originating addon package name, e.g. "@graywolf/addon-sentry" */
  source: Type.String({ minLength: 1 }),

  /**
   * Signal classification.
   * - "crash"      → Sentry exception / fatal error
   * - "bug-report" → GitHub Issue tagged as bug
   * - "feature"    → GitHub Issue tagged as enhancement
   * - "community"  → Discord / Slack community signal
   * - "custom"     → Tier 2 addon-defined type
   */
  kind: Type.Union([
    Type.Literal("crash"),
    Type.Literal("bug-report"),
    Type.Literal("feature"),
    Type.Literal("community"),
    Type.Literal("custom"),
  ]),

  /** Human-readable title surfaced in Kanban and Cockpit triage card */
  title: Type.String({ minLength: 1, maxLength: 200 }),

  /** Extended description in Markdown (max 4 KB — no unbounded blobs) */
  description: Type.String({ maxLength: 4096 }),

  /**
   * Structured links back to the originating system.
   * e.g. Sentry issue URL, GitHub issue URL, Discord message permalink.
   */
  links: Type.Array(
    Type.Object({
      label: Type.String(),
      url: Type.String({ format: "uri" }),
    }),
    { maxItems: 10 }
  ),

  /**
   * Severity hint from the originating system.
   * Graywolf's System-One Decision Gate (ADR-079) may override this during
   * triage classification — the addon-provided value is a starting estimate.
   */
  severity: Type.Union([
    Type.Literal("critical"),
    Type.Literal("high"),
    Type.Literal("medium"),
    Type.Literal("low"),
    Type.Literal("unknown"),
  ]),

  /** ISO 8601 timestamp of when the original event occurred upstream */
  occurredAt: Type.String({ format: "date-time" }),

  /** ISO 8601 timestamp of when Graywolf ingested this envelope */
  ingestedAt: Type.String({ format: "date-time" }),

  /**
   * Raw, unmodified webhook payload from the originating system.
   * Stored for audit purposes. Never passed to LLM context directly.
   * Max 64 KB — addons must truncate before setting this field.
   */
  raw: Type.Optional(Type.String({ maxLength: 65536 })),

  /**
   * Optional free-form metadata bag for addon-specific extensions.
   * Must not contain secrets or PII. Values must be JSON-serializable scalars.
   */
  meta: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
    )
  ),
});

export type GraywolfSignalEnvelope = Static<typeof GraywolfSignalEnvelope>;

// ---------------------------------------------------------------------------
// 2. GraywolfRelayContext
//    The scoped relay object injected into every addon at registration time.
//    This is the ONLY surface through which addons may interact with the
//    Graywolf control plane.
//
//    Security invariants (ADR-080):
//    - executeCommand()      → NOT PRESENT (forbidden for addons)
//    - worktree I/O methods  → NOT PRESENT (forbidden for addons)
//    - relay.mjs invocation  → NOT PRESENT (forbidden for addons)
// ---------------------------------------------------------------------------

export interface GraywolfRelayContext {
  // -------------------------------------------------------------------------
  // SignalAddon relay methods (available to SignalAddon only)
  // -------------------------------------------------------------------------

  /**
   * Submit a normalized signal envelope to the Kanban triage queue.
   * In Shadow Mode, this writes to the audit log only (no Kanban write).
   * In Graduated mode, creates a Kanban card pending Lead Developer approval.
   */
  submitSignal(envelope: GraywolfSignalEnvelope): Promise<{ signalId: string }>;

  /**
   * Register a repeatable BullMQ job for polling-based integrations.
   * Use ONLY when the upstream API has no webhook support.
   * The addon itself must NEVER use setInterval / setTimeout.
   * Conforms to ADR-005 BullMQ repeatable job contract.
   */
  scheduleRepeatableJob(opts: {
    /** Unique key — must be stable across restarts */
    jobKey: string;
    /** Cron expression (UTC) or interval in milliseconds */
    schedule: string | number;
    /** Payload passed to the job handler on each invocation */
    payload: Record<string, unknown>;
  }): Promise<void>;

  // -------------------------------------------------------------------------
  // CockpitAddon relay methods (available to CockpitAddon only)
  // -------------------------------------------------------------------------

  /**
   * Post a task brief to the external human channel managed by this cockpit.
   */
  postTaskBrief(brief: {
    taskId: string;
    title: string;
    summaryMarkdown: string;
    severity: GraywolfSignalEnvelope["severity"];
    links: GraywolfSignalEnvelope["links"];
  }): Promise<void>;

  /**
   * Post an escalation alert to the external human channel.
   * Used for Strike-2 escalations (ADR-056) and BlastRadiusGuard violations.
   */
  postEscalation(alert: {
    taskId: string;
    reason: string;
    evidenceLedgerUrl: string;
  }): Promise<void>;

  /**
   * Receive a human intent from the external channel and translate it into
   * a control-plane command.
   */
  receiveHumanIntent(raw: {
    externalMessageId: string;
    intentText: string;
    actorExternalId: string;
  }): Promise<{
    taskId: string;
    intent: "approve" | "reject" | "escalate" | "unknown";
    actorUserId: string;
  }>;

  // -------------------------------------------------------------------------
  // Shared utility methods (available to both addon types)
  // -------------------------------------------------------------------------

  /**
   * Read a credential from the secret_vault (PostgreSQL / pgcrypto AES-256).
   * The key must be declared in the addon's requiredSecrets list.
   * Long-lived OAuth refresh tokens and HMAC webhook secrets live here (ADR-018).
   */
  readSecret(key: string): Promise<string>;

  /**
   * Read/write short-lived runtime state from Valkey (ADR-039).
   * Suitable for in-flight OAuth bearer tokens (short TTL), rate-limit counters,
   * and deduplication keys.
   * Do NOT store long-lived credentials here — use readSecret() instead.
   */
  valkey: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
  };

  /** Structured logger scoped to this addon's package name */
  log: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}

// ---------------------------------------------------------------------------
// 3. SignalAddon — Plugin Contract
//    A read-only signal ingestion Fastify plugin.
// ---------------------------------------------------------------------------

export interface SignalAddonMeta {
  /** NPM package name, e.g. "@graywolf/addon-sentry" */
  name: string;
  /** SemVer string */
  version: string;
  /** Human-readable description surfaced in the Addon Manager UI */
  description: string;
  /**
   * Secret keys this addon will read via relay.readSecret().
   * Must be declared upfront — reading undeclared keys throws at runtime.
   * Example: ["SENTRY_WEBHOOK_HMAC_SECRET"]
   */
  requiredSecrets: string[];
  /**
   * Whether this addon requires a BullMQ repeatable job (polling mode).
   * Set to true only when the upstream API has no webhook support.
   * When true, the addon MUST call relay.scheduleRepeatableJob() in register().
   */
  requiresPolling?: boolean;
}

/**
 * A SignalAddon is a Fastify plugin that:
 * 1. Registers one or more webhook receiver routes (e.g. POST /addons/sentry/webhook).
 * 2. Parses and validates the inbound payload using TypeBox.
 * 3. Normalizes the payload into a GraywolfSignalEnvelope.
 * 4. Calls relay.submitSignal(envelope) to hand off to the control plane.
 *
 * BANNED patterns (enforced by this type contract and runtime checks):
 * - setInterval / setTimeout inside the plugin body or route handlers.
 * - Importing @sentry/node or any error-emission SDK.
 * - Accessing relay.postTaskBrief / relay.postEscalation / relay.receiveHumanIntent.
 * - Accessing relay.executeCommand or any worktree I/O (not present on context).
 */
export type SignalAddon = {
  meta: SignalAddonMeta;
  /**
   * Fastify plugin factory. Called once at startup with the scoped relay context.
   * Must return a standard FastifyPluginAsync.
   */
  create(relay: GraywolfRelayContext): FastifyPluginAsync;
};

// ---------------------------------------------------------------------------
// 4. CockpitAddon — Plugin Contract
//    A write-authorized triage relay Fastify plugin.
// ---------------------------------------------------------------------------

export interface CockpitAddonMeta {
  name: string;
  version: string;
  description: string;
  requiredSecrets: string[];
  /**
   * The external platform this cockpit bridges to.
   * Used for display in the Chat Cockpit Addon Manager.
   */
  platform: "discord" | "slack" | "msteams" | "custom";
}

/**
 * A CockpitAddon is a Fastify plugin that:
 * 1. Connects to an external human channel (Discord, Slack, MS Teams).
 * 2. Posts task briefs / escalations via relay.postTaskBrief / relay.postEscalation.
 * 3. Translates human responses into control-plane intents via relay.receiveHumanIntent.
 *
 * PERMITTED relay methods: postTaskBrief, postEscalation, receiveHumanIntent,
 *                          readSecret, valkey, log.
 * FORBIDDEN relay methods: submitSignal, scheduleRepeatableJob.
 * FORBIDDEN entirely:      relay.executeCommand, worktree I/O, relay.mjs access.
 */
export type CockpitAddon = {
  meta: CockpitAddonMeta;
  create(relay: GraywolfRelayContext): FastifyPluginAsync;
};

// ---------------------------------------------------------------------------
// 5. AddonManifest — project.config.json shape for addon registration
//    Stored under the "addons" key in .agents/project.config.json.
// ---------------------------------------------------------------------------

export const AddonManifest = Type.Object({
  /**
   * Addon slot limit enforcement (Topology A guardrail — ADR-080).
   * Defaults: maxSignalAddons=3, maxCockpitAddons=1.
   */
  maxSignalAddons: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
  maxCockpitAddons: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),

  /** Registered addons */
  installed: Type.Array(
    Type.Object({
      /** NPM package name */
      package: Type.String(),
      /** Determines which relay methods are permitted */
      type: Type.Union([Type.Literal("signal"), Type.Literal("cockpit")]),
      /**
       * Addon trust tier.
       * "official"  = @graywolf/* bundled package (no hash lock needed).
       * "community" = Tier 2, must have contentHash + approvedAt populated.
       */
      tier: Type.Union([Type.Literal("official"), Type.Literal("community")]),
      /**
       * Shadow mode lifecycle state.
       * "shadow"     = audit-log only, no Kanban writes (default for new addons).
       * "graduated"  = full live behavior (requires 20 runs + <10% discard + human promo).
       * "deprecated" = disabled, audit log archived.
       */
      shadowState: Type.Union([
        Type.Literal("shadow"),
        Type.Literal("graduated"),
        Type.Literal("deprecated"),
      ]),
      /** Running count of shadow runs (resets on graduation) */
      shadowRunCount: Type.Optional(Type.Integer({ minimum: 0 })),
      /** Running discard rate over last shadowRunCount runs (0.0–1.0) */
      shadowDiscardRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      /**
       * Content-hash lock for Tier 2 community addons (ADR-080, ADR-054 pattern).
       * SHA-256 hex digest of the installed addon bundle.
       * Mismatch at startup = Fail-Closed hard boot error.
       */
      contentHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
      /** ISO 8601 timestamp of Lead Developer sign-off */
      approvedAt: Type.Optional(Type.String({ format: "date-time" })),
      /** GitHub username or Graywolf user ID of the approver */
      approvedBy: Type.Optional(Type.String()),
    })
  ),
});

export type AddonManifest = Static<typeof AddonManifest>;

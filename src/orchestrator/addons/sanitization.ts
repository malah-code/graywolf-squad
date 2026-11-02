import { Type, type Static } from '@sinclair/typebox';

/**
 * Untrusted Signal Sanitization & `<untrusted_signal_payload>` XML Jail (Task 15.1c, ADR-025, ADR-038, FR-003).
 *
 * Wraps untrusted external signal fields (`title`, `description`, and scalar string values in `meta`)
 * inside `<untrusted_signal_payload>` XML tags while neutralizing tag-escape sequences and
 * prompt-injection directives prior to planner or DecisionGate ingestion.
 */

export const SanitizedSignalSummarySchema = Type.Object({
  signalId: Type.String(),
  source: Type.String(),
  kind: Type.String(),
  xmlWrappedPayload: Type.String(),
  redactedInjectionCount: Type.Integer({ minimum: 0 }),
});

export type SanitizedSignalSummary = Static<typeof SanitizedSignalSummarySchema>;

const XML_TAG_BREAKOUT_REGEX = /<\/?\s*untrusted_signal_payload[^>]*>/gi;

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)\b/gi,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)\b/gi,
  /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi,
  /\[\s*SYSTEM\s*\]|###\s*SYSTEM\s*:/gi,
  /\bSYSTEM\s*:\s*you\s+are\s+now\b/gi,
];

/**
 * Sanitizes a single untrusted string field from an external signal by neutralizing
 * `<untrusted_signal_payload>` closing/opening tags and known prompt-injection directives.
 */
export function sanitizeUntrustedSignalText(raw: string): {
  sanitized: string;
  redactions: number;
} {
  let text = raw;
  let redactions = 0;

  const xmlMatches = text.match(XML_TAG_BREAKOUT_REGEX);
  if (xmlMatches && xmlMatches.length > 0) {
    redactions += xmlMatches.length;
    text = text.replace(XML_TAG_BREAKOUT_REGEX, '[ESCAPED_SIGNAL_TAG]');
  }

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      redactions += matches.length;
      text = text.replace(pattern, '[REDACTED_INJECTION_MARKER]');
    }
  }

  return { sanitized: text, redactions };
}

/**
 * Truncates and sanitizes a `GraywolfSignalEnvelope` for safe LLM / Planner / DecisionGate ingestion.
 * Wraps all untrusted text fields inside `<untrusted_signal_payload>` XML boundaries.
 */
export function sanitizeSignalEnvelopeForPrompt<
  T extends {
    id: string;
    source: string;
    kind: string;
    title: string;
    description: string;
    severity: string;
    links: Array<{ label: string; url: string }>;
    occurredAt: string;
    ingestedAt: string;
    raw?: string;
    meta?: Record<string, string | number | boolean | null>;
  }
>(envelope: T): {
  sanitizedEnvelope: T;
  xmlWrappedPayload: string;
  redactedInjectionCount: number;
} {
  let totalRedactions = 0;

  const truncatedTitle = envelope.title.slice(0, 200);
  const titleRes = sanitizeUntrustedSignalText(truncatedTitle);
  totalRedactions += titleRes.redactions;

  const truncatedDesc = envelope.description.slice(0, 4096);
  const descRes = sanitizeUntrustedSignalText(truncatedDesc);
  totalRedactions += descRes.redactions;

  const truncatedRaw =
    envelope.raw !== undefined ? envelope.raw.slice(0, 65536) : undefined;

  let sanitizedMeta: Record<string, string | number | boolean | null> | undefined;
  if (envelope.meta) {
    sanitizedMeta = {};
    for (const [k, v] of Object.entries(envelope.meta)) {
      if (typeof v === 'string') {
        const metaRes = sanitizeUntrustedSignalText(v);
        totalRedactions += metaRes.redactions;
        sanitizedMeta[k] = metaRes.sanitized;
      } else {
        sanitizedMeta[k] = v;
      }
    }
  }

  const sanitizedEnvelope: T = {
    ...envelope,
    title: titleRes.sanitized,
    description: descRes.sanitized,
    ...(truncatedRaw !== undefined ? { raw: truncatedRaw } : {}),
    ...(sanitizedMeta !== undefined ? { meta: sanitizedMeta } : {}),
  };

  const safeSourceAttr = envelope.source.replace(/["<>]/g, '');
  const safeIdAttr = envelope.id.replace(/["<>]/g, '');
  const safeKindAttr = envelope.kind.replace(/["<>]/g, '');

  const metaLines = sanitizedMeta
    ? Object.entries(sanitizedMeta)
        .map(([k, v]) => `  <meta key="${k.replace(/["<>]/g, '')}">${String(v)}</meta>`)
        .join('\n')
    : '';

  const xmlWrappedPayload = [
    `<untrusted_signal_payload source="${safeSourceAttr}" signal_id="${safeIdAttr}" kind="${safeKindAttr}" severity="${envelope.severity}">`,
    `  <title>${titleRes.sanitized}</title>`,
    `  <description>${descRes.sanitized}</description>`,
    ...(metaLines ? [metaLines] : []),
    `</untrusted_signal_payload>`,
  ].join('\n');

  return {
    sanitizedEnvelope,
    xmlWrappedPayload,
    redactedInjectionCount: totalRedactions,
  };
}


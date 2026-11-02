import { Type, Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { GraywolfAppError } from '../errors/taxonomy';

/**
 * ADR-083 Dual-Axis + ADR-062 Evidence Ledger review contracts.
 * Consumed by Dev-Level-2 3-Pass Adversarial Review (reviewer.ts) and the
 * Neutral Arbiter (arbiter.ts).
 */

// 1. Pass 1 (Main Reviewer) — findings.v1
export const ReviewFindingItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  axis: Type.Union([Type.Literal('standards'), Type.Literal('spec')]),
  severity: Type.Union([Type.Literal('P0'), Type.Literal('P1'), Type.Literal('P2')]),
  category: Type.Union([
    Type.Literal('logic'),
    Type.Literal('security'),
    Type.Literal('test'),
    Type.Literal('architecture'),
    Type.Literal('style'),
    Type.Literal('docs'),
  ]),
  filePath: Type.String({ minLength: 1 }),
  lineStart: Type.Integer({ minimum: 1 }),
  lineEnd: Type.Integer({ minimum: 1 }),
  /** Pass 1 only emits findings with confidence >= 0.5 (FR-006). */
  confidence: Type.Number({ minimum: 0.5, maximum: 1 }),
  claimsTestFailure: Type.Optional(Type.Boolean()),
  description: Type.String({ minLength: 1 }),
  suggestedFix: Type.String(),
});
export type ReviewFindingItem = Static<typeof ReviewFindingItemSchema>;

export const FindingsV1Schema = Type.Object({
  schemaVersion: Type.Literal('findings.v1'),
  taskId: Type.String({ minLength: 1 }),
  findings: Type.Array(ReviewFindingItemSchema),
});
export type FindingsV1 = Static<typeof FindingsV1Schema>;

// 2. Pass 2 (Challenger / Cross-Family Model) — debate.v1
export const DebateChallengeItemSchema = Type.Object({
  findingId: Type.String({ minLength: 1 }),
  stance: Type.Union([Type.Literal('confirm'), Type.Literal('refute')]),
  reasoning: Type.String({ minLength: 1 }),
  evidence: Type.Optional(Type.String()),
});
export type DebateChallengeItem = Static<typeof DebateChallengeItemSchema>;

export const DebateV1Schema = Type.Object({
  schemaVersion: Type.Literal('debate.v1'),
  taskId: Type.String({ minLength: 1 }),
  challenges: Type.Array(DebateChallengeItemSchema),
  newGaps: Type.Array(ReviewFindingItemSchema),
});
export type DebateV1 = Static<typeof DebateV1Schema>;

// 3. Pass 3 (Verdict Synthesis & Evidence Cross-Check) — final.v1
export const FinalVerdictItemSchema = Type.Object({
  findingId: Type.String({ minLength: 1 }),
  verdict: Type.Union([
    Type.Literal('agreed'),
    Type.Literal('contested'),
    Type.Literal('withdrawn'),
  ]),
  initialSeverity: Type.Union([Type.Literal('P0'), Type.Literal('P1'), Type.Literal('P2')]),
  effectiveSeverity: Type.Union([Type.Literal('P0'), Type.Literal('P1'), Type.Literal('P2')]),
  downgradedByEvidenceLedger: Type.Boolean(),
  rationale: Type.String({ minLength: 1 }),
});
export type FinalVerdictItem = Static<typeof FinalVerdictItemSchema>;

export const FinalV1Schema = Type.Object({
  schemaVersion: Type.Literal('final.v1'),
  taskId: Type.String({ minLength: 1 }),
  verdicts: Type.Array(FinalVerdictItemSchema),
  /** true iff zero `agreed` findings have effectiveSeverity in ['P0', 'P1']. */
  approved: Type.Boolean(),
  strikeIncrement: Type.Union([Type.Literal(0), Type.Literal(1)]),
});
export type FinalV1 = Static<typeof FinalV1Schema>;

// 4. Neutral Arbiter Output — EscalationMemo
export const EscalationOptionSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  pros: Type.Array(Type.String({ minLength: 1 })),
  cons: Type.Array(Type.String({ minLength: 1 })),
});
export type EscalationOption = Static<typeof EscalationOptionSchema>;

export const EscalationMemoSchema = Type.Object({
  taskId: Type.String({ minLength: 1 }),
  /** The arbiter is only invoked at 2 consecutive strikes or more (FR-007). */
  strikeCount: Type.Integer({ minimum: 2 }),
  disputeSummary: Type.String({ minLength: 1 }),
  optionA: EscalationOptionSchema,
  optionB: EscalationOptionSchema,
  recommendedOption: Type.Union([Type.Literal('A'), Type.Literal('B')]),
  recommendationRationale: Type.String({ minLength: 1 }),
  /** Rendered escalation-memo.md content. */
  markdown: Type.String({ minLength: 1 }),
});
export type EscalationMemo = Static<typeof EscalationMemoSchema>;

/**
 * Shared ADR-042-aligned validation helper: throws `ACI_VALIDATION_FAILED`
 * with the first offending path so hallucinated review payloads fail closed.
 */
function validateOrThrow<T>(schema: TSchema, input: unknown, label: string): T {
  if (!Value.Check(schema, input)) {
    const errors = [...Value.Errors(schema, input)];
    const first = errors[0];
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `${label} schema validation failed${first ? `: ${first.path} ${first.message}` : ''}`,
      { label, errorCount: errors.length }
    );
  }
  return input as T;
}

export function parseFindingsV1(input: unknown): FindingsV1 {
  return validateOrThrow<FindingsV1>(FindingsV1Schema, input, 'FindingsV1');
}

export function parseDebateV1(input: unknown): DebateV1 {
  return validateOrThrow<DebateV1>(DebateV1Schema, input, 'DebateV1');
}

export function parseFinalV1(input: unknown): FinalV1 {
  return validateOrThrow<FinalV1>(FinalV1Schema, input, 'FinalV1');
}

export function parseEscalationMemo(input: unknown): EscalationMemo {
  return validateOrThrow<EscalationMemo>(EscalationMemoSchema, input, 'EscalationMemo');
}

export function isFindingsV1(input: unknown): input is FindingsV1 {
  return Value.Check(FindingsV1Schema, input);
}

export function isDebateV1(input: unknown): input is DebateV1 {
  return Value.Check(DebateV1Schema, input);
}

export function isFinalV1(input: unknown): input is FinalV1 {
  return Value.Check(FinalV1Schema, input);
}

export function isEscalationMemo(input: unknown): input is EscalationMemo {
  return Value.Check(EscalationMemoSchema, input);
}

import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { GraywolfAppError } from '../errors/taxonomy';

export const DelegateRelayResultSchema = Type.Object(
  {
    version: Type.Literal('delegate-relay.result.v1'),
    taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('timeout'),
      Type.Literal('circuit_tripped'),
    ]),
    exitCode: Type.Integer(),
    signal: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    metrics: Type.Object(
      {
        durationMs: Type.Number({ minimum: 0 }),
        peakMemoryBytes: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: true }
    ),
    touchedFiles: Type.Array(Type.String()),
    agentReport: Type.Object(
      {
        summary: Type.String(),
        divergenceNotes: Type.Optional(Type.String()),
      },
      { additionalProperties: true }
    ),
    sessionRef: Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

export type DelegateRelayResult = Static<typeof DelegateRelayResultSchema>;

/**
 * Validates a relay execution result payload against the delegate-relay.result.v1 schema.
 * Throws GraywolfAppError('ACI_VALIDATION_FAILED') if validation fails.
 */
export function validateRelayResult(payload: unknown): DelegateRelayResult {
  if (!Value.Check(DelegateRelayResultSchema, payload)) {
    const errors = [...Value.Errors(DelegateRelayResultSchema, payload)];
    const diagnostic = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Relay result validation failed: ${diagnostic}`,
      { errors }
    );
  }

  return payload as DelegateRelayResult;
}

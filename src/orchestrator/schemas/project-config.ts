import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { GraywolfAppError } from '../errors/taxonomy';

// 1. Addon Manifest Schema (ADR-080)
export const AddonManifestSchema = Type.Object({
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
      approvedAt: Type.Optional(Type.String()),
      approvedBy: Type.Optional(Type.String()),
    })
  ),
});
export type AddonManifest = Static<typeof AddonManifestSchema>;

// 2. Gate Type Schema (PRD §8.1)
export const GateTypeSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('ai-pm'),
  Type.Literal('human'),
  Type.Literal('mandatory-human'),
]);
export type GateType = Static<typeof GateTypeSchema>;

// 3. Project Configuration Schema (.agents/project.config.json)
export const ProjectConfigSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal('greenfield'), Type.Literal('brownfield')]),
    sourceControl: Type.Object({
      provider: Type.Union([
        Type.Literal('github'),
        Type.Literal('gitlab'),
        Type.Literal('bitbucket'),
        Type.Literal('azure'),
        Type.Literal('gitea'),
      ]),
      repoUrl: Type.String({ minLength: 1 }),
      credentialRef: Type.String({ minLength: 1 }),
    }),
    blastRadius: Type.Object({
      writable: Type.Array(Type.String()),
      readonly: Type.Array(Type.String()),
      forbidden: Type.Array(Type.String()),
    }),
    modelRouting: Type.Object({
      devLevel1: Type.Object({
        alias: Type.String(),
        fallback: Type.Optional(Type.String()),
      }),
      devLevel2: Type.Object({
        alias: Type.String(),
        fallback: Type.Optional(Type.String()),
      }),
      devLevel3: Type.Object({
        alias: Type.String(),
        fallback: Type.Optional(Type.String()),
      }),
    }),
    taskTags: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    limits: Type.Object({
      maxConcurrentContainers: Type.Integer({ minimum: 1, maximum: 64 }),
      dailySpendCapUSD: Type.Number({ minimum: 0 }),
      qaMaxRetries: Type.Integer({ minimum: 0, maximum: 10 }),
      internalReviewMaxAttempts: Type.Integer({ minimum: 1, maximum: 5 }),
      maxAutonomousRevisionsPerTask: Type.Integer({ minimum: 1, maximum: 20 }),
      webhookDebounceMs: Type.Integer({ minimum: 0 }),
    }),
    skillImports: Type.Optional(Type.Array(Type.String())),
    // PRD & ADR Extensions
    locale: Type.Optional(
      Type.Union([
        Type.Literal('ar'),
        Type.Literal('en'),
        Type.Literal('fr'),
        Type.Literal('tr'),
      ])
    ),
    ui: Type.Optional(
      Type.Object({
        persona: Type.Union([Type.Literal('maker'), Type.Literal('developer')]),
      })
    ),
    gatePolicy: Type.Optional(
      Type.Object({
        default: Type.Optional(GateTypeSchema),
        byTaskTag: Type.Optional(Type.Record(Type.String(), GateTypeSchema)),
        confidenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        fallbackToFrontier: Type.Optional(Type.Boolean()),
      })
    ),
    aiReviewer: Type.Optional(
      Type.Object({
        persona: Type.String({ minLength: 1 }),
        modelAlias: Type.Optional(Type.String({ minLength: 1 })),
        systemPrompt: Type.Optional(Type.String()),
        strictnessLevel: Type.Optional(
          Type.Union([
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
          ])
        ),
        canEscalateToHuman: Type.Optional(Type.Boolean()),
        autoApproveThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      })
    ),
    cliSubscriptionAuth: Type.Optional(
      Type.Object({
        enabled: Type.Boolean(),
        provider: Type.Optional(Type.String()),
        lanes: Type.Optional(
          Type.Record(
            Type.String(),
            Type.Object({
              provider: Type.String({ minLength: 1 }),
              credentialKey: Type.String({ minLength: 1 }),
            })
          )
        ),
      })
    ),
    addons: Type.Optional(AddonManifestSchema),
  },
  { additionalProperties: true }
);

export type ProjectConfig = Static<typeof ProjectConfigSchema>;

/**
 * Validates a project configuration object against ProjectConfigSchema.
 * Throws GraywolfAppError('ACI_VALIDATION_FAILED') with structured validation details if invalid.
 */
export function validateProjectConfig(payload: unknown): ProjectConfig {
  if (!Value.Check(ProjectConfigSchema, payload)) {
    const errors = [...Value.Errors(ProjectConfigSchema, payload)];
    const diagnostic = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Project config validation failed: ${diagnostic}`,
      { errors }
    );
  }

  return payload as ProjectConfig;
}

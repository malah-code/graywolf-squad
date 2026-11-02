import { Type, Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import matter from 'gray-matter';
import { GraywolfAppError } from '../errors/taxonomy';

// 1. Task Lifecycle States (16 states)
export const TaskStatusSchema = Type.Union([
  Type.Literal('BACKLOG'),
  Type.Literal('QUEUED'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('BLOCKED'),
  Type.Literal('AWAITING_CLARIFICATION'),
  Type.Literal('INTERNAL_REVIEW'),
  Type.Literal('INTERNAL_REVIEW_FAILED'),
  Type.Literal('GUARD_VERIFYING'),
  Type.Literal('QA_FIXING'),
  Type.Literal('VERIFICATION_FAILED'),
  Type.Literal('HUMAN_REVIEW_GATE'),
  Type.Literal('MERGED'),
  Type.Literal('REJECTED'),
  Type.Literal('ESCALATED'),
  Type.Literal('UPDATED'),
  Type.Literal('CANCELLED'),
]);
export type TaskStatus = Static<typeof TaskStatusSchema>;

// 2. Task Types
export const TaskTypeSchema = Type.Union([
  Type.Literal('feature'),
  Type.Literal('bug'),
  Type.Literal('refactor'),
  Type.Literal('bug-bash-sprint'),
]);
export type TaskType = Static<typeof TaskTypeSchema>;

// 3. Developer Tiers
export const DevTierSchema = Type.Union([
  Type.Literal('dev-level-1'),
  Type.Literal('dev-level-2'),
  Type.Literal('dev-level-3'),
]);
export type DevTier = Static<typeof DevTierSchema>;

// 4. Task Brief Frontmatter Schema (brief.md)
export const TaskBriefFrontmatterSchema = Type.Object({
  id: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
  title: Type.String({ minLength: 1 }),
  type: TaskTypeSchema,
  status: TaskStatusSchema,
  priority: Type.Union([
    Type.Literal('P1'),
    Type.Literal('P2'),
    Type.Literal('P3'),
    Type.Literal('LOW'),
    Type.Literal('MEDIUM'),
    Type.Literal('HIGH'),
    Type.Literal('CRITICAL'),
  ]),
  assignedTier: Type.Optional(DevTierSchema),
  blockedBy: Type.Array(Type.String()),
  branch: Type.Optional(Type.String()),
  targetFiles: Type.Optional(Type.Array(Type.String())),
  writableScope: Type.Array(Type.String()),
  spendLimitUSD: Type.Number({ minimum: 0 }),
  currentSpendUSD: Type.Number({ minimum: 0 }),
  internalReviewAttempts: Type.Integer({ minimum: 0 }),
  created: Type.String(),
  updated: Type.String(),
});
export type TaskBriefFrontmatter = Static<typeof TaskBriefFrontmatterSchema>;

// 5. In-Container Plan Frontmatter Schema (plan.md)
export const TaskPlanFrontmatterSchema = Type.Object({
  taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
  authoredBy: Type.Literal('dev-level-1'),
  modelUsed: Type.String({ minLength: 1 }),
  designatedImplementer: DevTierSchema,
  designatedReviewer: DevTierSchema,
  requiresHumanGate: Type.Boolean(),
});
export type TaskPlanFrontmatter = Static<typeof TaskPlanFrontmatterSchema>;

// 6. Escalation Request Frontmatter Schema (escalation-request.md)
export const EscalationRequestFrontmatterSchema = Type.Object({
  taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
  escalationType: Type.Union([
    Type.Literal('boundary-violation'),
    Type.Literal('internal-review-failed'),
    Type.Literal('qa-loop-exceeded'),
    Type.Literal('stuck-detector'),
  ]),
  emittedAt: Type.String({ minLength: 1 }),
  agentTier: DevTierSchema,
});
export type EscalationRequestFrontmatter = Static<typeof EscalationRequestFrontmatterSchema>;

// 7. Review Sign-off Frontmatter Schema (review-signoff.md)
export const ReviewSignoffFrontmatterSchema = Type.Object({
  taskId: Type.String({ pattern: '^TASK-[0-9A-Z-]+$' }),
  reviewer: Type.Literal('dev-level-2'),
  attempt: Type.Integer({ minimum: 1 }),
  verdict: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
});
export type ReviewSignoffFrontmatter = Static<typeof ReviewSignoffFrontmatterSchema>;

/**
 * Parses raw markdown containing YAML frontmatter and validates it against a TypeBox schema.
 * Throws GraywolfAppError('ACI_VALIDATION_FAILED') with structured validation details if invalid.
 */
export function parseMarkdownArtifact<T extends TSchema>(
  rawMarkdown: string,
  schema: T
): { frontmatter: Static<T>; body: string } {
  let parsed: matter.GrayMatterFile<string>;
  let data: unknown;
  try {
    parsed = matter(rawMarkdown);
    data = normalizeYamlData(parsed.data);
  } catch (err) {
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Malformed YAML frontmatter in markdown artifact: ${(err as Error).message}`,
      { parseError: (err as Error).message }
    );
  }

  if (!Value.Check(schema, data)) {
    const errors = [...Value.Errors(schema, data)];
    const diagnostic = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Artifact frontmatter validation failed: ${diagnostic}`,
      { errors }
    );
  }

  return {
    frontmatter: data as Static<T>,
    body: parsed.content,
  };
}

function normalizeYamlData(val: unknown): unknown {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(normalizeYamlData);
  }
  if (val && typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = normalizeYamlData(v);
    }
    return res;
  }
  return val;
}

/**
 * Serializes a validated frontmatter object and body into a clean Markdown string with YAML delimiters.
 */
export function serializeMarkdownArtifact<T extends TSchema>(
  frontmatter: Static<T>,
  body: string,
  schema: T
): string {
  if (!Value.Check(schema, frontmatter)) {
    const errors = [...Value.Errors(schema, frontmatter)];
    const diagnostic = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new GraywolfAppError(
      'ACI_VALIDATION_FAILED',
      `Cannot serialize invalid frontmatter: ${diagnostic}`,
      { errors }
    );
  }

  return matter.stringify(body, frontmatter as Record<string, unknown>);
}

import * as crypto from 'node:crypto';
import {
  computeDeterministicEmbedding768,
  persistLessonRecordIfDbAvailable,
  type LessonCategory,
  type ProjectLessonRecord,
} from './reflection-worker';

/**
 * Human Gate Diff Learner (Task 14.1b, PRD §9.4, FR-002).
 *
 * Diffs agent_output (changes.patch) vs final_merged_code when a human modifies code
 * prior to merging, classifies the correction category, generates a 768-dimensional
 * vector embedding (nomic-embed-text compatible), and stores the lesson in project_lessons.
 */

export type HumanCorrectionCategory =
  | 'logic_error'
  | 'convention_violation'
  | 'missing_edge_case'
  | 'performance_issue'
  | 'security_fix';

export interface LearnFromHumanGateDiffInput {
  orgId: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentPatch: string;
  finalMergedPatch: string;
  touchedFiles: string[];
  reviewerNotes?: string;
}

/**
 * Extracts lines present in `finalMergedPatch` that were not present in `agentPatch`.
 */
function extractHumanDeltaLines(agentPatch: string, finalMergedPatch: string): string {
  const agentLines = new Set(
    agentPatch
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const deltaLines = finalMergedPatch
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !agentLines.has(l));
  return deltaLines.length > 0 ? deltaLines.join('\n') : finalMergedPatch;
}

/**
 * Classifies the correction category from the delta between agentPatch and finalMergedPatch.
 */
export function classifyHumanDiffCorrection(input: {
  agentPatch: string;
  finalMergedPatch: string;
  reviewerNotes?: string;
}): {
  category: HumanCorrectionCategory;
  summary: string;
  ruleContent: string;
} {
  const deltaText = extractHumanDeltaLines(input.agentPatch, input.finalMergedPatch);
  const combined = `${deltaText}\n${input.reviewerNotes ?? ''}`;

  if (
    /\b(sanitize|escape|xss|csrf|sql injection|parameterized|authz|rbac|secret|token|crypto|timingSafeEqual)\b/i.test(
      combined
    )
  ) {
    return {
      category: 'security_fix',
      summary: input.reviewerNotes ?? 'Human reviewer applied security hardening before merge.',
      ruleContent:
        'Enforce strict input sanitization, parameterized queries, and authorization checks in this scope.',
    };
  }

  if (
    /\b(null|undefined|optional|fallback|empty|boundary|try\s*\{|catch|Number\.isNaN|length\s*===\s*0|\?\?|\?\.)\b/i.test(
      combined
    )
  ) {
    return {
      category: 'missing_edge_case',
      summary:
        input.reviewerNotes ?? 'Human reviewer added boundary, null-safety, or error-handling guards.',
      ruleContent:
        'Always guard against null/undefined inputs, empty collections, and boundary conditions in this file scope.',
    };
  }

  if (
    /\b(cache|memoize|index|batch|parallel|Promise\.all|limit|pagination|debounce|throttle|O\(1\))\b/i.test(
      combined
    )
  ) {
    return {
      category: 'performance_issue',
      summary: input.reviewerNotes ?? 'Human reviewer optimized query/runtime performance before merge.',
      ruleContent:
        'Avoid unbounded loops or N+1 operations; use batched/indexed access patterns in this scope.',
    };
  }

  if (
    /\b(naming|camelCase|PascalCase|kebab-case|export|interface|type|eslint|format|convention|style)\b/i.test(
      combined
    )
  ) {
    return {
      category: 'convention_violation',
      summary: input.reviewerNotes ?? 'Human reviewer aligned code with project naming and style conventions.',
      ruleContent:
        'Follow project naming, export, and module structure conventions in this scope.',
    };
  }

  return {
    category: 'logic_error',
    summary: input.reviewerNotes ?? 'Human reviewer corrected domain logic in agent patch before merge.',
    ruleContent:
      'Verify domain calculation and branching invariants against human-corrected merge diff in this scope.',
  };
}

/**
 * Learns from human modifications between agent_output (changes.patch) and final_merged_code.
 * Returns null if the human merged the agent patch verbatim without changes.
 */
export async function learnFromHumanGateDiff(
  input: LearnFromHumanGateDiffInput
): Promise<ProjectLessonRecord | null> {
  const normalizedAgent = input.agentPatch.trim();
  const normalizedFinal = input.finalMergedPatch.trim();

  if (normalizedAgent === normalizedFinal) {
    return null;
  }

  const classification = classifyHumanDiffCorrection({
    agentPatch: normalizedAgent,
    finalMergedPatch: normalizedFinal,
    reviewerNotes: input.reviewerNotes,
  });

  const embeddingSource = [
    classification.category,
    classification.summary,
    classification.ruleContent,
    input.touchedFiles.join(' '),
    normalizedFinal.slice(0, 1000),
  ].join(' ');

  const lesson: ProjectLessonRecord = {
    id: crypto.randomUUID(),
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    isOrgWide: false,
    sourceTaskId: input.taskId,
    provenance: 'human_gate_diff',
    confidenceScore: 0.95,
    category: classification.category as LessonCategory,
    triggerScope: input.touchedFiles.length > 0 ? input.touchedFiles : ['*'],
    summary: classification.summary,
    ruleContent: classification.ruleContent,
    embedding: computeDeterministicEmbedding768(embeddingSource),
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  await persistLessonRecordIfDbAvailable(lesson);

  return lesson;
}


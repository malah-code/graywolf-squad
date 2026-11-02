import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { withTenantContext } from '../db';

/**
 * 3-Axis Background Reflection Worker & Hermes-Strict Skill Validator (Task 14.1a, ADR-057, ADR-083, FR-001).
 *
 * Evaluates terminal tasks across 3 axes:
 * 1. Project Memory (project_lessons with provenance = 'reflection_memory')
 * 2. Skill Library (.agents/skills/<name>/SKILL.md with Hermes-strict validation)
 * 3. Anti-Pattern Registry (project_lessons with provenance = 'anti_pattern' and category = 'LLM_CODE_SMELL' | 'TEST_INTEGRITY')
 */

export type LessonProvenance = 'reflection_memory' | 'anti_pattern' | 'human_gate_diff';

export type LessonCategory =
  | 'LLM_CODE_SMELL'
  | 'TEST_INTEGRITY'
  | 'logic_error'
  | 'convention_violation'
  | 'missing_edge_case'
  | 'performance_issue'
  | 'security_fix'
  | 'architecture_convention';

export interface ProjectLessonRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  isOrgWide: boolean;
  sourceTaskId: string | null;
  provenance: LessonProvenance;
  confidenceScore: number;
  category: LessonCategory;
  triggerScope: string[];
  summary: string;
  ruleContent: string;
  embedding: number[]; // length === 768
  status: 'active' | 'archived';
  createdAt: string;
}

export interface SkillSections {
  Title: string;
  'When to Use': string;
  Prerequisites: string;
  'How to Run': string;
  'Quick Reference': string;
  Procedure: string;
  Pitfalls: string;
  Verification: string;
}

export interface SkillDocumentInput {
  name: string;
  description: string;
  version?: string;
  origin?: 'agent-created' | 'user-created';
  pinned?: boolean;
  status?: 'active' | 'stale' | 'archived' | 'pending_deletion' | 'deleted';
  lastUsedAt?: string;
  archivedAt?: string | null;
  sections?: Partial<SkillSections>;
  rawBodyMarkdown?: string;
}

export interface ReflectionTaskInput {
  orgId: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  terminalStatus: 'MERGED' | 'FAILED' | 'VERIFICATION_FAILED' | 'HUMAN_REVIEW_GATE';
  briefGoal: string;
  touchedFiles: string[];
  taskTags?: string[];
  memoryObservation?: {
    summary: string;
    ruleContent: string;
    category?: LessonCategory;
    confidenceScore?: number;
  };
  candidateSkill?: SkillDocumentInput;
  guardOrDebateFailures?: Array<{
    source: 'test-guard' | 'clean-code-guard' | 'doc-guard' | 'adversarial-debate';
    category: 'LLM_CODE_SMELL' | 'TEST_INTEGRITY';
    summary: string;
    negativeConstraint: string;
  }>;
}

export const MANDATORY_SKILL_SECTION_ORDER: readonly (keyof SkillSections)[] = Object.freeze([
  'Title',
  'When to Use',
  'Prerequisites',
  'How to Run',
  'Quick Reference',
  'Procedure',
  'Pitfalls',
  'Verification',
]);

const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKETING_BUZZWORDS_REGEX =
  /\b(revolutionary|seamless|ultimate|world-class|cutting-edge|magical|best-in-class|supercharge|game-changing|unparalleled)\b/i;

// Prohibited skill patterns per PRD §9.3 ("DO NOT capture as skills")
const PROHIBITED_ENV_FAILURE_REGEX =
  /\b(ENOENT|command not found|missing binary|missing api key|unconfigured cred|permission denied:\s*\/usr)\b/i;
const PROHIBITED_NEGATIVE_TOOL_CLAIM_REGEX =
  /\b(tool|command|library|binary|plugin)\s+[a-z0-9_.-]+\s+(does not work|doesn't work|is broken|always fails|never works)\b/i;
const PROHIBITED_TRANSIENT_ERROR_REGEX =
  /\b(transient error that resolved|temporary network blip|ephemeral socket hang up)\b/i;
const PROHIBITED_DEAD_END_REGEX =
  /\b(unresolved failure|could not solve|dead end|unable to fix|gave up on)\b/i;

/**
 * Generates a deterministic 768-dimensional L2-normalized embedding vector from text.
 * Used as the zero-cost offline embedding baseline (Constitution Principle 9) and unit test fixture.
 */
export function computeDeterministicEmbedding768(text: string): number[] {
  const vec = new Float64Array(768);
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9_\s/-]+/g, ' ')
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    vec[0] = 1.0;
    return Array.from(vec);
  }

  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const token = tokens[tIdx];
    // Project word token + character trigrams into 768 dimensions via SHA-256
    const features = [token];
    for (let i = 0; i <= token.length - 3; i++) {
      features.push(token.slice(i, i + 3));
    }

    for (const feat of features) {
      const digest = crypto.createHash('sha256').update(feat, 'utf8').digest();
      for (let b = 0; b < 8; b++) {
        const dim = digest.readUInt16BE(b * 2) % 768;
        const sign = (digest[16 + b] & 1) === 0 ? 1 : -1;
        vec[dim] += sign * (feat === token ? 2.0 : 0.5);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < 768; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq) || 1.0;
  const result = new Array<number>(768);
  for (let i = 0; i < 768; i++) {
    result[i] = Number((vec[i] / norm).toFixed(6));
  }
  return result;
}

/**
 * Computes cosine similarity between two 768-dimensional vectors.
 */
export function cosineSimilarity768(a: number[], b: number[]): number {
  if (a.length !== 768 || b.length !== 768) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 768; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Number((dot / denom).toFixed(4));
}

/**
 * Validates a candidate skill document against Hermes-strict authoring standards (PRD §9.3, ADR-057, FR-001).
 */
export function validateHermesSkillDocument(input: SkillDocumentInput): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // 1. Validate name: lowercase-hyphenated, <= 64 chars
  if (!input.name || input.name.length > 64 || !SKILL_NAME_REGEX.test(input.name)) {
    violations.push(
      `Invalid skill name '${input.name ?? ''}': must be lowercase-hyphenated (/^[a-z0-9]+(?:-[a-z0-9]+)*$/) and <= 64 characters.`
    );
  }

  // 2. Validate description: ONE sentence, <= 60 chars, ends with period, no marketing buzzwords
  const desc = (input.description ?? '').trim();
  if (!desc || desc.length > 60) {
    violations.push(
      `Invalid skill description length (${desc.length} chars): must be 1..60 characters.`
    );
  }
  if (!desc.endsWith('.')) {
    violations.push('Invalid skill description: must end with a period (.).');
  }
  // Check for multiple sentences (period followed by non-empty text)
  const sentenceCount = desc
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  if (sentenceCount > 1) {
    violations.push('Invalid skill description: must be a single sentence.');
  }
  if (MARKETING_BUZZWORDS_REGEX.test(desc)) {
    violations.push('Invalid skill description: marketing buzzwords are prohibited.');
  }

  // 3. Validate version
  const version = input.version ?? '0.1.0';
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    violations.push(`Invalid skill version '${version}': must be valid semver (e.g. '0.1.0').`);
  }

  // 4. Validate mandatory 8-section order
  let combinedText = `${desc}\n`;
  if (input.rawBodyMarkdown !== undefined) {
    combinedText += input.rawBodyMarkdown;
    let lastIdx = -1;
    for (const section of MANDATORY_SKILL_SECTION_ORDER) {
      const headingPattern =
        section === 'Title'
          ? /^#\s+.+/m
          : new RegExp(`^##\\s+${section.replace(/\s+/g, '\\s+')}\\b`, 'm');
      const match = headingPattern.exec(input.rawBodyMarkdown);
      if (!match || match.index === undefined) {
        violations.push(`Missing mandatory skill section: '${section}'.`);
      } else if (match.index < lastIdx) {
        violations.push(
          `Skill section '${section}' is out of mandatory Hermes order (${MANDATORY_SKILL_SECTION_ORDER.join(' -> ')}).`
        );
      } else {
        lastIdx = match.index;
      }
    }
  } else if (input.sections) {
    const providedKeys = Object.keys(input.sections) as (keyof SkillSections)[];
    for (const requiredSection of MANDATORY_SKILL_SECTION_ORDER) {
      const val = input.sections[requiredSection];
      if (!val || val.trim().length === 0) {
        violations.push(`Missing mandatory skill section: '${requiredSection}'.`);
      } else {
        combinedText += `\n${val}`;
      }
    }
    // Verify key ordering if all required sections exist
    const filteredOrder = providedKeys.filter((k) =>
      MANDATORY_SKILL_SECTION_ORDER.includes(k)
    );
    for (let i = 0; i < filteredOrder.length; i++) {
      if (filteredOrder[i] !== MANDATORY_SKILL_SECTION_ORDER[i]) {
        violations.push(
          `Skill sections are out of mandatory Hermes order (${MANDATORY_SKILL_SECTION_ORDER.join(' -> ')}).`
        );
        break;
      }
    }
  } else {
    violations.push('Skill document must provide either structured sections or rawBodyMarkdown.');
  }

  // 5. Reject prohibited content categories (PRD §9.3)
  if (PROHIBITED_ENV_FAILURE_REGEX.test(combinedText)) {
    violations.push('Prohibited skill content: environment-dependent failures (ENOENT, missing binaries/credentials) cannot be captured as skills.');
  }
  if (PROHIBITED_NEGATIVE_TOOL_CLAIM_REGEX.test(combinedText)) {
    violations.push('Prohibited skill content: negative claims about tools ("X does not work") cannot be captured as skills.');
  }
  if (PROHIBITED_TRANSIENT_ERROR_REGEX.test(combinedText)) {
    violations.push('Prohibited skill content: session-specific transient errors cannot be captured as skills.');
  }
  if (PROHIBITED_DEAD_END_REGEX.test(combinedText)) {
    violations.push('Prohibited skill content: unresolved failures / dead ends cannot be captured as skills.');
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Serializes a validated SkillDocumentInput to Hermes-compliant SKILL.md markdown.
 */
export function renderHermesSkillMarkdown(input: SkillDocumentInput): string {
  const version = input.version ?? '0.1.0';
  const origin = input.origin ?? 'agent-created';
  const pinned = input.pinned ?? false;
  const status = input.status ?? 'active';
  const lastUsedAt = input.lastUsedAt ?? new Date().toISOString();
  const archivedAt = input.archivedAt ?? null;

  const frontmatter = [
    '---',
    `name: "${input.name}"`,
    `description: "${input.description.trim()}"`,
    `version: "${version}"`,
    `origin: "${origin}"`,
    `pinned: ${pinned}`,
    `status: "${status}"`,
    `lastUsedAt: "${lastUsedAt}"`,
    ...(archivedAt ? [`archivedAt: "${archivedAt}"`] : []),
    '---',
    '',
  ].join('\n');

  if (input.rawBodyMarkdown) {
    return `${frontmatter}${input.rawBodyMarkdown.trim()}\n`;
  }

  const s = input.sections as SkillSections;
  const body = [
    `# ${s.Title.trim()}`,
    '',
    `## When to Use`,
    s['When to Use'].trim(),
    '',
    `## Prerequisites`,
    s.Prerequisites.trim(),
    '',
    `## How to Run`,
    s['How to Run'].trim(),
    '',
    `## Quick Reference`,
    s['Quick Reference'].trim(),
    '',
    `## Procedure`,
    s.Procedure.trim(),
    '',
    `## Pitfalls`,
    s.Pitfalls.trim(),
    '',
    `## Verification`,
    s.Verification.trim(),
    '',
  ].join('\n');

  return `${frontmatter}${body}`;
}

/**
 * Retrieves relevant Project Memory lessons and Anti-Pattern Registry entries for Dev-Level-1 planning.
 * Enforces cosine similarity >= 0.75, capped at top-5 lessons and top-3 anti-patterns (FR-001).
 */
export function retrieveLessonsForPlan(input: {
  queryText: string;
  queryEmbedding?: number[];
  candidates: ProjectLessonRecord[];
  minSimilarity?: number;
  maxLessons?: number;
  maxAntiPatterns?: number;
}): {
  lessons: Array<ProjectLessonRecord & { similarity: number }>;
  antiPatterns: Array<ProjectLessonRecord & { similarity: number }>;
} {
  const minSimilarity = input.minSimilarity ?? 0.75;
  const maxLessons = input.maxLessons ?? 5;
  const maxAntiPatterns = input.maxAntiPatterns ?? 3;
  const queryVec = input.queryEmbedding ?? computeDeterministicEmbedding768(input.queryText);

  const scoredLessons: Array<ProjectLessonRecord & { similarity: number }> = [];
  const scoredAntiPatterns: Array<ProjectLessonRecord & { similarity: number }> = [];

  for (const candidate of input.candidates) {
    if (candidate.status !== 'active') continue;
    const similarity = cosineSimilarity768(queryVec, candidate.embedding);
    if (similarity < minSimilarity) continue;

    const item = { ...candidate, similarity };
    if (candidate.provenance === 'anti_pattern') {
      scoredAntiPatterns.push(item);
    } else {
      scoredLessons.push(item);
    }
  }

  scoredLessons.sort((a, b) => b.similarity - a.similarity);
  scoredAntiPatterns.sort((a, b) => b.similarity - a.similarity);

  return {
    lessons: scoredLessons.slice(0, maxLessons),
    antiPatterns: scoredAntiPatterns.slice(0, maxAntiPatterns),
  };
}

/**
 * Persists a ProjectLessonRecord to PostgreSQL via withTenantContext when a DB pool is active,
 * falling back cleanly in headless unit-test environments.
 */
export async function persistLessonRecordIfDbAvailable(
  record: ProjectLessonRecord
): Promise<void> {
  try {
    await withTenantContext(
      { workspaceId: record.workspaceId, orgId: record.orgId },
      async (client) => {
        const vectorLiteral = `[${record.embedding.join(',')}]`;
        await client.query(
          `INSERT INTO project_lessons (
            id, org_id, workspace_id, project_id, is_org_wide, source_task_id,
            provenance, confidence_score, category, trigger_scope, summary, rule_content, embedding, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector, $14)`,
          [
            record.id,
            record.orgId,
            record.workspaceId,
            record.projectId,
            record.isOrgWide,
            record.sourceTaskId,
            record.provenance,
            record.confidenceScore,
            record.category,
            record.triggerScope,
            record.summary,
            record.ruleContent,
            vectorLiteral,
            record.status,
          ]
        );
      }
    );
  } catch {
    // Headless unit test environment without live PostgreSQL connection
  }
}

/**
 * Executes the 3-Axis Background Reflection pass on a terminal task (Task 14.1a, ADR-057, ADR-083, FR-001).
 */
export async function runTaskReflection(
  input: ReflectionTaskInput,
  options?: { skillsRootDir?: string }
): Promise<{
  memoryLessonsStored: ProjectLessonRecord[];
  antiPatternsStored: ProjectLessonRecord[];
  skillAuthoredPath: string | null;
  skillRejectedReasons: string[];
}> {
  const skillsRootDir = options?.skillsRootDir ?? path.join('.agents', 'skills');
  const memoryLessonsStored: ProjectLessonRecord[] = [];
  const antiPatternsStored: ProjectLessonRecord[] = [];
  let skillAuthoredPath: string | null = null;
  const skillRejectedReasons: string[] = [];

  // Axis 1: Project Memory
  if (input.memoryObservation) {
    const embeddingText = `${input.memoryObservation.summary} ${input.memoryObservation.ruleContent} ${input.touchedFiles.join(' ')}`;
    const rawConfidence = input.memoryObservation.confidenceScore ?? 0.9;
    const clampedConfidence = Math.min(1, Math.max(0, Number(rawConfidence.toFixed(2))));
    const lesson: ProjectLessonRecord = {
      id: crypto.randomUUID(),
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      isOrgWide: false,
      sourceTaskId: input.taskId,
      provenance: 'reflection_memory',
      confidenceScore: clampedConfidence,
      category: input.memoryObservation.category ?? 'architecture_convention',
      triggerScope: input.touchedFiles.length > 0 ? input.touchedFiles : (input.taskTags ?? ['*']),
      summary: input.memoryObservation.summary,
      ruleContent: input.memoryObservation.ruleContent,
      embedding: computeDeterministicEmbedding768(embeddingText),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await persistLessonRecordIfDbAvailable(lesson);
    memoryLessonsStored.push(lesson);
  }

  // Axis 2: Skill Library (.agents/skills/<name>/SKILL.md)
  if (input.candidateSkill) {
    const validation = validateHermesSkillDocument(input.candidateSkill);
    if (!validation.valid) {
      skillRejectedReasons.push(...validation.violations);
    } else {
      const resolvedRoot = path.resolve(skillsRootDir);
      const skillDir = path.join(skillsRootDir, input.candidateSkill.name);
      const resolvedSkillDir = path.resolve(skillDir);
      if (!resolvedSkillDir.startsWith(resolvedRoot + path.sep)) {
        skillRejectedReasons.push(
          `Path traversal rejected for skill '${input.candidateSkill.name}'.`
        );
      } else {
        await fs.mkdir(skillDir, { recursive: true });
        const skillFilePath = path.join(skillDir, 'SKILL.md');

        // Check if an existing user-created or pinned skill exists at this path — never overwrite protected skills
        let isProtectedSkill = false;
        try {
          const existingContent = await fs.readFile(skillFilePath, 'utf8');
          if (
            /^origin:\s*["']?user-created["']?/m.test(existingContent) ||
            /^pinned:\s*true\b/m.test(existingContent)
          ) {
            isProtectedSkill = true;
          }
        } catch {
          // Does not exist yet
        }

        if (isProtectedSkill) {
          skillRejectedReasons.push(
            `Cannot overwrite existing protected (user-created or pinned) skill '${input.candidateSkill.name}'.`
          );
        } else {
          const markdown = renderHermesSkillMarkdown({
            ...input.candidateSkill,
            origin: 'agent-created',
            version: input.candidateSkill.version ?? '0.1.0',
          });
          await fs.writeFile(skillFilePath, markdown, 'utf8');
          skillAuthoredPath = skillFilePath;
        }
      }
    }
  }

  // Axis 3: Anti-Pattern Registry (Gate 4 guard failures & ADR-056 debate rejections)
  if (input.guardOrDebateFailures && input.guardOrDebateFailures.length > 0) {
    for (const failure of input.guardOrDebateFailures) {
      const embeddingText = `${failure.category} ${failure.summary} ${failure.negativeConstraint} ${input.touchedFiles.join(' ')}`;
      const antiPattern: ProjectLessonRecord = {
        id: crypto.randomUUID(),
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        isOrgWide: false,
        sourceTaskId: input.taskId,
        provenance: 'anti_pattern',
        confidenceScore: 0.95,
        category: failure.category,
        triggerScope: input.touchedFiles.length > 0 ? input.touchedFiles : (input.taskTags ?? ['*']),
        summary: `[${failure.source}] ${failure.summary}`,
        ruleContent: failure.negativeConstraint,
        embedding: computeDeterministicEmbedding768(embeddingText),
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await persistLessonRecordIfDbAvailable(antiPattern);
      antiPatternsStored.push(antiPattern);
    }
  }

  return {
    memoryLessonsStored,
    antiPatternsStored,
    skillAuthoredPath,
    skillRejectedReasons,
  };
}


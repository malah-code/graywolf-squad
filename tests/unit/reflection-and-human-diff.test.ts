import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateHermesSkillDocument,
  computeDeterministicEmbedding768,
  retrieveLessonsForPlan,
  runTaskReflection,
  type SkillDocumentInput,
} from '../../src/orchestrator/learning/reflection-worker';
import { learnFromHumanGateDiff } from '../../src/orchestrator/learning/human-gate-diff';

describe('3-Axis Background Reflection Worker & Human Gate Diff Learner (Task 14.1, ADR-057, ADR-083)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-reflection-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const validSkill: SkillDocumentInput = {
    name: 'add-fastify-route-endpoint',
    description: 'Registers a TypeBox-validated Fastify REST endpoint.',
    version: '0.1.0',
    sections: {
      Title: 'Add Fastify Route Endpoint',
      'When to Use': 'When adding a new REST route to the orchestrator control plane.',
      Prerequisites: 'TypeBox schema defined in src/orchestrator/schemas/.',
      'How to Run': 'Import and register the route plugin in src/orchestrator/app.ts.',
      'Quick Reference': 'server.post(path, { schema }, handler)',
      Procedure: '1. Define TypeBox schema.\n2. Register route.\n3. Add integration test.',
      Pitfalls: 'Never omit withTenantContext on workspace-scoped queries.',
      Verification: 'Run pnpm vitest run tests/integration/routes-projects-tasks.test.ts.',
    },
  };

  describe('Hermes-Strict Skill Validator (validateHermesSkillDocument)', () => {
    it('accepts a valid 8-section Hermes skill document', () => {
      const res = validateHermesSkillDocument(validSkill);
      expect(res.valid).toBe(true);
      expect(res.violations).toHaveLength(0);
    });

    it('rejects skill names exceeding 64 chars or containing uppercase/spaces', () => {
      const invalidName = validateHermesSkillDocument({
        ...validSkill,
        name: 'Invalid_Skill_Name_With_Uppercase',
      });
      expect(invalidName.valid).toBe(false);
      expect(invalidName.violations[0]).toContain('Invalid skill name');

      const tooLongName = validateHermesSkillDocument({
        ...validSkill,
        name: 'a'.repeat(65),
      });
      expect(tooLongName.valid).toBe(false);
    });

    it('rejects descriptions > 60 chars, missing trailing period, multi-sentence, or containing marketing buzzwords', () => {
      const noPeriod = validateHermesSkillDocument({
        ...validSkill,
        description: 'Registers a Fastify route without period',
      });
      expect(noPeriod.valid).toBe(false);

      const tooLong = validateHermesSkillDocument({
        ...validSkill,
        description: 'This description is way too long and exceeds sixty characters easily.',
      });
      expect(tooLong.valid).toBe(false);

      const multiSentence = validateHermesSkillDocument({
        ...validSkill,
        description: 'First sentence. Second sentence.',
      });
      expect(multiSentence.valid).toBe(false);

      const buzzword = validateHermesSkillDocument({
        ...validSkill,
        description: 'A revolutionary workflow for Fastify routes.',
      });
      expect(buzzword.valid).toBe(false);
      expect(buzzword.violations.join(' ')).toContain('marketing buzzwords');
    });

    it('rejects missing or out-of-order mandatory sections', () => {
      const outOfOrderMarkdown = [
        '# Title Here',
        '## Prerequisites',
        'Prereq text',
        '## When to Use',
        'Swapped order',
        '## How to Run',
        'Run',
        '## Quick Reference',
        'Ref',
        '## Procedure',
        'Steps',
        '## Pitfalls',
        'Pitfalls',
        '## Verification',
        'Verify',
      ].join('\n');

      const res = validateHermesSkillDocument({
        name: 'valid-name',
        description: 'Valid short description ending with period.',
        rawBodyMarkdown: outOfOrderMarkdown,
      });
      expect(res.valid).toBe(false);
      expect(res.violations.join(' ')).toContain('out of mandatory Hermes order');
    });

    it('rejects environment failures, negative tool claims, and unresolved dead ends (PRD §9.3)', () => {
      const envFailure = validateHermesSkillDocument({
        ...validSkill,
        sections: {
          ...validSkill.sections!,
          Pitfalls: 'Fails with ENOENT: command not found when docker is missing.',
        },
      });
      expect(envFailure.valid).toBe(false);
      expect(envFailure.violations.join(' ')).toContain('environment-dependent failures');

      const negativeToolClaim = validateHermesSkillDocument({
        ...validSkill,
        sections: {
          ...validSkill.sections!,
          Pitfalls: 'The tool ast-grep does not work on this repo.',
        },
      });
      expect(negativeToolClaim.valid).toBe(false);
      expect(negativeToolClaim.violations.join(' ')).toContain('negative claims about tools');

      const deadEnd = validateHermesSkillDocument({
        ...validSkill,
        sections: {
          ...validSkill.sections!,
          Procedure: 'This was an unresolved failure and dead end during debugging.',
        },
      });
      expect(deadEnd.valid).toBe(false);
      expect(deadEnd.violations.join(' ')).toContain('unresolved failures');
    });
  });

  describe('3-Axis Reflection Execution & Planner Retrieval', () => {
    it('stores Project Memory, writes Hermes SKILL.md, and records Anti-Pattern Registry entries', async () => {
      const outcome = await runTaskReflection(
        {
          orgId: '00000000-0000-0000-0000-000000000001',
          workspaceId: '00000000-0000-0000-0000-000000000002',
          projectId: '00000000-0000-0000-0000-000000000003',
          taskId: 'TASK-1401',
          terminalStatus: 'MERGED',
          briefGoal: 'Add Fastify endpoint for project lessons',
          touchedFiles: ['src/orchestrator/routes/projects.ts'],
          memoryObservation: {
            summary: 'Always wrap workspace SQL queries in withTenantContext.',
            ruleContent: 'Use withTenantContext({ workspaceId, orgId }) on all project routes.',
            category: 'architecture_convention',
          },
          candidateSkill: validSkill,
          guardOrDebateFailures: [
            {
              source: 'test-guard',
              category: 'TEST_INTEGRITY',
              summary: 'Internal domain service was mocked in unit test',
              negativeConstraint: 'Never mock internal domain modules in src/orchestrator/services/.',
            },
          ],
        },
        { skillsRootDir: tempDir }
      );

      expect(outcome.memoryLessonsStored).toHaveLength(1);
      expect(outcome.memoryLessonsStored[0].embedding).toHaveLength(768);
      expect(outcome.antiPatternsStored).toHaveLength(1);
      expect(outcome.antiPatternsStored[0].category).toBe('TEST_INTEGRITY');
      expect(outcome.skillAuthoredPath).not.toBeNull();

      const skillDiskContent = await fs.readFile(outcome.skillAuthoredPath!, 'utf8');
      expect(skillDiskContent).toContain('name: "add-fastify-route-endpoint"');
      expect(skillDiskContent).toContain('## When to Use');
      expect(skillDiskContent).toContain('## Verification');
    });

    it('enforces cosine similarity >= 0.75 and caps at top-5 lessons and top-3 anti-patterns', () => {
      const queryText = 'withTenantContext workspace SQL query isolation in Fastify routes';
      const queryEmbedding = computeDeterministicEmbedding768(queryText);

      // Create 7 matching lessons and 5 matching anti-patterns + 1 unrelated lesson
      const candidates = [
        ...Array.from({ length: 7 }, (_, idx) => ({
          id: `lesson-${idx}`,
          orgId: 'org-1',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          isOrgWide: false,
          sourceTaskId: `TASK-${idx}`,
          provenance: 'reflection_memory' as const,
          confidenceScore: 0.9,
          category: 'architecture_convention' as const,
          triggerScope: ['src/orchestrator/routes/projects.ts'],
          summary: `Lesson ${idx}`,
          ruleContent: queryText,
          embedding: queryEmbedding,
          status: 'active' as const,
          createdAt: new Date().toISOString(),
        })),
        ...Array.from({ length: 5 }, (_, idx) => ({
          id: `ap-${idx}`,
          orgId: 'org-1',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          isOrgWide: false,
          sourceTaskId: `TASK-AP-${idx}`,
          provenance: 'anti_pattern' as const,
          confidenceScore: 0.95,
          category: 'LLM_CODE_SMELL' as const,
          triggerScope: ['src/orchestrator/routes/projects.ts'],
          summary: `Anti-pattern ${idx}`,
          ruleContent: queryText,
          embedding: queryEmbedding,
          status: 'active' as const,
          createdAt: new Date().toISOString(),
        })),
        {
          id: 'unrelated-1',
          orgId: 'org-1',
          workspaceId: 'ws-1',
          projectId: 'proj-1',
          isOrgWide: false,
          sourceTaskId: 'TASK-UNRELATED',
          provenance: 'reflection_memory' as const,
          confidenceScore: 0.9,
          category: 'architecture_convention' as const,
          triggerScope: ['README.md'],
          summary: 'Unrelated css color tweak',
          ruleContent: 'completely orthogonal quantum physics astrophysics zebra',
          embedding: computeDeterministicEmbedding768(
            'completely orthogonal quantum physics astrophysics zebra'
          ),
          status: 'active' as const,
          createdAt: new Date().toISOString(),
        },
      ];

      const retrieved = retrieveLessonsForPlan({
        queryText,
        candidates,
      });

      expect(retrieved.lessons).toHaveLength(5);
      expect(retrieved.antiPatterns).toHaveLength(3);
      expect(retrieved.lessons.every((l) => l.similarity >= 0.75)).toBe(true);
      expect(retrieved.lessons.some((l) => l.id === 'unrelated-1')).toBe(false);
    });
  });

  describe('Human Gate Diff Learner (learnFromHumanGateDiff)', () => {
    it('returns null when human merges agent patch without modifications', async () => {
      const patch = '+ const x = 1;\n';
      const res = await learnFromHumanGateDiff({
        orgId: 'org-1',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        taskId: 'TASK-1402',
        agentPatch: patch,
        finalMergedPatch: patch,
        touchedFiles: ['src/index.ts'],
      });
      expect(res).toBeNull();
    });

    it('classifies human diff corrections and generates 768-dim lesson embeddings', async () => {
      const agentPatch = '+ const discount = price * rate;\n';
      const finalMergedPatch =
        '+ const discount = (price ?? 0) * (Number.isNaN(rate) ? 0 : rate);\n';

      const lesson = await learnFromHumanGateDiff({
        orgId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        projectId: '00000000-0000-0000-0000-000000000003',
        taskId: 'TASK-1403',
        agentPatch,
        finalMergedPatch,
        touchedFiles: ['src/billing/discount.ts'],
        reviewerNotes: 'Added null and NaN edge-case guards on discount calculation.',
      });

      expect(lesson).not.toBeNull();
      expect(lesson!.provenance).toBe('human_gate_diff');
      expect(lesson!.category).toBe('missing_edge_case');
      expect(lesson!.embedding).toHaveLength(768);
      expect(lesson!.triggerScope).toEqual(['src/billing/discount.ts']);
    });

    it('classifies human delta lines without being misled by unchanged lines in agentPatch', async () => {
      // Unchanged line contains "token" and "null", but the human edit is purely a math logic fix
      const agentPatch = [
        '+ const authHeader = token ?? null;',
        '+ const total = subtotal + tax;',
      ].join('\n');
      const finalMergedPatch = [
        '+ const authHeader = token ?? null;',
        '+ const total = subtotal - discount + tax;',
      ].join('\n');

      const lesson = await learnFromHumanGateDiff({
        orgId: '00000000-0000-0000-0000-000000000001',
        workspaceId: '00000000-0000-0000-0000-000000000002',
        projectId: '00000000-0000-0000-0000-000000000003',
        taskId: 'TASK-1404',
        agentPatch,
        finalMergedPatch,
        touchedFiles: ['src/billing/total.ts'],
      });

      expect(lesson).not.toBeNull();
      expect(lesson!.category).toBe('logic_error');
    });
  });
});


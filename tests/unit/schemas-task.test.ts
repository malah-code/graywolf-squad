import { describe, it, expect } from 'vitest';
import {
  TaskBriefFrontmatterSchema,
  TaskPlanFrontmatterSchema,
  EscalationRequestFrontmatterSchema,
  ReviewSignoffFrontmatterSchema,
  parseMarkdownArtifact,
  serializeMarkdownArtifact,
} from '../../src/orchestrator/schemas/task';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('Task Frontmatter Schemas & Markdown Artifact Parser', () => {
  describe('brief.md frontmatter parsing and validation', () => {
    const validBriefMarkdown = `---
id: TASK-402-AUTH-MIDDLEWARE
title: Implement JWT Validation Middleware
type: feature
status: IN_PROGRESS
priority: P1
assignedTier: dev-level-3
blockedBy:
  - TASK-401-KEYCLOAK-DISCOVERY
branch: worktree-task-402
targetFiles:
  - src/middleware/auth.ts
  - tests/middleware/auth.test.ts
writableScope:
  - src/middleware/auth.ts
  - tests/middleware/auth.test.ts
spendLimitUSD: 15.00
currentSpendUSD: 2.45
internalReviewAttempts: 1
created: 2026-09-10T22:00:00Z
updated: 2026-09-10T22:15:00Z
---

# Task Brief

Implement JWT middleware with Valkey revocation checking.
`;

    it('successfully parses valid brief.md artifact', () => {
      const { frontmatter, body } = parseMarkdownArtifact(
        validBriefMarkdown,
        TaskBriefFrontmatterSchema
      );

      expect(frontmatter.id).toBe('TASK-402-AUTH-MIDDLEWARE');
      expect(frontmatter.type).toBe('feature');
      expect(frontmatter.status).toBe('IN_PROGRESS');
      expect(frontmatter.spendLimitUSD).toBe(15.0);
      expect(frontmatter.internalReviewAttempts).toBe(1);
      expect(body).toContain('# Task Brief');
    });

    it('rejects brief.md with invalid status or negative spend limit', () => {
      const invalidStatusMarkdown = validBriefMarkdown.replace('IN_PROGRESS', 'INVALID_STATUS');
      expect(() =>
        parseMarkdownArtifact(invalidStatusMarkdown, TaskBriefFrontmatterSchema)
      ).toThrow(GraywolfAppError);

      const negativeSpendMarkdown = validBriefMarkdown.replace('spendLimitUSD: 15.00', 'spendLimitUSD: -5.00');
      expect(() =>
        parseMarkdownArtifact(negativeSpendMarkdown, TaskBriefFrontmatterSchema)
      ).toThrow(GraywolfAppError);

      const invalidIdMarkdown = validBriefMarkdown.replace('TASK-402-AUTH-MIDDLEWARE', 'NOT-A-TASK-ID');
      expect(() =>
        parseMarkdownArtifact(invalidIdMarkdown, TaskBriefFrontmatterSchema)
      ).toThrow(GraywolfAppError);
    });
  });

  describe('plan.md frontmatter parsing and validation', () => {
    const validPlanMarkdown = `---
taskId: TASK-402-AUTH-MIDDLEWARE
authoredBy: dev-level-1
modelUsed: claude-3-5-sonnet-20241022
designatedImplementer: dev-level-3
designatedReviewer: dev-level-2
requiresHumanGate: false
---

# Implementation Plan

1. Inject ValkeyService
2. Add JWT validation check
`;

    it('successfully parses valid plan.md artifact', () => {
      const { frontmatter, body } = parseMarkdownArtifact(
        validPlanMarkdown,
        TaskPlanFrontmatterSchema
      );

      expect(frontmatter.taskId).toBe('TASK-402-AUTH-MIDDLEWARE');
      expect(frontmatter.authoredBy).toBe('dev-level-1');
      expect(frontmatter.designatedImplementer).toBe('dev-level-3');
      expect(frontmatter.designatedReviewer).toBe('dev-level-2');
      expect(frontmatter.requiresHumanGate).toBe(false);
      expect(body).toContain('# Implementation Plan');
    });

    it('rejects plan.md with non-standard tier assignments', () => {
      const invalidAuthor = validPlanMarkdown.replace('authoredBy: dev-level-1', 'authoredBy: human');
      expect(() =>
        parseMarkdownArtifact(invalidAuthor, TaskPlanFrontmatterSchema)
      ).toThrow(GraywolfAppError);
    });
  });

  describe('escalation-request.md and review-signoff.md', () => {
    it('parses valid escalation-request.md', () => {
      const escalationMarkdown = `---
taskId: TASK-402-AUTH-MIDDLEWARE
escalationType: boundary-violation
emittedAt: 2026-09-10T22:30:00Z
agentTier: dev-level-3
---

Need access to src/core/auth/jwt.ts
`;

      const { frontmatter } = parseMarkdownArtifact(
        escalationMarkdown,
        EscalationRequestFrontmatterSchema
      );
      expect(frontmatter.escalationType).toBe('boundary-violation');
      expect(frontmatter.agentTier).toBe('dev-level-3');
    });

    it('parses valid review-signoff.md', () => {
      const signoffMarkdown = `---
taskId: TASK-402-AUTH-MIDDLEWARE
reviewer: dev-level-2
attempt: 1
verdict: approved
---

Approved after 12 passing unit tests.
`;

      const { frontmatter } = parseMarkdownArtifact(
        signoffMarkdown,
        ReviewSignoffFrontmatterSchema
      );
      expect(frontmatter.reviewer).toBe('dev-level-2');
      expect(frontmatter.attempt).toBe(1);
      expect(frontmatter.verdict).toBe('approved');
    });
  });

  describe('round-trip serialization fidelity', () => {
    it('serializes and re-parses artifact preserving all fields and body content', () => {
      const initialFrontmatter = {
        taskId: 'TASK-999-SERIALIZE-TEST',
        reviewer: 'dev-level-2' as const,
        attempt: 2,
        verdict: 'approved' as const,
      };
      const initialBody = '## Review Notes\nAll tests pass.\n';

      const serialized = serializeMarkdownArtifact(
        initialFrontmatter,
        initialBody,
        ReviewSignoffFrontmatterSchema
      );

      const parsed = parseMarkdownArtifact(serialized, ReviewSignoffFrontmatterSchema);
      expect(parsed.frontmatter).toEqual(initialFrontmatter);
      expect(parsed.body.trim()).toBe(initialBody.trim());
    });

    it('validate-on-serialize rejects invalid frontmatter and malformed YAML throws ACI_VALIDATION_FAILED', () => {
      expect(() =>
        serializeMarkdownArtifact(
          { taskId: 'INVALID', reviewer: 'dev-level-2', attempt: 0, verdict: 'approved' },
          'body',
          ReviewSignoffFrontmatterSchema
        )
      ).toThrow(GraywolfAppError);

      expect(() =>
        parseMarkdownArtifact('---\n: : invalid: yaml: [\n---\nbody', ReviewSignoffFrontmatterSchema)
      ).toThrow(GraywolfAppError);
    });
  });
});

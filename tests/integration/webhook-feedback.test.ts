import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/orchestrator/app';
import {
  VcsWebhookDebouncer,
  handleInboundPrReviewFeedback,
  InboundPrReviewComment,
  DebouncedCommentBatch,
} from '../../src/orchestrator/routes/webhooks-vcs';
import { RepoSdkClient, VcsProviderType } from '../../src/orchestrator/delivery/repo-sdk';
import {
  PmSyncService,
  ExternalIssueState,
  mapGraywolfStatusToExternalLabel,
} from '../../src/orchestrator/delivery/pm-sync';
import { TaskStatus } from '../../src/orchestrator/schemas/task';
import { VerificationEvidenceEntry } from '../../src/orchestrator/guards/evidence-ledger';

describe('VCS Webhook Review Feedback & Bidirectional PM Sync Integration Tests (US4, Task 11.4)', () => {
  describe('1. VcsWebhookDebouncer Comment Coalescing', () => {
    it('coalesces rapid sequential comments for the same PR within debounce window', async () => {
      const flushedBatches: DebouncedCommentBatch[] = [];
      const debouncer = new VcsWebhookDebouncer({
        debounceMs: 50,
        onFlush: async (batch) => {
          flushedBatches.push(batch);
        },
      });

      const comment1: InboundPrReviewComment = {
        provider: 'github',
        taskId: 'TASK-401',
        prNumber: 12,
        author: 'reviewer1',
        body: 'Please fix typo in README',
      };
      const comment2: InboundPrReviewComment = {
        provider: 'github',
        taskId: 'TASK-401',
        prNumber: 12,
        author: 'reviewer2',
        body: 'Also rename parameter x to count',
      };

      debouncer.enqueue(comment1);
      debouncer.enqueue(comment2);

      expect(flushedBatches).toHaveLength(0);

      // Wait for debounce timer
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0].taskId).toBe('TASK-401');
      expect(flushedBatches[0].prNumber).toBe(12);
      expect(flushedBatches[0].comments).toHaveLength(2);
      expect(flushedBatches[0].comments[0].body).toBe('Please fix typo in README');
      expect(flushedBatches[0].comments[1].body).toBe('Also rename parameter x to count');
    });

    it('manages separate debounced batches for different tasks/PRs', async () => {
      const flushedBatches: DebouncedCommentBatch[] = [];
      const debouncer = new VcsWebhookDebouncer({
        debounceMs: 40,
        onFlush: async (batch) => {
          flushedBatches.push(batch);
        },
      });

      debouncer.enqueue({
        provider: 'gitlab',
        taskId: 'TASK-A',
        prNumber: 10,
        author: 'dev-a',
        body: 'Comment on PR 10',
      });
      debouncer.enqueue({
        provider: 'gitlab',
        taskId: 'TASK-B',
        prNumber: 20,
        author: 'dev-b',
        body: 'Comment on PR 20',
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(flushedBatches).toHaveLength(2);
      const taskIds = flushedBatches.map((b) => b.taskId).sort();
      expect(taskIds).toEqual(['TASK-A', 'TASK-B']);
    });

    it('flushes immediately when flushNow() is called', async () => {
      const flushedBatches: DebouncedCommentBatch[] = [];
      const debouncer = new VcsWebhookDebouncer({
        debounceMs: 5000, // very long delay
        onFlush: async (batch) => {
          flushedBatches.push(batch);
        },
      });

      debouncer.enqueue({
        provider: 'bitbucket',
        taskId: 'TASK-IMMEDIATE',
        prNumber: 99,
        author: 'lead',
        body: 'Urgent fix needed',
      });

      expect(flushedBatches).toHaveLength(0);

      await debouncer.flushNow('TASK-IMMEDIATE');

      expect(flushedBatches).toHaveLength(1);
      expect(flushedBatches[0].taskId).toBe('TASK-IMMEDIATE');
      expect(flushedBatches[0].comments[0].body).toBe('Urgent fix needed');
    });
  });

  describe('2. Inbound Webhook HTTP Route (POST /api/v1/webhooks/vcs/:provider)', () => {
    let app: FastifyInstance;

    beforeEach(() => {
      app = buildApp({ logger: false });
    });

    const providers: VcsProviderType[] = ['github', 'gitlab', 'bitbucket', 'azure', 'gitea'];

    providers.forEach((provider) => {
      it(`accepts webhook payloads from ${provider} and returns 202 Accepted`, async () => {
        const payload = {
          taskId: `TASK-${provider.toUpperCase()}-01`,
          number: 42,
          comment: {
            id: 1001,
            body: `Review feedback on ${provider}`,
            user: { login: 'test-reviewer' },
            path: 'src/index.ts',
            line: 15,
          },
        };

        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/webhooks/vcs/${provider}`,
          payload,
        });

        expect(res.statusCode).toBe(202);
        const data = JSON.parse(res.payload);
        expect(data.received).toBe(true);
        expect(data.queued).toBe(true);
        expect(data.provider).toBe(provider);
        expect(data.taskId).toBe(`TASK-${provider.toUpperCase()}-01`);
        expect(data.prNumber).toBe(42);
      });
    });

    it('extracts taskId from pull_request title pattern [TASK-ID] if not explicitly in body', async () => {
      const payload = {
        pull_request: {
          number: 77,
          title: '[GW-909] Add VCS webhook support',
        },
        comment: {
          body: 'Looks good overall, please add test',
          author: 'senior-dev',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/vcs/github',
        payload,
      });

      expect(res.statusCode).toBe(202);
      const data = JSON.parse(res.payload);
      expect(data.taskId).toBe('GW-909');
      expect(data.prNumber).toBe(77);
    });

    it('rejects unsupported VCS provider with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/vcs/unknown_vcs',
        payload: { body: 'test comment' },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toContain('Unsupported VCS provider: unknown_vcs');
      expect(data.supported).toEqual(expect.arrayContaining(['github', 'gitlab', 'bitbucket', 'azure', 'gitea']));
    });

    it('parses GitLab webhook payload structure (merge_request.iid + object_attributes.note)', async () => {
      const payload = {
        merge_request: {
          iid: 88,
          title: '[GW-GL-1] Refactor auth service',
        },
        object_attributes: {
          note: 'Please address comment',
          user: { username: 'gitlab-dev' },
          path: 'src/auth.ts',
          line: 25,
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/vcs/gitlab',
        payload,
      });

      expect(res.statusCode).toBe(202);
      const data = JSON.parse(res.payload);
      expect(data.taskId).toBe('GW-GL-1');
      expect(data.prNumber).toBe(88);
      expect(data.provider).toBe('gitlab');
    });
  });

  describe('3. End-to-End Rework Loop (handleInboundPrReviewFeedback)', () => {
    it('dispatches ARP review.feedback, runs guards, and pushes commit when guards PASS', async () => {
      const mockPushTaskBranch = vi.fn().mockResolvedValue({
        pushed: true,
        branch: 'feat/feedback-pass',
        commitSha: 'sha99999999',
      });
      const mockPostComment = vi.fn().mockResolvedValue({
        commentId: 'c-100',
        prNumber: 33,
      });

      const repoClient = new RepoSdkClient({
        provider: 'github',
        repoUrl: 'https://github.com/org/repo.git',
        adapter: {
          pushTaskBranch: mockPushTaskBranch,
          postPullRequestComment: mockPostComment,
        },
      });

      const arpEvents: Array<{ type: string; taskId: string; commentsCount: number }> = [];

      const batch: DebouncedCommentBatch = {
        taskId: 'TASK-REWORK-01',
        prNumber: 33,
        provider: 'github',
        comments: [
          {
            provider: 'github',
            taskId: 'TASK-REWORK-01',
            prNumber: 33,
            author: 'lead',
            body: 'Clean up imports',
          },
        ],
      };

      const passingEvidence: VerificationEvidenceEntry[] = [
        {
          id: 'ev-test-1',
          taskId: 'TASK-REWORK-01',
          workspaceId: 'ws-rework',
          commandType: 'test',
          command: 'pnpm vitest run',
          exitCode: 0,
          durationMs: 800,
          createdAt: new Date().toISOString(),
        },
      ];

      const cleanPatch = `--- a/src/service.ts
+++ b/src/service.ts
@@ -1,2 +1,6 @@
+export function calculateTotal(items: number[]): number {
+  return items.reduce((a, b) => a + b, 0);
+}
--- a/tests/service.test.ts
+++ b/tests/service.test.ts
@@ -0,0 +1,5 @@
+import { calculateTotal } from '../src/service';
+it('calculates total', () => {
+  expect(calculateTotal([1, 2])).toBe(3);
+});
+`;

      const result = await handleInboundPrReviewFeedback({
        batch,
        repoClient,
        branchName: 'feat/feedback-pass',
        commitSha: 'sha99999999',
        guardOptions: {
          currentStatus: 'GUARD_VERIFYING',
          qaAttempts: 0,
          patchContent: cleanPatch,
          evidenceEntries: passingEvidence,
          prDescription: 'Updated PR with reworked imports',
        },
        onArpFeedbackDispatched: async (event) => {
          arpEvents.push(event);
        },
      });

      expect(arpEvents).toHaveLength(1);
      expect(arpEvents[0]).toEqual({
        type: 'review.feedback',
        taskId: 'TASK-REWORK-01',
        commentsCount: 1,
      });

      expect(result.guardVerdict).toBe('PASS');
      expect(result.pushed).toBe(true);
      expect(result.commentAckPosted).toBe(true);

      expect(mockPushTaskBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'feat/feedback-pass',
          commitSha: 'sha99999999',
        })
      );
      expect(mockPostComment).toHaveBeenCalledWith(
        expect.objectContaining({
          prNumber: 33,
          bodyMarkdown: expect.stringContaining('Guards PASSED ✅'),
        })
      );
    });

    it('dispatches ARP review.feedback, halts push and posts warning when guards FAIL', async () => {
      const mockPushTaskBranch = vi.fn();
      const mockPostComment = vi.fn().mockResolvedValue({
        commentId: 'c-fail-101',
        prNumber: 44,
      });

      const repoClient = new RepoSdkClient({
        provider: 'gitlab',
        repoUrl: 'https://gitlab.com/org/repo.git',
        adapter: {
          pushTaskBranch: mockPushTaskBranch,
          postPullRequestComment: mockPostComment,
        },
      });

      const arpEvents: Array<{ type: string; taskId: string; commentsCount: number }> = [];

      const batch: DebouncedCommentBatch = {
        taskId: 'TASK-REWORK-FAIL',
        prNumber: 44,
        provider: 'gitlab',
        comments: [
          {
            provider: 'gitlab',
            taskId: 'TASK-REWORK-FAIL',
            prNumber: 44,
            author: 'lead',
            body: 'Ensure clean code standards',
          },
        ],
      };

      // Violates clean code guard (console.log)
      const failingPatch = '--- a/src/bad.ts\n+++ b/src/bad.ts\n@@ -1 +1 @@\n+console.log("bad debugging");\n';

      const result = await handleInboundPrReviewFeedback({
        batch,
        repoClient,
        branchName: 'feat/feedback-fail',
        commitSha: 'sha00000000',
        guardOptions: {
          currentStatus: 'GUARD_VERIFYING',
          qaAttempts: 0,
          patchContent: failingPatch,
          evidenceEntries: [],
        },
        onArpFeedbackDispatched: async (event) => {
          arpEvents.push(event);
        },
      });

      expect(arpEvents).toHaveLength(1);
      expect(result.guardVerdict).toBe('FAIL');
      expect(result.pushed).toBe(false);
      expect(result.commentAckPosted).toBe(true);

      // Verify pushTaskBranch was NOT called
      expect(mockPushTaskBranch).not.toHaveBeenCalled();

      // Verify PR warning comment was posted
      expect(mockPostComment).toHaveBeenCalledWith(
        expect.objectContaining({
          prNumber: 44,
          bodyMarkdown: expect.stringContaining('Rework failed external QA verification'),
        })
      );
    });
  });

  describe('4. Bidirectional PM Sync Authority Rules (PmSyncService)', () => {
    const pmService = new PmSyncService();

    it('enforces that Graywolf owns TaskStatus lifecycle and rejects external status overrides', () => {
      const externalIssue: ExternalIssueState = {
        externalId: 'EXT-101',
        provider: 'jira',
        statusLabel: 'To Do',
        labels: ['feature'],
        assignees: ['alice'],
      };

      const result = pmService.reconcileState({
        taskId: 'GW-TASK-1',
        graywolfStatus: 'HUMAN_REVIEW_GATE',
        externalIssue,
        incomingExternalUpdate: {
          attemptedStatusOverride: 'Done', // external user manually tried to close in Jira
          labels: ['feature', 'p1'],
          assignees: ['alice', 'bob'],
        },
      });

      // 1. Graywolf status remains authoritative
      expect(result.authoritativeGraywolfStatus).toBe('HUMAN_REVIEW_GATE');
      expect(result.externalOverrideIgnored).toBe(true);
      expect(result.syncedExternalStatusLabel).toBe('Awaiting Approval');

      // 2. External PM updates to labels and assignees ARE honored
      expect(result.authoritativeLabels).toEqual(['feature', 'p1']);
      expect(result.authoritativeAssignees).toEqual(['alice', 'bob']);
    });

    it('preserves existing labels and assignees if external update does not supply them', () => {
      const externalIssue: ExternalIssueState = {
        externalId: 'EXT-102',
        provider: 'github',
        statusLabel: 'Ready',
        labels: ['core', 'bug'],
        assignees: ['charlie'],
      };

      const result = pmService.reconcileState({
        taskId: 'GW-TASK-2',
        graywolfStatus: 'IN_PROGRESS',
        externalIssue,
      });

      expect(result.authoritativeGraywolfStatus).toBe('IN_PROGRESS');
      expect(result.syncedExternalStatusLabel).toBe('In Progress');
      expect(result.authoritativeLabels).toEqual(['core', 'bug']);
      expect(result.authoritativeAssignees).toEqual(['charlie']);
      expect(result.externalOverrideIgnored).toBe(false);
    });

    it('correctly maps Graywolf statuses across different PM providers', () => {
      // Jira vs GitHub/GitLab mappings
      expect(mapGraywolfStatusToExternalLabel('jira', 'QUEUED')).toBe('To Do');
      expect(mapGraywolfStatusToExternalLabel('github', 'QUEUED')).toBe('Ready');
      expect(mapGraywolfStatusToExternalLabel('gitlab', 'QUEUED')).toBe('Ready');

      expect(mapGraywolfStatusToExternalLabel('jira', 'MERGED')).toBe('Done');
      expect(mapGraywolfStatusToExternalLabel('linear', 'MERGED')).toBe('Done');
      expect(mapGraywolfStatusToExternalLabel('github', 'MERGED')).toBe('Closed');
      expect(mapGraywolfStatusToExternalLabel('gitlab', 'MERGED')).toBe('Closed');

      // Canonical 16-state mappings
      const testCases: Array<{ status: TaskStatus; expected: string }> = [
        { status: 'BACKLOG', expected: 'Backlog' },
        { status: 'IN_PROGRESS', expected: 'In Progress' },
        { status: 'INTERNAL_REVIEW', expected: 'Under Review' },
        { status: 'GUARD_VERIFYING', expected: 'QA Verifying' },
        { status: 'HUMAN_REVIEW_GATE', expected: 'Awaiting Approval' },
        { status: 'QA_FIXING', expected: 'QA Rework' },
        { status: 'AWAITING_CLARIFICATION', expected: 'Awaiting Clarification' },
        { status: 'ESCALATED', expected: 'Escalated' },
        { status: 'UPDATED', expected: 'Updated' },
        { status: 'CANCELLED', expected: 'Cancelled' },
        { status: 'BLOCKED', expected: 'Blocked' },
        { status: 'REJECTED', expected: 'Blocked' },
        { status: 'VERIFICATION_FAILED', expected: 'Blocked' },
        { status: 'INTERNAL_REVIEW_FAILED', expected: 'Blocked' },
      ];

      for (const { status, expected } of testCases) {
        expect(mapGraywolfStatusToExternalLabel('jira', status)).toBe(expected);
      }
    });
  });
});

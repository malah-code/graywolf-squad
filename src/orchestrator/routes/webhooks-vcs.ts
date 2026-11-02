import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import pino from 'pino';

import { VcsProviderType, RepoSdkClient } from '../delivery/repo-sdk';
import { runReactiveGuardSuite, RunReactiveGuardSuiteOptions } from '../guards/doc-guard';

const logger = pino({ name: 'vcs:webhook' });

/**
 * Inbound PR Review Comment Webhook Loop (Task 11.4a, PRD §8, §10.1, FR-004, SC-004).
 *
 * Receives webhook payloads from GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea.
 * Coalesces rapid sequential comments via `VcsWebhookDebouncer` (default: 500ms).
 * Awakes sandbox via ARP `review.feedback`, re-runs reactive quality guards,
 * and pushes the updated verified commit to the PR branch via `RepoSdkClient`.
 */

export interface InboundPrReviewComment {
  provider: VcsProviderType;
  taskId: string;
  prNumber: number;
  author: string;
  body: string;
  filePath?: string;
  line?: number;
}

export interface DebouncedCommentBatch {
  taskId: string;
  prNumber: number;
  provider: VcsProviderType;
  comments: InboundPrReviewComment[];
}

export class VcsWebhookDebouncer {
  private readonly debounceMs: number;
  private readonly onFlush: (batch: DebouncedCommentBatch) => Promise<void>;
  private readonly pending = new Map<
    string,
    {
      batch: DebouncedCommentBatch;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(options: {
    debounceMs?: number;
    onFlush: (batch: DebouncedCommentBatch) => Promise<void>;
  }) {
    this.debounceMs = options.debounceMs ?? 500;
    this.onFlush = options.onFlush;
  }

  private batchKey(taskId: string, prNumber: number): string {
    return `${taskId}:${prNumber}`;
  }

  public enqueue(comment: InboundPrReviewComment): void {
    const key = this.batchKey(comment.taskId, comment.prNumber);
    const existing = this.pending.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.batch.comments.push(comment);
      existing.timer = setTimeout(() => {
        void this.flushKey(key);
      }, this.debounceMs);
    } else {
      const batch: DebouncedCommentBatch = {
        taskId: comment.taskId,
        prNumber: comment.prNumber,
        provider: comment.provider,
        comments: [comment],
      };
      const timer = setTimeout(() => {
        void this.flushKey(key);
      }, this.debounceMs);
      this.pending.set(key, { batch, timer });
    }
  }

  public async flushNow(taskId?: string): Promise<void> {
    const keysToFlush = taskId
      ? [...this.pending.keys()].filter((k) => k.startsWith(`${taskId}:`))
      : [...this.pending.keys()];

    for (const key of keysToFlush) {
      await this.flushKey(key);
    }
  }

  private async flushKey(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    clearTimeout(entry.timer);
    try {
      await this.onFlush(entry.batch);
    } catch (err) {
      logger.error({ key, err }, 'Failed to process debounced VCS review feedback batch');
    }
  }
}

export interface HandleFeedbackOptions {
  batch: DebouncedCommentBatch;
  repoClient: RepoSdkClient;
  guardOptions: Omit<RunReactiveGuardSuiteOptions, 'taskId'>;
  branchName: string;
  commitSha: string;
  onArpFeedbackDispatched?: (event: {
    type: 'review.feedback';
    taskId: string;
    commentsCount: number;
  }) => Promise<void>;
}

export async function handleInboundPrReviewFeedback(
  options: HandleFeedbackOptions
): Promise<{
  guardVerdict: 'PASS' | 'FAIL';
  pushed: boolean;
  commentAckPosted: boolean;
}> {
  const { batch, repoClient, guardOptions, branchName, commitSha, onArpFeedbackDispatched } = options;

  // 1. Dispatch ARP review.feedback to awaken sandbox runtime
  await onArpFeedbackDispatched?.({
    type: 'review.feedback',
    taskId: batch.taskId,
    commentsCount: batch.comments.length,
  });

  // 2. Re-run reactive quality guards on the proposed rework patch
  const guardOutcome = await runReactiveGuardSuite({
    taskId: batch.taskId,
    ...guardOptions,
  });

  let pushed = false;
  let commentAckPosted = false;

  // 3. If guards pass, push the updated commit to the PR branch
  if (guardOutcome.overallVerdict === 'PASS') {
    const pushResult = await repoClient.pushTaskBranch(branchName, commitSha);
    pushed = pushResult.pushed;

    // Post comment acknowledging rework
    await repoClient.postPullRequestComment(
      batch.prNumber,
      `🤖 **Graywolf Squad**: Addressed ${batch.comments.length} review comment(s). Guards PASSED ✅ and commit \`${commitSha.slice(0, 7)}\` pushed to \`${branchName}\`.`
    );
    commentAckPosted = true;
  } else {
    // Post comment reporting guard failure
    await repoClient.postPullRequestComment(
      batch.prNumber,
      `⚠️ **Graywolf Squad**: Rework failed external QA verification (${guardOutcome.nextStatus}). Please review \`verification.md\`.`
    );
    commentAckPosted = true;
  }

  return {
    guardVerdict: guardOutcome.overallVerdict,
    pushed,
    commentAckPosted,
  };
}

export const SUPPORTED_VCS_PROVIDERS = new Set<VcsProviderType>([
  'github',
  'gitlab',
  'bitbucket',
  'azure',
  'gitea',
]);

export interface VcsWebhookRouteOptions {
  debouncer?: VcsWebhookDebouncer;
}

export const vcsWebhookRoutes: FastifyPluginAsync<VcsWebhookRouteOptions> = async (
  fastify: FastifyInstance,
  opts
): Promise<void> => {
  const defaultDebouncer =
    opts.debouncer ??
    new VcsWebhookDebouncer({
      onFlush: async (batch) => {
        logger.info(
          { taskId: batch.taskId, prNumber: batch.prNumber, count: batch.comments.length },
          'Flushed debounced PR review comment batch'
        );
      },
    });

  fastify.post('/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: VcsProviderType };

    if (!SUPPORTED_VCS_PROVIDERS.has(provider)) {
      return reply.status(400).send({
        error: `Unsupported VCS provider: ${provider}`,
        supported: Array.from(SUPPORTED_VCS_PROVIDERS),
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Multi-provider VCS comment and PR normalization (GitHub, GitLab, Bitbucket, Azure, Gitea)
    const commentObj = (body.object_attributes ?? body.comment ?? body.review_comment ?? body) as Record<string, unknown>;
    const prNumber = Number(
      body.number ??
      (body.pull_request as { number?: number })?.number ??
      (body.merge_request as { iid?: number; number?: number })?.iid ??
      (body.merge_request as { iid?: number; number?: number })?.number ??
      (body.issue as { number?: number })?.number ??
      (body.pullrequest as { id?: number })?.id ??
      1
    );

    const prTitle =
      (body.pull_request as { title?: string })?.title ??
      (body.merge_request as { title?: string })?.title ??
      (body.pullrequest as { title?: string })?.title ??
      '';

    const taskId = String(
      body.taskId ??
      commentObj.taskId ??
      prTitle.match(/\[([A-Z0-9_-]+)\]/)?.[1] ??
      'TASK-VCS-FEEDBACK'
    );

    const userObj = commentObj.user as { login?: string; username?: string; name?: string } | undefined;
    const author = String(
      userObj?.login ?? userObj?.username ?? userObj?.name ?? commentObj.author ?? 'reviewer'
    );
    const bodyText = String(commentObj.note ?? commentObj.body ?? '');

    const comment: InboundPrReviewComment = {
      provider,
      taskId,
      prNumber,
      author,
      body: bodyText,
      filePath: commentObj.path ? String(commentObj.path) : undefined,
      line: commentObj.line ? Number(commentObj.line) : undefined,
    };

    defaultDebouncer.enqueue(comment);

    return reply.status(202).send({
      received: true,
      queued: true,
      provider,
      taskId,
      prNumber,
    });
  });
};

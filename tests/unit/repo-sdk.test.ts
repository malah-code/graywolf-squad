import { describe, it, expect, vi } from 'vitest';

import {
  RepoSdkClient,
  VcsProviderType,
} from '../../src/orchestrator/delivery/repo-sdk';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

/**
 * Task 11.1 — Provider-Agnostic Git & VCS Abstraction (FR-001, SC-001).
 */

const PROVIDERS: VcsProviderType[] = ['github', 'gitlab', 'bitbucket', 'azure', 'gitea'];

describe('RepoSdkClient (US1, Task 11.1, FR-001)', () => {
  for (const provider of PROVIDERS) {
    describe(`Provider: ${provider}`, () => {
      const repoUrl = `https://${provider}.com/graywolf-squad/core-platform.git`;

      it(`clones repository to target directory`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const result = await client.cloneRepo('/tmp/worktree-1');
        expect(result.clonedTo).toBe('/tmp/worktree-1');
      });

      it(`pushes task branch with verified commit SHA`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const result = await client.pushTaskBranch('feat/task-101', 'a1b2c3d4e5f6');
        expect(result.pushed).toBe(true);
        expect(result.branch).toBe('feat/task-101');
        expect(result.commitSha).toBe('a1b2c3d4e5f6');
      });

      it(`creates a new pull request with provider-canonical URL`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const pr = await client.createOrUpdatePullRequest({
          sourceBranch: 'feat/task-101',
          targetBranch: 'main',
          title: 'Implement VCS delivery',
          bodyMarkdown: '## Executive Summary\nVerified PR.',
        });

        expect(pr.provider).toBe(provider);
        expect(pr.title).toBe('Implement VCS delivery');
        expect(pr.status).toBe('open');
        expect(pr.prNumber).toBeGreaterThan(0);
        expect(pr.url).toContain(repoUrl.replace('.git', ''));
      });

      it(`updates an existing pull request when existingPrNumber is provided`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const pr = await client.createOrUpdatePullRequest({
          sourceBranch: 'feat/task-101',
          targetBranch: 'main',
          title: 'Implement VCS delivery (v2)',
          bodyMarkdown: 'Updated PR body.',
          existingPrNumber: 42,
        });

        expect(pr.prNumber).toBe(42);
        expect(pr.title).toBe('Implement VCS delivery (v2)');
      });

      it(`posts comments on pull request`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const comment = await client.postPullRequestComment(42, 'Review bot signed off.');
        expect(comment.prNumber).toBe(42);
        expect(comment.commentId).toBeTruthy();
      });

      it(`merges pull request using specified merge method`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const merged = await client.mergePullRequest(42, 'squash');
        expect(merged.merged).toBe(true);
        expect(merged.prNumber).toBe(42);
        expect(merged.mergeCommitSha).toBeTruthy();
      });

      it(`registers inbound webhooks for PR and review events`, async () => {
        const client = new RepoSdkClient({ provider, repoUrl, credential: 'valid-token' });
        const hook = await client.registerWebhook('https://graywolf.internal/api/v1/webhooks/vcs');
        expect(hook.active).toBe(true);
        expect(hook.webhookId).toContain(provider);
      });
    });
  }

  describe('Error Mapping: GIT_REMOTE_AUTH_FAILED (FR-001, SC-001)', () => {
    it('maps 401 Unauthorized to GraywolfAppError("GIT_REMOTE_AUTH_FAILED")', async () => {
      const client = new RepoSdkClient({
        provider: 'github',
        repoUrl: 'https://github.com/org/repo.git',
        credential: 'INVALID_TOKEN',
      });

      await expect(client.cloneRepo('/tmp/x')).rejects.toThrow(GraywolfAppError);
      await expect(client.cloneRepo('/tmp/x')).rejects.toMatchObject({
        code: 'GIT_REMOTE_AUTH_FAILED',
      });
    });

    it('maps 403 Forbidden to GraywolfAppError("GIT_REMOTE_AUTH_FAILED")', async () => {
      const client = new RepoSdkClient({
        provider: 'gitlab',
        repoUrl: 'https://gitlab.com/org/repo.git',
        credential: 'EXPIRED_KEY',
      });

      await expect(client.pushTaskBranch('feat/test', 'abc')).rejects.toMatchObject({
        code: 'GIT_REMOTE_AUTH_FAILED',
      });
      await expect(client.mergePullRequest(123)).rejects.toMatchObject({
        code: 'GIT_REMOTE_AUTH_FAILED',
      });
    });

    it('allows custom adapter overrides while preserving error wrapping', async () => {
      const customPush = vi.fn().mockRejectedValue({ status: 401, message: 'Bad credentials' });
      const client = new RepoSdkClient({
        provider: 'bitbucket',
        repoUrl: 'https://bitbucket.org/org/repo.git',
        adapter: { pushTaskBranch: customPush },
      });

      await expect(client.pushTaskBranch('feat/x', '123')).rejects.toMatchObject({
        code: 'GIT_REMOTE_AUTH_FAILED',
      });
      expect(customPush).toHaveBeenCalled();
    });

    it('extracts owner and repository accurately from repoUrl', () => {
      const client = new RepoSdkClient({
        provider: 'azure',
        repoUrl: 'https://dev.azure.com/my-org/my-project/_git/my-repo.git',
      });
      const { owner, repo } = client.getOwnerAndRepo();
      expect(repo).toBe('my-repo');
      expect(owner).toBe('_git');
    });

    it('extracts owner and repository accurately from git SSH URL', () => {
      const client = new RepoSdkClient({
        provider: 'github',
        repoUrl: 'git@github.com:graywolf-squad/core-platform.git',
      });
      const { owner, repo } = client.getOwnerAndRepo();
      expect(owner).toBe('graywolf-squad');
      expect(repo).toBe('core-platform');
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  REDACTED_SECRET_REPLACEMENT,
  scrubSecretsFromText,
  createStreamingSecretScrubber,
} from '../../src/orchestrator/security/secret-scrubber';
import {
  buildSanitizedContainerEnv,
  SecretsBrokerProxy,
} from '../../src/orchestrator/security/secrets-proxy';

describe('Out-of-Band Secrets Proxy & Secret Scrubber (Task 16.2)', () => {
  it('buildSanitizedContainerEnv prevents raw secrets from leaking into container environment', () => {
    const rawEnv = {
      PATH: '/usr/local/bin:/usr/bin',
      NODE_ENV: 'test',
      GITHUB_TOKEN: 'ghp_secretTokenRawValue123456789012',
      STRIPE_SECRET_KEY: 'mock_sk_live_secretValueMustNotAppear',
      CUSTOM_API_KEY: 'sensitiveCustomApiKeyValue',
      SAFE_CONFIG_FLAG: 'true',
    };

    const sanitized = buildSanitizedContainerEnv({
      baseEnv: rawEnv,
      vaultSecretNames: ['CUSTOM_API_KEY'],
      vaultSecretValues: ['sensitiveCustomApiKeyValue', 'mock_sk_live_secretValueMustNotAppear'],
    });

    expect(sanitized.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(sanitized.NODE_ENV).toBe('test');
    expect(sanitized.SAFE_CONFIG_FLAG).toBe('true');

    // Ensure raw secrets are completely eliminated
    expect(sanitized.GITHUB_TOKEN).toBeUndefined();
    expect(sanitized.STRIPE_SECRET_KEY).toBeUndefined();
    expect(sanitized.CUSTOM_API_KEY).toBeUndefined();

    // Verify proxy endpoints are injected
    expect(sanitized.OPENAI_BASE_URL).toBe('http://litellm-proxy:4000');
    expect(sanitized.OPENAI_API_KEY).toBe('sk-graywolf-internal-proxy-token');
    expect(sanitized.GRAYWOLF_SECRETS_SOCKET).toBe('/var/run/graywolf/secrets.sock');
  });

  it('SecretsBrokerProxy issues scoped Git tokens with 300s TTL and rewrites outbound test requests', () => {
    const proxy = new SecretsBrokerProxy();
    const now = 1000000;

    // 1. Issue scoped Git token
    const grant = proxy.issueScopedGitToken({
      workspaceId: 'ws-alpha',
      taskId: 'TASK-100',
      repoPath: '/workspace/repo',
      nowMs: now,
      ttlSeconds: 300,
    });

    expect(grant.token).toMatch(/^gw_git_[0-9a-f]{32}$/);
    expect(grant.expiresAtMs).toBe(now + 300000);
    expect(grant.helperOutput).toContain('protocol=https');
    expect(grant.helperOutput).toContain(`password=${grant.token}`);

    // Verify token validity
    expect(proxy.verifyGitToken(grant.token, 'TASK-100', now + 1000).valid).toBe(true);
    expect(proxy.verifyGitToken(grant.token, 'TASK-WRONG', now + 1000).valid).toBe(false);
    expect(proxy.verifyGitToken(grant.token, 'TASK-100', now + 300001).valid).toBe(false);

    // 2. Outbound test request rewriting
    const secretsMap = {
      stripe_key: 'mock_sk_live_realStripeKeyForSandbox999',
    };

    const outbound = proxy.rewriteOutboundTestRequest({
      workspaceId: 'ws-alpha',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer sk_test_placeholder_stripe_key',
      },
      body: '{"charge": "sk_test_placeholder_stripe_key"}',
      secretsMap,
    });

    expect(outbound.headers.Authorization).toBe('Bearer mock_sk_live_realStripeKeyForSandbox999');
    expect(outbound.body).toBe('{"charge": "mock_sk_live_realStripeKeyForSandbox999"}');
    expect(outbound.injectedSecrets).toContain('mock_sk_live_realStripeKeyForSandbox999');

    // 3. Response scrubbing
    const inbound = proxy.scrubInboundTestResponse({
      headers: {
        'x-upstream-error': 'Error with key mock_sk_live_realStripeKeyForSandbox999',
      },
      body: 'Failed with secret mock_sk_live_realStripeKeyForSandbox999 in trace',
      injectedSecrets: outbound.injectedSecrets,
    });

    expect(inbound.headers['x-upstream-error']).toContain(REDACTED_SECRET_REPLACEMENT);
    expect(inbound.headers['x-upstream-error']).not.toContain('mock_sk_live_realStripeKeyForSandbox999');
    expect(inbound.body).toContain(REDACTED_SECRET_REPLACEMENT);
    expect(inbound.body).not.toContain('mock_sk_live_realStripeKeyForSandbox999');
  });

  it('scrubSecretsFromText and createStreamingSecretScrubber redact known patterns, vault literals and split chunks', () => {
    const rawLog = [
      'Auth failed with GitHub token ghp_111122223333444455556666777788889999',
      'OpenAI error with sk-1234567890abcdef1234567890',
      'Anthropic key sk-ant-1234567890abcdef123456',
      'AWS access key AKIAIOSFODNN7EXAMPLE detected',
      'Slack bot token xoxb-123456789012-abcdef123456',
      'Custom vault secret my-secret-passphrase-999 is leaking',
    ].join('\n');

    const res = scrubSecretsFromText(rawLog, ['my-secret-passphrase-999']);
    expect(res.redactionCount).toBeGreaterThanOrEqual(6);
    expect(res.scrubbedText).not.toContain('ghp_111122223333444455556666777788889999');
    expect(res.scrubbedText).not.toContain('sk-1234567890abcdef1234567890');
    expect(res.scrubbedText).not.toContain('sk-ant-1234567890abcdef123456');
    expect(res.scrubbedText).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(res.scrubbedText).not.toContain('xoxb-123456789012-abcdef123456');
    expect(res.scrubbedText).not.toContain('my-secret-passphrase-999');
    expect(res.scrubbedText).toContain(REDACTED_SECRET_REPLACEMENT);

    // Streaming scrubber: split token across chunk 1 and chunk 2
    const streaming = createStreamingSecretScrubber();
    const tokenPart1 = 'Connecting with token ghp_SplitTokenSecret11112222';
    const tokenPart2 = '33334444555566667777 and continue execution';

    const chunk1Res = streaming.pushChunk(tokenPart1);
    const chunk2Res = streaming.pushChunk(tokenPart2);
    const flushed = streaming.flush();

    const fullStreamOutput =
      chunk1Res.scrubbedChunk + chunk2Res.scrubbedChunk + flushed.scrubbedChunk;
    expect(fullStreamOutput).toContain(REDACTED_SECRET_REPLACEMENT);
    expect(fullStreamOutput).not.toContain('ghp_SplitTokenSecret1111222233334444555566667777');
  });
});


import * as crypto from 'node:crypto';
import { scrubSecretsFromText } from './secret-scrubber';

/**
 * Out-of-Band Secrets Proxy & Scoped Git Credential Socket Helper
 * (Task 16.2a, ADR-018, FR-003).
 *
 * Rules:
 * 1. Zero raw `secret_vault` credentials injected into container `process.env`.
 * 2. Scoped Git credential helper issues short-lived ephemeral tokens (TTL: 300 seconds).
 * 3. Outbound test requests substitute `sk_test_placeholder_<name>` in-flight, stripping secrets from responses.
 */

export interface ScopedGitTokenRecord {
  token: string;
  workspaceId: string;
  taskId: string;
  repoPath: string;
  expiresAtMs: number;
}

const FORBIDDEN_ENV_KEYS = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_PAT',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'STRIPE_SECRET_KEY',
  'STRIPE_TEST_KEY',
  'DATABASE_PASSWORD',
]);

/**
 * Builds a sanitized container environment map guaranteeing zero raw secrets are injected.
 */
export function buildSanitizedContainerEnv(input: {
  baseEnv?: Record<string, string>;
  vaultSecretNames?: string[];
  vaultSecretValues?: string[];
  litellmBaseUrl?: string;
  socketPath?: string;
}): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const blockedKeys = new Set<string>(FORBIDDEN_ENV_KEYS);
  if (input.vaultSecretNames) {
    for (const name of input.vaultSecretNames) {
      blockedKeys.add(name);
    }
  }

  const blockedValues = new Set<string>();
  if (input.vaultSecretValues) {
    for (const val of input.vaultSecretValues) {
      if (val && val.trim().length >= 6) {
        blockedValues.add(val.trim());
      }
    }
  }

  if (input.baseEnv) {
    for (const [k, v] of Object.entries(input.baseEnv)) {
      if (blockedKeys.has(k)) {
        continue;
      }
      if (blockedValues.has(v)) {
        continue;
      }
      // Check general regex for credential names
      if (/(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(k)) {
        continue;
      }
      sanitized[k] = v;
    }
  }

  // Inject out-of-band proxy endpoints
  sanitized.OPENAI_BASE_URL = input.litellmBaseUrl ?? 'http://litellm-proxy:4000';
  sanitized.OPENAI_API_KEY = 'sk-graywolf-internal-proxy-token';
  sanitized.GRAYWOLF_SECRETS_SOCKET =
    input.socketPath ?? '/var/run/graywolf/secrets.sock';

  return sanitized;
}

export class SecretsBrokerProxy {
  private readonly gitGrants = new Map<string, ScopedGitTokenRecord>();

  /**
   * Issues an ephemeral scoped Git credential token (TTL: 300 seconds) formatted for Git's credential.helper.
   */
  public issueScopedGitToken(input: {
    workspaceId: string;
    taskId: string;
    repoPath: string;
    nowMs?: number;
    ttlSeconds?: number;
  }): {
    token: string;
    expiresAtMs: number;
    helperOutput: string;
  } {
    const now = input.nowMs ?? Date.now();
    const ttlMs = (input.ttlSeconds ?? 300) * 1000;
    const expiresAtMs = now + ttlMs;

    const token = `gw_git_${crypto.randomBytes(16).toString('hex')}`;
    const grant: ScopedGitTokenRecord = {
      token,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      repoPath: input.repoPath,
      expiresAtMs,
    };

    this.gitGrants.set(token, grant);

    const helperOutput = [
      'protocol=https',
      'host=github.com',
      'username=x-access-token',
      `password=${token}`,
      '',
    ].join('\n');

    return { token, expiresAtMs, helperOutput };
  }

  /**
   * Validates an ephemeral Git credential token against an active task.
   */
  public verifyGitToken(
    token: string,
    taskId: string,
    nowMs?: number
  ): { valid: boolean; reason?: string } {
    const grant = this.gitGrants.get(token);
    if (!grant) {
      return { valid: false, reason: 'TOKEN_NOT_FOUND' };
    }
    const now = nowMs ?? Date.now();
    if (now > grant.expiresAtMs) {
      this.gitGrants.delete(token);
      return { valid: false, reason: 'TOKEN_EXPIRED' };
    }
    if (grant.taskId !== taskId) {
      return { valid: false, reason: 'TASK_ID_MISMATCH' };
    }
    return { valid: true };
  }

  /**
   * Rewrites an outbound third-party test HTTP request, substituting placeholder tokens with real secrets.
   */
  public rewriteOutboundTestRequest(input: {
    workspaceId: string;
    headers: Record<string, string>;
    body?: string;
    secretsMap: Record<string, string>;
  }): {
    headers: Record<string, string>;
    body?: string;
    injectedSecrets: string[];
  } {
    const headers = { ...input.headers };
    let body = input.body;
    const injectedSecrets: string[] = [];

    // 1. Check X-Graywolf-Secret-Placeholder header
    const placeholderHeader = headers['x-graywolf-secret-placeholder'] || headers['X-Graywolf-Secret-Placeholder'];
    if (placeholderHeader && input.secretsMap[placeholderHeader]) {
      const realSecret = input.secretsMap[placeholderHeader];
      headers['authorization'] = `Bearer ${realSecret}`;
      delete headers['x-graywolf-secret-placeholder'];
      delete headers['X-Graywolf-Secret-Placeholder'];
      injectedSecrets.push(realSecret);
    }

    // 2. Scan headers for sk_test_placeholder_<secret_name>
    for (const [k, v] of Object.entries(headers)) {
      const match = /sk_test_placeholder_([a-zA-Z0-9_-]+)/.exec(v);
      if (match) {
        const secretName = match[1];
        if (input.secretsMap[secretName]) {
          const realSecret = input.secretsMap[secretName];
          headers[k] = v.replace(match[0], realSecret);
          injectedSecrets.push(realSecret);
        }
      }
    }

    // 3. Scan body for placeholder substitutions
    if (body) {
      for (const [secretName, realVal] of Object.entries(input.secretsMap)) {
        const placeholder = `sk_test_placeholder_${secretName}`;
        if (body.includes(placeholder)) {
          body = body.split(placeholder).join(realVal);
          injectedSecrets.push(realVal);
        }
      }
    }

    return { headers, body, injectedSecrets };
  }

  /**
   * Scrubs injected secrets from inbound test HTTP response headers and bodies.
   */
  public scrubInboundTestResponse(input: {
    headers: Record<string, string>;
    body: string;
    injectedSecrets: string[];
  }): {
    headers: Record<string, string>;
    body: string;
  } {
    const scrubbedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.headers)) {
      const res = scrubSecretsFromText(v, input.injectedSecrets);
      scrubbedHeaders[k] = res.scrubbedText;
    }

    const bodyRes = scrubSecretsFromText(input.body, input.injectedSecrets);
    return { headers: scrubbedHeaders, body: bodyRes.scrubbedText };
  }
}


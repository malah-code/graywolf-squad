import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LocalFileKekProvider,
  EnvelopeSecretVault,
} from '../../src/orchestrator/security/kek-vault';
import {
  REDACTED_MCP_SECRET_VALUE,
  isSensitiveMcpKey,
  redactMcpConfigForUi,
  mergeMcpConfigOnUpdate,
  rehydrateMcpConfigForProbe,
} from '../../src/orchestrator/security/mcp-redaction';

describe('Zero-Prompt KEK, Envelope Encryption & ADR-055 MCP Redaction (Task 16.1)', () => {
  it('LocalFileKekProvider generates 32-byte master key with 0600 permissions and wraps/unwraps DEKs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-kek-test-'));
    const keyPath = path.join(tmpDir, 'master.key');

    try {
      const provider = new LocalFileKekProvider({ masterKeyPath: keyPath });
      const masterKey = await provider.ensureMasterKey();
      expect(masterKey).toHaveLength(32);

      const stats = await fs.stat(keyPath);
      expect(stats.mode & 0o777).toBe(0o600);

      // Re-read with broader mode initially to test chmod 0600 tightening
      await fs.chmod(keyPath, 0o644);
      const reProvider = new LocalFileKekProvider({ masterKeyPath: keyPath });
      await reProvider.ensureMasterKey();
      const tightenedStats = await fs.stat(keyPath);
      expect(tightenedStats.mode & 0o777).toBe(0o600);

      // Wrap a random 32-byte DEK
      const rawDek = Buffer.from('0123456789abcdef0123456789abcdef');
      const wrappedDek = await provider.wrapDek(rawDek);
      expect(wrappedDek).toHaveLength(61);
      expect(wrappedDek[0]).toBe(0x01); // Version byte

      // Unwrap DEK
      const unwrappedDek = await provider.unwrapDek(wrappedDek);
      expect(unwrappedDek).toEqual(rawDek);

      // Tampered wrapped DEK fails unwrap
      const tamperedWrapped = Buffer.from(wrappedDek);
      tamperedWrapped[35] ^= 0xff; // flip a bit in ciphertext
      await expect(provider.unwrapDek(tamperedWrapped)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('EnvelopeSecretVault encrypts, decrypts, and rejects tampered or cross-tenant ciphertext', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-vault-test-'));
    const keyPath = path.join(tmpDir, 'master.key');

    try {
      const kekProvider = new LocalFileKekProvider({ masterKeyPath: keyPath });
      const vault = new EnvelopeSecretVault({ kekProvider });

      const workspaceId = 'ws-test-111';
      const secretName = 'STRIPE_TEST_KEY';
      const secretValue = 'sk_test_51MzFakeStripeSecret1234567890';

      const { encryptedValue, encryptedDek } = await vault.encryptSecret(
        workspaceId,
        secretName,
        secretValue
      );
      expect(encryptedDek).toHaveLength(61);
      expect(encryptedValue[0]).toBe(0x01); // Version byte

      // Decrypt successfully
      const decrypted = await vault.decryptSecret(
        workspaceId,
        secretName,
        encryptedValue,
        encryptedDek
      );
      expect(decrypted).toBe(secretValue);

      // Cross-tenant tampering: attempt decrypting with different workspaceId fails closed
      await expect(
        vault.decryptSecret('ws-different-tenant', secretName, encryptedValue, encryptedDek)
      ).rejects.toThrow();

      // Tampered encrypted_value fails closed
      const tamperedValue = Buffer.from(encryptedValue);
      tamperedValue[tamperedValue.length - 1] ^= 0xff;
      await expect(
        vault.decryptSecret(workspaceId, secretName, tamperedValue, encryptedDek)
      ).rejects.toThrow();

      // Test setSecret, getSecret, listSecretValues in-memory store
      await vault.setSecret(workspaceId, 'GITHUB_PAT', 'ghp_sampleTokenSecretVal999');
      const pat = await vault.getSecret(workspaceId, 'GITHUB_PAT');
      expect(pat).toBe('ghp_sampleTokenSecretVal999');

      const listed = await vault.listSecretValues(workspaceId);
      expect(listed.GITHUB_PAT).toBe('ghp_sampleTokenSecretVal999');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('ADR-055 MCP Credential Redaction: masks UI values, preserves stored secrets on edit, and re-hydrates for probes', () => {
    expect(isSensitiveMcpKey('apiKey')).toBe(true);
    expect(isSensitiveMcpKey('token')).toBe(true);
    expect(isSensitiveMcpKey('endpointUrl')).toBe(false);
    expect(isSensitiveMcpKey('customField', 'headers.customField', ['headers.customField'])).toBe(
      true
    );

    const mcpConfig = {
      name: 'github-mcp',
      transport: 'sse',
      command_or_url: 'https://mcp.github.internal/sse',
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_realCleartextTokenABC123',
        REPO_SCOPE: 'org/repo',
      },
      headers: {
        Authorization: 'Bearer secretAuthToken999',
      },
    };

    // 1. Redact for UI presentation
    const uiConfig = redactMcpConfigForUi(mcpConfig);
    expect(uiConfig.command_or_url).toBe('https://mcp.github.internal/sse');
    expect(uiConfig.env.REPO_SCOPE).toBe('org/repo');
    expect(uiConfig.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(REDACTED_MCP_SECRET_VALUE);
    expect(uiConfig.headers.Authorization).toBe(REDACTED_MCP_SECRET_VALUE);

    // 2. User edits non-credential field in UI without touching "**********"
    const editedUiConfig = {
      ...uiConfig,
      command_or_url: 'https://mcp-updated.github.internal/sse',
    };
    const mergedConfig = mergeMcpConfigOnUpdate(mcpConfig, editedUiConfig);
    expect(mergedConfig.command_or_url).toBe('https://mcp-updated.github.internal/sse');
    expect(mergedConfig.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_realCleartextTokenABC123');
    expect(mergedConfig.headers.Authorization).toBe('Bearer secretAuthToken999');

    // 3. User provides a fresh secret in UI
    const freshlyUpdatedConfig = mergeMcpConfigOnUpdate(mcpConfig, {
      ...uiConfig,
      env: {
        ...uiConfig.env,
        GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_newFreshTokenXYZ789',
      },
    });
    expect(freshlyUpdatedConfig.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      'ghp_newFreshTokenXYZ789'
    );

    // 4. Server re-hydrates "**********" leaves in memory for connectivity probe
    const probeClone = rehydrateMcpConfigForProbe(uiConfig, {
      'env.GITHUB_PERSONAL_ACCESS_TOKEN': 'ghp_realCleartextTokenABC123',
      Authorization: 'Bearer secretAuthToken999',
    });
    expect(probeClone.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_realCleartextTokenABC123');
    expect(probeClone.headers.Authorization).toBe('Bearer secretAuthToken999');
    // Original UI config remains masked
    expect(uiConfig.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(REDACTED_MCP_SECRET_VALUE);
  });
});


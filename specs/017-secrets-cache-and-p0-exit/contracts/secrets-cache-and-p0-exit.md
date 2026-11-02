# Phase 16 Module Contracts: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

## 1. Zero-Prompt KEK & Envelope-Encrypted `secret_vault` (`src/orchestrator/security/kek-vault.ts`)

```ts
export interface KekProvider {
  readonly providerName: 'local-file' | 'vault' | 'aws-kms' | 'gcp-kms';
  wrapDek(dekPlaintext: Buffer): Promise<Buffer>;
  unwrapDek(encryptedDek: Buffer): Promise<Buffer>;
}

export class LocalFileKekProvider implements KekProvider {
  public readonly providerName = 'local-file' as const;
  constructor(options?: { masterKeyPath?: string });
  public ensureMasterKey(): Promise<Buffer>; // Generates 32-byte key at ~/.graywolf/master.key with 0600 mode
  public wrapDek(dekPlaintext: Buffer): Promise<Buffer>; // 61-byte [0x01][12B IV][16B Tag][32B Ciphertext]
  public unwrapDek(encryptedDek: Buffer): Promise<Buffer>;
}

export class EnvelopeSecretVault {
  constructor(options: { kekProvider: KekProvider });
  public encryptSecret(
    workspaceId: string,
    secretName: string,
    plaintextValue: string
  ): Promise<{ encryptedValue: Buffer; encryptedDek: Buffer }>;
  public decryptSecret(
    workspaceId: string,
    secretName: string,
    encryptedValue: Buffer,
    encryptedDek: Buffer
  ): Promise<string>;
  public setSecret(workspaceId: string, secretName: string, plaintextValue: string): Promise<void>;
  public getSecret(workspaceId: string, secretName: string): Promise<string | null>;
  public listSecretValues(workspaceId: string): Promise<Record<string, string>>;
}
```

## 2. ADR-055 MCP Credential Redaction (`src/orchestrator/security/mcp-redaction.ts`)

```ts
export const REDACTED_MCP_SECRET_VALUE = '**********';

export function isSensitiveMcpKey(keyName: string, keyPath: string, secretRefs?: string[]): boolean;
export function redactMcpConfigForUi<T extends Record<string, unknown>>(
  config: T,
  secretRefs?: string[]
): T;
export function mergeMcpConfigOnUpdate<T extends Record<string, unknown>>(
  existingCleartextOrVaultConfig: T,
  incomingUiConfig: T,
  secretRefs?: string[]
): T;
export function rehydrateMcpConfigForProbe<T extends Record<string, unknown>>(
  uiRedactedConfig: T,
  serverSecretsRecord: T,
  secretRefs?: string[]
): T;
```

## 3. Out-of-Band Secrets Proxy & Secret Scrubber (`src/orchestrator/security/secrets-proxy.ts`, `src/orchestrator/security/secret-scrubber.ts`)

```ts
export const REDACTED_SECRET_REPLACEMENT = '[REDACTED_SECRET_BY_GRAYWOLF]';

export function buildSanitizedContainerEnv(input: {
  baseEnv?: Record<string, string>;
  vaultSecretNames?: string[];
  vaultSecretValues?: string[];
  litellmBaseUrl?: string;
  socketPath?: string;
}): Record<string, string>;

export class SecretsBrokerProxy {
  public issueScopedGitToken(input: {
    workspaceId: string;
    taskId: string;
    repoPath: string;
    nowMs?: number;
  }): { token: string; expiresAtMs: number; helperOutput: string };

  public rewriteOutboundTestRequest(input: {
    workspaceId: string;
    headers: Record<string, string>;
    body?: string;
    secretsMap: Record<string, string>;
  }): { headers: Record<string, string>; body?: string; injectedSecrets: string[] };

  public scrubInboundTestResponse(input: {
    headers: Record<string, string>;
    body: string;
    injectedSecrets: string[];
  }): { headers: Record<string, string>; body: string };
}

export function scrubSecretsFromText(
  text: string,
  registeredVaultLiterals?: string[]
): { scrubbedText: string; redactionCount: number };

export function createStreamingSecretScrubber(registeredVaultLiterals?: string[]): {
  pushChunk(chunk: string): { scrubbedChunk: string; redactionCount: number };
  flush(): { scrubbedChunk: string; redactionCount: number };
};
```

## 4. Sub-2s Package Cache & OTLP Exporter (`src/orchestrator/runner/cache.ts`, `src/orchestrator/ServiceOtel.ts`)

```ts
export const TIER2_LOCKFILE_QUIESCENCE_MS = 10 * 60 * 1000; // 600,000 ms (10 minutes)

export function resolveTier1CacheMounts(
  projectId: string,
  ecosystems?: Array<'npm' | 'pnpm' | 'pip' | 'uv' | 'go' | 'cargo' | 'maven' | 'gradle' | 'nuget' | 'composer'>
): Array<{ volumeName: string; hostSubpath: string; containerTarget: string; readOnly: boolean }>;

export function assertValidCacheMounts(mounts: Array<{ containerTarget: string }>): void;

export class Tier2PreBakeScheduler {
  public recordLockfileChange(projectId: string, lockfilePath: string, nowMs?: number): void;
  public evaluateQuiescence(projectId: string, nowMs?: number): {
    readyToRebuild: boolean;
    remainingQuiescenceMs: number;
    dockerfileSnippet: string | null;
  };
}

export class ServiceOtel {
  constructor(options?: { enabled?: boolean; endpoint?: string; vaultLiterals?: string[] });
  public recordGenAiSpan(span: {
    taskId: string;
    tier: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    attributes?: Record<string, string>;
  }): { exported: boolean; externalEgressBytes: number; spanRecord: Record<string, unknown> };
}
```


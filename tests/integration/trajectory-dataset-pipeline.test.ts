import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createGlobalErrorHandler } from '../../src/orchestrator/errors/error-handler';
import { harvestEligibleTrajectory } from '../../src/orchestrator/learning/trajectory-harvester';
import { redactTrajectoryPrivacy } from '../../src/orchestrator/learning/dataset-manager';
import { datasetRoutes } from '../../src/orchestrator/routes/dataset';

describe('Phase 19 Task 19.2: Privacy Redaction Gate, Monthly Rotation & Dataset REST API Integration Suite (ADR-064, ADR-079, FR-004..FR-008, SC-003, SC-004)', () => {
  it('redacts workspace roots, secrets, DB URLs, git remotes, PEM keys, and sensitiveIdentifiers while preserving relative repository subpaths', () => {
    const rawSample = [
      'File edited: /workspace/graywolf-repo/src/orchestrator/index.ts',
      'Remote: https://ghp_1234567890abcdefghij@github.com/AcmeSecretCorp/private-repo.git',
      'Key: sk-proj-9876543210abcdefghij',
      'Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret',
      'DB: postgresql://admin:supersecret@db.internal:5432/core',
      'Client: AcmeSecretCorp internal API',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
    ].join('\n');

    const { scrubbedText, redactionCount } = redactTrajectoryPrivacy(rawSample, {
      workspaceRoot: '/workspace/graywolf-repo',
      sensitiveIdentifiers: ['AcmeSecretCorp'],
    });

    expect(redactionCount).toBeGreaterThanOrEqual(7);
    // Relative subpath preserved after <REDACTED_PATH>
    expect(scrubbedText).toContain('<REDACTED_PATH>/src/orchestrator/index.ts');
    expect(scrubbedText).not.toContain('/workspace/graywolf-repo');
    expect(scrubbedText).toContain('<REDACTED_GIT_REMOTE>');
    expect(scrubbedText).toContain('<REDACTED_SECRET>');
    expect(scrubbedText).toContain('Bearer <REDACTED_TOKEN>');
    expect(scrubbedText).toContain('<REDACTED_DB_URL>');
    expect(scrubbedText).toContain('<REDACTED_PROJECT>');
    expect(scrubbedText).toContain('<REDACTED_PRIVATE_KEY>');
    expect(scrubbedText).not.toContain('sk-proj-9876543210abcdefghij');
    expect(scrubbedText).not.toContain('supersecret');
    expect(scrubbedText).not.toContain('AcmeSecretCorp');
  });

  it('harvests trajectories across multiple months, enforces retention pruning, and serves stats & OpenAI/ShareGPT exports via REST endpoints', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-dataset-int-'));
    const app = Fastify();
    app.setErrorHandler(createGlobalErrorHandler());
    await app.register(datasetRoutes, { outputBaseDir: tmpDir });

    try {
      const config = {
        collect: true,
        protectTailTurns: 2,
        workspaceRoot: '/workspace/acme-app',
        sensitiveIdentifiers: ['AcmeVault'],
      };

      // Harvest 3 tasks across 2026-06, 2026-09, and 2026-11
      const months = [
        { taskId: 'TASK-JUNE-1', date: '2026-06-15T12:00:00.000Z' },
        { taskId: 'TASK-SEPT-1', date: '2026-09-15T12:00:00.000Z' },
        { taskId: 'TASK-NOV-1', date: '2026-11-01T12:00:00.000Z' },
      ];

      for (const item of months) {
        const res = await harvestEligibleTrajectory(
          {
            taskId: item.taskId,
            projectId: 'proj-dataset-1',
            workspaceId: 'ws-dataset-1',
            status: 'COMPLETED',
            strikes: 0,
            agreedP0P1Findings: 0,
            modelAlias: 'dev-level-3',
            systemPrompt: 'System prompt for AcmeVault',
            taskBrief: 'Update /workspace/acme-app/src/auth/login.ts',
            turns: [
              {
                role: 'assistant',
                content: 'Inspecting /workspace/acme-app/src/auth/login.ts with key sk-live-1234567890abcdef',
                toolCalls: [
                  {
                    id: 'call-1',
                    name: 'read_file',
                    arguments: '{"path":"/workspace/acme-app/src/auth/login.ts"}',
                  },
                ],
              },
              {
                role: 'tool',
                content: 'File content for AcmeVault',
                toolCallId: 'call-1',
              },
              {
                role: 'assistant',
                content: 'Middle turn 1',
              },
              {
                role: 'user',
                content: 'Middle turn 2',
              },
              {
                role: 'assistant',
                content: 'Final turn: patch verified',
              },
            ],
            completedAt: item.date,
          },
          config,
          { outputBaseDir: tmpDir, now: new Date(item.date) }
        );

        expect(res.harvested).toBe(true);
      }

      // 1. Check GET /api/v1/projects/:id/dataset/stats before pruning
      const statsRes1 = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-dataset-1/dataset/stats',
      });
      expect(statsRes1.statusCode).toBe(200);
      const stats1 = statsRes1.json();
      expect(stats1.totalTrajectories).toBe(3);
      expect(stats1.months.map((m: { month: string }) => m.month)).toEqual([
        '2026-06',
        '2026-09',
        '2026-11',
      ]);
      expect(stats1.totalRedactions).toBeGreaterThan(0);

      // 2. Prune directories older than 3 months relative to 2026-11 -> 2026-06 pruned, 2026-09 & 2026-11 kept
      const pruneRes = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/proj-dataset-1/dataset/prune',
        payload: {
          retentionMonths: 3,
          referenceDate: '2026-11-15T00:00:00.000Z',
        },
      });
      expect(pruneRes.statusCode).toBe(200);
      const pruneJson = pruneRes.json();
      expect(pruneJson.prunedMonths).toEqual(['2026-06']);
      expect(pruneJson.keptMonths).toEqual(['2026-09', '2026-11']);

      // 3. Export in OpenAI format
      const openAiExportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-dataset-1/dataset/export?format=openai',
      });
      expect(openAiExportRes.statusCode).toBe(200);
      const openAiExport = openAiExportRes.json();
      expect(openAiExport.count).toBe(2);
      expect(openAiExport.jsonl).toContain('<REDACTED_PATH>/src/auth/login.ts');
      expect(openAiExport.jsonl).toContain('<REDACTED_PROJECT>');
      expect(openAiExport.jsonl).not.toContain('AcmeVault');
      expect(openAiExport.jsonl).not.toContain('sk-live-1234567890abcdef');

      // 4. Export in ShareGPT format for month 2026-11
      const shareGptRes = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-dataset-1/dataset/export?format=sharegpt&month=2026-11',
      });
      expect(shareGptRes.statusCode).toBe(200);
      const shareGptExport = shareGptRes.json();
      expect(shareGptExport.count).toBe(1);
      const parsedShareGpt = JSON.parse(shareGptExport.jsonl.trim());
      expect(parsedShareGpt.conversations).toBeDefined();
      expect(parsedShareGpt.conversations[0].from).toBe('system');
      expect(parsedShareGpt.conversations[1].from).toBe('human');
      expect(parsedShareGpt.conversations[2].from).toBe('gpt');
      expect(parsedShareGpt.conversations[2].value).toContain('<tool_call>');

      // 5. Reject path-traversal or malformed month query -> 400 ACI_VALIDATION_FAILED
      const badMonthRes = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/proj-dataset-1/dataset/export?month=../../etc',
      });
      expect(badMonthRes.statusCode).toBe(400);
      expect(badMonthRes.json().code).toBe('ACI_VALIDATION_FAILED');
    } finally {
      await app.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});


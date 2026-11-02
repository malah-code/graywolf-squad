import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  compressConversationContext,
  type ConversationTurn,
} from '../../src/orchestrator/learning/compression';
import {
  scorePromptVariant,
  compilePromptVariants,
} from '../../scripts/prompts-compile';
import {
  scrubTrajectorySecrets,
  exportFineTuningTrajectory,
} from '../../src/orchestrator/learning/trajectory-export';

describe('80% Context Compressor, Prompt Compiler & Trajectory Exporter (Task 14.4, ADR-060, ADR-061, ADR-064, ADR-068)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graywolf-compression-trajectory-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function makeTurns(count: number): ConversationTurn[] {
    return Array.from({ length: count }, (_, idx) => ({
      role: idx % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Turn ${idx + 1} detailed content `.repeat(15),
      toolNames: idx % 2 === 1 ? ['read_file', 'run_command'] : [],
      turnIndex: idx + 1,
    }));
  }

  describe('80% Auxiliary Context Compressor (compressConversationContext)', () => {
    it('returns a safe no-op when turns.length <= 10 even if forceCompact is true', async () => {
      const turns = makeTurns(8);
      const res = await compressConversationContext({
        systemPrompt: 'Immutable System Prompt v1',
        taskBrief: 'Task Brief v1',
        turns,
        contextWindowTokens: 100,
        forceCompact: true,
      });

      expect(res.compressed).toBe(false);
      expect(res.reconstructedTurns).toHaveLength(8);
      expect(res.systemPromptHashPreserved).toBe(true);
    });

    it('compresses middle turns when token estimate exceeds 80% while keeping Protected Head (first 2) and Tail (last 8) byte-for-byte identical', async () => {
      const turns = makeTurns(16); // 2 head + 6 middle + 8 tail
      const res = await compressConversationContext({
        systemPrompt: 'Sacred System Prompt Prefix',
        taskBrief: 'Implement feature X',
        turns,
        contextWindowTokens: 200, // forces > 80% utilization
        auxiliarySummarizer: async (middle) =>
          `Auxiliary summary of ${middle.length} middle turns.`,
      });

      expect(res.compressed).toBe(true);
      expect(res.usedFallback).toBe(false);
      expect(res.systemPromptHashPreserved).toBe(true);
      expect(res.protectedHead.firstTurns).toEqual(turns.slice(0, 2));
      expect(res.protectedTail).toEqual(turns.slice(-8));
      expect(res.reconstructedTurns).toHaveLength(11); // 2 + 1 summary + 8
      expect(res.tokensAfter).toBeLessThan(res.tokensBefore);
    });

    it('falls back deterministically to tool call names + 200 chars/turn when auxiliary model fails', async () => {
      const turns = makeTurns(14); // 2 head + 4 middle + 8 tail
      const res = await compressConversationContext({
        systemPrompt: 'Sacred System Prompt Prefix',
        taskBrief: 'Implement feature Y',
        turns,
        contextWindowTokens: 200,
        auxiliarySummarizer: async () => {
          throw new Error('Auxiliary model timeout');
        },
      });

      expect(res.compressed).toBe(true);
      expect(res.usedFallback).toBe(true);
      expect(res.compressedMiddleSummary).toContain('[Compressed Middle Context (4 turns)]');
      expect(res.compressedMiddleSummary).toContain('tools: read_file, run_command');
      expect(res.systemPromptHashPreserved).toBe(true);
    });
  });

  describe('Prompt Compilation Harness (compilePromptVariants)', () => {
    it('scores candidate variants using 0.5*schema + 0.3*constraint + 0.2*tokenEfficiency and writes compiled artifact', async () => {
      const v1 = {
        variantId: 'v1-low',
        systemPromptTemplate: 'Baseline prompt',
        schemaCompliance: 0.8,
        constraintAdherence: 0.8,
        tokenEfficiency: 0.8,
      };
      const v2 = {
        variantId: 'v2-high',
        systemPromptTemplate: 'Optimized DSPy prompt',
        schemaCompliance: 1.0,
        constraintAdherence: 0.9,
        tokenEfficiency: 0.85,
      };

      expect(scorePromptVariant(v1)).toBe(0.8);
      expect(scorePromptVariant(v2)).toBe(0.94); // 0.5*1.0 + 0.3*0.9 + 0.2*0.85 = 0.5 + 0.27 + 0.17 = 0.94

      const compiled = await compilePromptVariants({
        alias: 'agent-planner',
        variants: [v1, v2],
        outputDir: tempDir,
      });

      expect(compiled.selectedVariantId).toBe('v2-high');
      expect(compiled.compositeScore).toBe(0.94);

      const savedRaw = await fs.readFile(
        path.join(tempDir, 'agent-planner.prompt.json'),
        'utf8'
      );
      const saved = JSON.parse(savedRaw);
      expect(saved.selectedVariantId).toBe('v2-high');
    });
  });

  describe('Opt-In Trajectory Exporter (exportFineTuningTrajectory)', () => {
    it('does not export when dataset.collect is false or when task incurred strikes', async () => {
      const disabledRes = await exportFineTuningTrajectory({
        taskId: 'TASK-EXP-1',
        modelAlias: 'agent-coder',
        datasetCollectEnabled: false,
        strikes: 0,
        agreedHighSeverityFindings: 0,
        systemPrompt: 'System',
        taskBrief: 'Brief',
        turns: makeTurns(4),
        outputBaseDir: tempDir,
      });
      expect(disabledRes.exported).toBe(false);
      expect(disabledRes.filePath).toBeNull();

      const strikeRes = await exportFineTuningTrajectory({
        taskId: 'TASK-EXP-2',
        modelAlias: 'agent-coder',
        datasetCollectEnabled: true,
        strikes: 1,
        agreedHighSeverityFindings: 0,
        systemPrompt: 'System',
        taskBrief: 'Brief',
        turns: makeTurns(4),
        outputBaseDir: tempDir,
      });
      expect(strikeRes.exported).toBe(false);
      expect(strikeRes.filePath).toBeNull();
    });

    it('scrubs API keys, Bearer tokens, DB URLs, and sensitive project names and writes OpenAI JSONL on 0-strike tasks', async () => {
      const turns: ConversationTurn[] = [
        {
          role: 'user',
          content:
            'Connect to postgres://admin:supersecret@db.internal:5432/prod for ProjectWolfCorp using OPENAI_API_KEY=sk-1234567890abcdef123456',
        },
        {
          role: 'assistant',
          content:
            'Configured Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret for ProjectWolfCorp.',
        },
      ];

      const scrubCheck = scrubTrajectorySecrets(
        `${turns[0].content} and import from '@wolfcorp/internal-auth'`,
        ['ProjectWolfCorp', '@wolfcorp/internal-auth']
      );
      expect(scrubCheck.scrubbedText).toContain('<REDACTED_DB_URL>');
      expect(scrubCheck.scrubbedText).toContain('<REDACTED_SECRET>');
      expect(scrubCheck.scrubbedText).toContain('<REDACTED_PROJECT>');
      expect(scrubCheck.scrubbedText).not.toContain('supersecret');
      expect(scrubCheck.scrubbedText).not.toContain('ProjectWolfCorp');
      expect(scrubCheck.scrubbedText).not.toContain('@wolfcorp/internal-auth');

      const exportRes = await exportFineTuningTrajectory({
        taskId: 'TASK-EXP-3',
        modelAlias: 'agent-coder',
        datasetCollectEnabled: true,
        strikes: 0,
        agreedHighSeverityFindings: 0,
        systemPrompt: 'System prompt for ProjectWolfCorp',
        taskBrief: 'Fix auth header',
        turns,
        sensitiveIdentifiers: ['ProjectWolfCorp'],
        outputBaseDir: tempDir,
        now: new Date('2026-11-01T12:00:00.000Z'),
      });

      expect(exportRes.exported).toBe(true);
      expect(exportRes.filePath).toBe(
        path.join(tempDir, '2026-11', 'TASK-EXP-3.jsonl')
      );

      const jsonlRaw = await fs.readFile(exportRes.filePath!, 'utf8');
      expect(jsonlRaw).not.toContain('sk-1234567890abcdef123456');
      expect(jsonlRaw).not.toContain('supersecret');
      expect(jsonlRaw).not.toContain('ProjectWolfCorp');
      expect(jsonlRaw).toContain('<REDACTED_PROJECT>');
      expect(jsonlRaw).toContain('Bearer <REDACTED_TOKEN>');
    });
  });
});


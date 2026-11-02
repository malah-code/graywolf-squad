import { describe, it, expect } from 'vitest';
import {
  DelegateRelayResultSchema,
  validateRelayResult,
} from '../../src/orchestrator/schemas/relay-result';
import {
  ProjectConfigSchema,
  validateProjectConfig,
} from '../../src/orchestrator/schemas/project-config';
import { GraywolfAppError } from '../../src/orchestrator/errors/taxonomy';

describe('JSON Contracts Validation (relay-result.json & project.config.json)', () => {
  describe('delegate-relay.result.v1 schema validation', () => {
    const validRelayResult = {
      version: 'delegate-relay.result.v1',
      taskId: 'TASK-402-AUTH-MIDDLEWARE',
      status: 'completed',
      exitCode: 0,
      signal: null,
      metrics: {
        durationMs: 4250.5,
        peakMemoryBytes: 256000000,
      },
      touchedFiles: ['src/middleware/auth.ts', 'tests/middleware/auth.test.ts'],
      agentReport: {
        summary: 'Successfully implemented JWT middleware with revocation checks.',
        divergenceNotes: 'None.',
      },
      sessionRef: 'sess_123456789',
    };

    it('validates a conforming result.json payload', () => {
      expect(DelegateRelayResultSchema).toBeDefined();
      const validated = validateRelayResult(validRelayResult);
      expect(validated.version).toBe('delegate-relay.result.v1');
      expect(validated.taskId).toBe('TASK-402-AUTH-MIDDLEWARE');
      expect(validated.status).toBe('completed');
      expect(validated.exitCode).toBe(0);
      expect(validated.metrics.durationMs).toBe(4250.5);
    });

    it('rejects payload with invalid version or invalid status', () => {
      const invalidVersion = { ...validRelayResult, version: 'delegate-relay.result.v2' };
      expect(() => validateRelayResult(invalidVersion)).toThrow(GraywolfAppError);

      const invalidStatus = { ...validRelayResult, status: 'unknown_status' };
      expect(() => validateRelayResult(invalidStatus)).toThrow(GraywolfAppError);
    });

    it('rejects payload with invalid taskId format or negative metrics', () => {
      const invalidTaskId = { ...validRelayResult, taskId: 'invalid-task-id' };
      expect(() => validateRelayResult(invalidTaskId)).toThrow(GraywolfAppError);

      const negativeDuration = {
        ...validRelayResult,
        metrics: { durationMs: -10, peakMemoryBytes: 100 },
      };
      expect(() => validateRelayResult(negativeDuration)).toThrow(GraywolfAppError);
    });
  });

  describe('project.config.json schema validation', () => {
    const validProjectConfig = {
      projectId: 'graywolf-accounting-tax-module',
      mode: 'brownfield',
      sourceControl: {
        provider: 'gitlab',
        repoUrl: 'https://gitlab.example.com/acme/accounting-app.git',
        credentialRef: 'vault:gitlab_pat',
      },
      blastRadius: {
        writable: ['src/modules/tax/**', 'tests/modules/tax/**'],
        readonly: ['src/database/models/**', 'src/shared/**'],
        forbidden: ['src/core/auth/**', '.gitlab-ci.yml', 'src/billing/**'],
      },
      modelRouting: {
        devLevel1: { alias: 'agent-planner', fallback: 'agent-planner-fallback' },
        devLevel2: { alias: 'agent-reviewer', fallback: 'agent-reviewer-fallback' },
        devLevel3: { alias: 'agent-coder', fallback: 'agent-coder-fallback' },
      },
      taskTags: {
        simplebugs: { skipPlanning: true },
        'schema-changes': { requireHumanPlanApproval: true },
      },
      limits: {
        maxConcurrentContainers: 3,
        dailySpendCapUSD: 20.0,
        qaMaxRetries: 3,
        internalReviewMaxAttempts: 2,
        maxAutonomousRevisionsPerTask: 5,
        webhookDebounceMs: 180000,
      },
      skillImports: ['bmad-personas', 'security-audit'],
      locale: 'ar',
      ui: { persona: 'developer' },
      gatePolicy: {
        default: 'human',
        byTaskTag: {
          'simple-bugfix': 'auto',
          feature: 'ai-pm',
          'schema-change': 'mandatory-human',
          security: 'mandatory-human',
        },
        confidenceThreshold: 0.85,
        fallbackToFrontier: true,
      },
      aiReviewer: {
        persona: 'Product Manager',
        modelAlias: 'agent-reviewer',
        systemPrompt: 'You are a senior product manager reviewing code changes...',
        strictnessLevel: 'medium',
        canEscalateToHuman: true,
        autoApproveThreshold: 0.9,
      },
      cliSubscriptionAuth: {
        enabled: true,
        provider: 'claude-code',
        lanes: {
          feature: { provider: 'claude-cli', credentialKey: 'CLAUDE_CLI_SESSION' },
          tests: { provider: 'codex-cli', credentialKey: 'CODEX_CLI_SESSION' },
        },
      },
      addons: {
        maxSignalAddons: 3,
        maxCockpitAddons: 1,
        installed: [
          {
            package: '@graywolf/addon-discord',
            type: 'cockpit',
            tier: 'official',
            shadowState: 'graduated',
          },
        ],
      },
    };

    it('validates a rich project.config.json with PRD extensions and addon manifest', () => {
      expect(ProjectConfigSchema).toBeDefined();
      const validated = validateProjectConfig(validProjectConfig);
      expect(validated.projectId).toBe('graywolf-accounting-tax-module');
      expect(validated.mode).toBe('brownfield');
      expect(validated.locale).toBe('ar');
      expect(validated.ui?.persona).toBe('developer');
      expect(validated.gatePolicy?.default).toBe('human');
      expect(validated.gatePolicy?.byTaskTag?.['schema-change']).toBe('mandatory-human');
      expect(validated.gatePolicy?.confidenceThreshold).toBe(0.85);
      expect(validated.aiReviewer?.modelAlias).toBe('agent-reviewer');
      expect(validated.cliSubscriptionAuth?.lanes?.feature.provider).toBe('claude-cli');
      expect(validated.addons?.installed[0].package).toBe('@graywolf/addon-discord');
    });

    it('rejects project config with invalid mode or out-of-bounds limits', () => {
      const invalidMode = { ...validProjectConfig, mode: 'invalid_mode' };
      expect(() => validateProjectConfig(invalidMode)).toThrow(GraywolfAppError);

      const invalidLimits = {
        ...validProjectConfig,
        limits: { ...validProjectConfig.limits, maxConcurrentContainers: 0 },
      };
      expect(() => validateProjectConfig(invalidLimits)).toThrow(GraywolfAppError);
    });

    it('rejects invalid addon installed configuration', () => {
      const invalidAddon = {
        ...validProjectConfig,
        addons: {
          installed: [
            {
              package: '',
              type: 'invalid_type',
              tier: 'official',
              shadowState: 'shadow',
            },
          ],
        },
      };
      expect(() => validateProjectConfig(invalidAddon)).toThrow(GraywolfAppError);
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  executeAuthorizedToolCall,
  UserContext,
} from '../../src/orchestrator/aci/validate';

describe('ADR-066 Agent-Computer Interface (ACI) Validation Gateway Tests', () => {
  const viewerContext: UserContext = {
    userId: 'usr-viewer-1',
    workspaceId: 'ws-alpha-111',
    role: 'viewer',
  };

  const devContext: UserContext = {
    userId: 'usr-dev-2',
    workspaceId: 'ws-alpha-111',
    role: 'developer',
  };

  const leadDevContext: UserContext = {
    userId: 'usr-lead-3',
    workspaceId: 'ws-alpha-111',
    role: 'lead_dev',
  };

  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  describe('Schema Validation Gateway (TypeBox)', () => {
    it('returns ACI_VALIDATION_FAILED for unknown tool names', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'non_existent_tool', {});
      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED: Unknown tool');
    });

    it('rejects create_task with missing required title and invalid priority', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'create_task', {
        projectId: validUuid,
        briefMarkdown: 'Implement caching layer',
        priority: 'ULTRA_HIGH', // Invalid priority enum
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED: Schema validation failed');
      expect(res.validationErrors).toBeDefined();
      expect(res.validationErrors!.length).toBeGreaterThan(0);
    });

    it('rejects reorder_backlog with empty orderedTaskIds array', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'reorder_backlog', {
        projectId: validUuid,
        orderedTaskIds: [], // minItems: 1 violation
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED');
      expect(res.validationErrors).toBeDefined();
    });

    it('rejects update_blocked_by with invalid taskId format', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'update_blocked_by', {
        taskId: 'invalid-id-without-prefix',
        blockedBy: ['TASK-1'],
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED');
    });

    it('rejects pause_container with invalid taskId format', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'pause_container', {
        taskId: 'bad_id',
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED');
    });

    it('rejects cancel_task with extra unexpected properties', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'cancel_task', {
        taskId: 'TASK-123',
        unexpectedProp: 12345, // additionalProperties: false
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED');
    });

    it('rejects modify_blast_radius when projectId is not a valid UUID', async () => {
      const res = await executeAuthorizedToolCall(leadDevContext, 'modify_blast_radius', {
        projectId: 'not-a-uuid',
        writable: ['src/'],
      });

      expect(res.executed).toBe(false);
      expect(res.error).toContain('ACI_VALIDATION_FAILED');
    });
  });

  describe('Casbin Server-Authoritative RBAC Enforcement', () => {
    it('denies create_task for viewer role with RBAC_COCKPIT_TOOL_FORBIDDEN', async () => {
      const res = await executeAuthorizedToolCall(viewerContext, 'create_task', {
        projectId: validUuid,
        title: 'Viewer unauthorized task',
        briefMarkdown: 'Should be rejected',
      });

      expect(res.authorized).toBe(false);
      expect(res.executed).toBe(false);
      expect(res.error).toBe('RBAC_COCKPIT_TOOL_FORBIDDEN');
    });

    it('denies approve_pr_merge for developer role (requires lead_dev or owner)', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'approve_pr_merge', {
        taskId: 'TASK-456',
        comment: 'Developer trying to approve their own PR',
      });

      expect(res.authorized).toBe(false);
      expect(res.executed).toBe(false);
      expect(res.error).toBe('RBAC_COCKPIT_TOOL_FORBIDDEN');
    });

    it('denies modify_blast_radius for developer role (requires lead_dev or owner)', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'modify_blast_radius', {
        projectId: validUuid,
        writable: ['src/core/'],
      });

      expect(res.authorized).toBe(false);
      expect(res.executed).toBe(false);
      expect(res.error).toBe('RBAC_COCKPIT_TOOL_FORBIDDEN');
    });
  });

  describe('Authorized Tool Execution & Custom Handlers', () => {
    it('executes create_task for developer with valid args', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'create_task', {
        projectId: validUuid,
        title: 'Implement token bucket rate limiter',
        briefMarkdown: 'Use Valkey sliding window algorithm',
        priority: 'HIGH',
      });

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result).toBeDefined();
      expect(res.result!.title).toBe('Implement token bucket rate limiter');
      expect(res.result!.status).toBe('BACKLOG');
    });

    it('executes reorder_backlog for developer with valid ordered task IDs', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'reorder_backlog', {
        projectId: validUuid,
        orderedTaskIds: ['TASK-3', 'TASK-1', 'TASK-2'],
      });

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result!.reordered).toBe(true);
    });

    it('executes update_blocked_by for developer and rejects self-cycle', async () => {
      const res = await executeAuthorizedToolCall(devContext, 'update_blocked_by', {
        taskId: 'TASK-5',
        blockedBy: ['TASK-1', 'TASK-2'],
      });

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result!.updated).toBe(true);

      const cycleRes = await executeAuthorizedToolCall(devContext, 'update_blocked_by', {
        taskId: 'TASK-5',
        blockedBy: ['TASK-5'],
      });
      expect(cycleRes.executed).toBe(false);
      expect(cycleRes.error).toContain('Circular dependency detected');
    });

    it('executes pause_container and cancel_task for developer', async () => {
      const pauseRes = await executeAuthorizedToolCall(devContext, 'pause_container', {
        taskId: 'TASK-10',
        reason: 'Budget limit check',
      });

      expect(pauseRes.authorized).toBe(true);
      expect(pauseRes.executed).toBe(true);
      expect(pauseRes.result!.paused).toBe(true);

      const cancelRes = await executeAuthorizedToolCall(devContext, 'cancel_task', {
        taskId: 'TASK-10',
        reason: 'Panic button pressed',
      });

      expect(cancelRes.authorized).toBe(true);
      expect(cancelRes.executed).toBe(true);
      expect(cancelRes.result!.cancelled).toBe(true);
    });

    it('executes approve_pr_merge for lead_dev', async () => {
      const res = await executeAuthorizedToolCall(leadDevContext, 'approve_pr_merge', {
        taskId: 'TASK-789',
        comment: 'Code review looks pristine',
      });

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result!.merged).toBe(true);
      expect(res.result!.prUrl).toBeDefined();
    });

    it('executes modify_blast_radius for lead_dev', async () => {
      const res = await executeAuthorizedToolCall(leadDevContext, 'modify_blast_radius', {
        projectId: validUuid,
        writable: ['src/orchestrator/'],
        readonly: ['package.json'],
        forbidden: ['.env*'],
      });

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result!.updated).toBe(true);
    });

    it('supports custom handler overrides', async () => {
      const customCreateTask = async (args: unknown) => {
        return { custom: true, input: args };
      };

      const res = await executeAuthorizedToolCall(
        devContext,
        'create_task',
        {
          projectId: validUuid,
          title: 'Custom task test',
          briefMarkdown: 'Custom markdown',
        },
        { create_task: customCreateTask }
      );

      expect(res.authorized).toBe(true);
      expect(res.executed).toBe(true);
      expect(res.result!.custom).toBe(true);
    });

    it('executes handler inside withTenantContext with user workspaceId and orgId', async () => {
      const dbModule = await import('../../src/orchestrator/db');
      const mockClient = {} as import('pg').PoolClient;
      const withTenantSpy = vi
        .spyOn(dbModule, 'withTenantContext')
        .mockImplementationOnce(async (ctx, fn) => {
          expect(ctx.workspaceId).toBe(devContext.workspaceId);
          expect(ctx.orgId).toBe('org-test-123');
          return fn(mockClient);
        });

      const res = await executeAuthorizedToolCall(
        { ...devContext, orgId: 'org-test-123' },
        'pause_container',
        { taskId: 'TASK-777', reason: 'Inspecting state' },
        {
          pause_container: async (args, _ctx, client) => ({
            paused: true,
            hasDbClient: client === mockClient,
            ...(args as Record<string, unknown>),
          }),
        }
      );

      expect(withTenantSpy).toHaveBeenCalledTimes(1);
      expect(res.executed).toBe(true);
      expect(res.authorized).toBe(true);
      expect(res.result?.hasDbClient).toBe(true);

      withTenantSpy.mockRestore();
    });
  });
});

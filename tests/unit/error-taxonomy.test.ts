import { describe, it, expect, vi } from 'vitest';
import {
  ERROR_CODES,
  ERROR_METADATA_MAP,
  ErrorCode,
  GraywolfAppError,
} from '../../src/orchestrator/errors/taxonomy';
import { createGlobalErrorHandler } from '../../src/orchestrator/errors/error-handler';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface SerializedErrorResponse {
  code: string;
  message: string;
  details: Record<string, unknown>;
  retryable: boolean;
  timestamp: string;
}

describe('Error Taxonomy & Metadata (ADR-042)', () => {
  it('contains all 48 canonical error codes with complete metadata', () => {
    expect(ERROR_CODES.length).toBe(48);

    for (const code of ERROR_CODES) {
      const meta = ERROR_METADATA_MAP[code as ErrorCode];
      expect(meta).toBeDefined();
      if (code === 'GATE_LOW_CONFIDENCE_FALLBACK') {
        expect(meta.httpStatus).toBe(200);
      } else {
        expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
        expect(meta.httpStatus).toBeLessThan(600);
      }
      expect(typeof meta.retryable).toBe('boolean');
      expect(meta.defaultMessage).toBeDefined();
      expect(meta.defaultMessage.length).toBeGreaterThan(0);
    }
  });

  it('correctly maps specific domain error codes', () => {
    // Auth & RBAC
    expect(ERROR_METADATA_MAP.AUTH_SESSION_MISSING.httpStatus).toBe(401);
    expect(ERROR_METADATA_MAP.AUTH_SESSION_MISSING.retryable).toBe(false);

    expect(ERROR_METADATA_MAP.RBAC_COCKPIT_TOOL_FORBIDDEN.httpStatus).toBe(403);
    expect(ERROR_METADATA_MAP.RBAC_CROSS_TENANT_VIOLATION.httpStatus).toBe(403);

    // Sandbox & Docker
    expect(ERROR_METADATA_MAP.SANDBOX_OOM_KILLED.httpStatus).toBe(500);
    expect(ERROR_METADATA_MAP.SANDBOX_OOM_KILLED.retryable).toBe(false);

    // Relay Engine
    expect(ERROR_METADATA_MAP.RELAY_BLAST_RADIUS_VIOLATION.httpStatus).toBe(422);
    expect(ERROR_METADATA_MAP.RELAY_BLAST_RADIUS_VIOLATION.exitCode).toBe(2);
    expect(ERROR_METADATA_MAP.RELAY_BLAST_RADIUS_VIOLATION.retryable).toBe(false);
    expect(ERROR_METADATA_MAP.RELAY_INTERNAL_REVIEW_TWO_STRIKES.httpStatus).toBe(422);
    expect(ERROR_METADATA_MAP.RELAY_INTERNAL_REVIEW_TWO_STRIKES.exitCode).toBe(0);

    // LLM Gateway
    expect(ERROR_METADATA_MAP.LLM_PROVIDER_RATE_LIMITED.httpStatus).toBe(429);
    expect(ERROR_METADATA_MAP.LLM_PROVIDER_RATE_LIMITED.retryable).toBe(true);

    // Git Engine
    expect(ERROR_METADATA_MAP.GIT_REMOTE_AUTH_FAILED.httpStatus).toBe(401);
    expect(ERROR_METADATA_MAP.GIT_WORKTREE_COLLISION.httpStatus).toBe(409);
    expect(ERROR_METADATA_MAP.GIT_PATCH_APPLICATION_FAILED.httpStatus).toBe(422);

    // System Fallbacks
    expect(ERROR_METADATA_MAP.ACI_VALIDATION_FAILED.httpStatus).toBe(400);
    expect(ERROR_METADATA_MAP.ACI_VALIDATION_FAILED.retryable).toBe(true);
    expect(ERROR_METADATA_MAP.INTERNAL_SERVER_ERROR.httpStatus).toBe(500);
    expect(ERROR_METADATA_MAP.INTERNAL_SERVER_ERROR.retryable).toBe(false);
  });

  it('instantiates GraywolfAppError with proper fields and serialization', () => {
    const error = new GraywolfAppError(
      'RBAC_MERGE_NOT_AUTHORIZED',
      'User cannot approve PR merge',
      { userId: 'usr_123' }
    );

    expect(error.code).toBe('RBAC_MERGE_NOT_AUTHORIZED');
    expect(error.httpStatus).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ userId: 'usr_123' });
    expect(error.timestamp).toBeDefined();

    const json = error.toJSON();
    expect(json.code).toBe('RBAC_MERGE_NOT_AUTHORIZED');
    expect(json.retryable).toBe(false);
    expect(json.details?.userId).toBe('usr_123');
  });

  it('global error handler properly serializes GraywolfAppError', () => {
    const handler = createGlobalErrorHandler();
    const error = new GraywolfAppError('TASK_NOT_FOUND', 'Custom message', { taskId: 'T-100' });

    let sentStatus = 0;
    let sentBody = {} as SerializedErrorResponse;

    const mockReply = {
      status(code: number) {
        sentStatus = code;
        return this;
      },
      send(body: unknown) {
        sentBody = body as SerializedErrorResponse;
        return this;
      },
    } as unknown as FastifyReply;

    const mockRequest = {
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as FastifyRequest;

    handler(error, mockRequest, mockReply);

    expect(sentStatus).toBe(404);
    expect(sentBody.code).toBe('TASK_NOT_FOUND');
    expect(sentBody.message).toBe('Custom message');
    expect(sentBody.details).toEqual({ taskId: 'T-100' });
    expect(sentBody.retryable).toBe(false);
    expect(sentBody.timestamp).toBeDefined();
  });

  it('global error handler intercepts Fastify validation errors as ACI_VALIDATION_FAILED', () => {
    const handler = createGlobalErrorHandler();
    const validationError = Object.assign(new Error('body/title is required'), {
      validation: [{ keyword: 'required', params: { missingProperty: 'title' } }],
    });

    let sentStatus = 0;
    let sentBody = {} as SerializedErrorResponse;

    const mockReply = {
      status(code: number) {
        sentStatus = code;
        return this;
      },
      send(body: unknown) {
        sentBody = body as SerializedErrorResponse;
        return this;
      },
    } as unknown as FastifyReply;

    const mockRequest = {
      log: {
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as FastifyRequest;

    handler(validationError, mockRequest, mockReply);

    expect(sentStatus).toBe(400);
    expect(sentBody.code).toBe('ACI_VALIDATION_FAILED');
    expect(sentBody.retryable).toBe(true);
    expect(sentBody.timestamp).toBeDefined();
  });
});

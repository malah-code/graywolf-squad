import { Type, Static } from '@sinclair/typebox';

export const ERROR_CODES = [
  // 2.1 Authentication & Session (AUTH_*)
  'AUTH_SESSION_MISSING',
  'AUTH_SESSION_EXPIRED',
  'AUTH_SESSION_REVOKED',
  'AUTH_INVITE_INVALID',
  'AUTH_INVITE_EXPIRED',
  'AUTH_INVITE_EXHAUSTED',
  'AUTH_TGT_EXPIRED',
  'AUTH_TGT_ALREADY_USED',

  // 2.2 Authorization & RBAC (RBAC_*)
  'RBAC_INSUFFICIENT_ROLE',
  'RBAC_MERGE_NOT_AUTHORIZED',
  'RBAC_KEY_MANAGEMENT_DENIED',
  'RBAC_COCKPIT_TOOL_FORBIDDEN',
  'RBAC_CROSS_TENANT_VIOLATION',

  // 2.3 Task Lifecycle & Concurrency (TASK_*)
  'TASK_NOT_FOUND',
  'TASK_INVALID_STATE_TRANSITION',
  'TASK_BLOCKED_BY_DEPENDENCIES',
  'TASK_LOCK_CONTENTION',
  'TASK_CLARIFICATION_LIMIT_REACHED',
  'TASK_ALREADY_DISPATCHED',
  'TASK_SPEND_LIMIT_EXCEEDED',

  // 2.4 Runner Sandbox & Container Runtime (SANDBOX_*)
  'SANDBOX_DOCKER_PROXY_UNREACHABLE',
  'SANDBOX_PROVISIONING_FAILED',
  'SANDBOX_OOM_KILLED',
  'SANDBOX_STARTUP_TIMEOUT',
  'SANDBOX_HEARTBEAT_TIMEOUT',
  'SANDBOX_IMAGE_PULL_FORBIDDEN',

  // 2.5 In-Container Relay Harness (RELAY_*)
  'RELAY_BLAST_RADIUS_VIOLATION',
  'RELAY_GIT_BARRIER_VIOLATION',
  'RELAY_SPEND_CEILING_HIT',
  'RELAY_INTERNAL_REVIEW_TWO_STRIKES',
  'RELAY_DETERMINISTIC_LINTER_FAILED',
  'RELAY_UNRECOVERABLE_EXCEPTION',

  // 2.6 LLM Gateway & Spend Controller (LLM_*)
  'LLM_PROVIDER_RATE_LIMITED',
  'LLM_CIRCUIT_BREAKER_TRIPPED',
  'LLM_CONTEXT_WINDOW_EXCEEDED',
  'LLM_DAILY_BUDGET_EXCEEDED',
  'LLM_LOCAL_MODEL_OFFLINE',

  // 2.7 Git & Version Control (GIT_*)
  'GIT_REMOTE_AUTH_FAILED',
  'GIT_WORKTREE_COLLISION',
  'GIT_AUTO_REBASE_CONFLICT',
  'GIT_PATCH_APPLICATION_FAILED',

  // 2.8 Addon Ecosystem & Software Factory (ADDON_*)
  'ADDON_HASH_MISMATCH',
  'ADDON_SLOT_LIMIT_EXCEEDED',
  'ADDON_UNLINKED_EXTERNAL_USER',

  // 2.9 System-One Decision Gate (GATE_*)
  'GATE_LOW_CONFIDENCE_FALLBACK',
  'GATE_BACKEND_UNAVAILABLE',

  // System & Validation
  'ACI_VALIDATION_FAILED',
  'INTERNAL_SERVER_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorMetadata {
  httpStatus: number;
  retryable: boolean;
  defaultMessage: string;
  exitCode?: number;
  wsCloseCode?: number;
}

export const ERROR_METADATA_MAP: Record<ErrorCode, ErrorMetadata> = {
  // AUTH_*
  AUTH_SESSION_MISSING: { httpStatus: 401, retryable: false, defaultMessage: 'No session cookie provided in request headers' },
  AUTH_SESSION_EXPIRED: { httpStatus: 401, retryable: false, defaultMessage: 'Session has expired' },
  AUTH_SESSION_REVOKED: { httpStatus: 401, retryable: false, defaultMessage: 'Session was revoked' },
  AUTH_INVITE_INVALID: { httpStatus: 400, retryable: false, defaultMessage: 'Invalid workspace invite token' },
  AUTH_INVITE_EXPIRED: { httpStatus: 400, retryable: false, defaultMessage: 'Workspace invite token has expired' },
  AUTH_INVITE_EXHAUSTED: { httpStatus: 400, retryable: false, defaultMessage: 'Workspace invite maximum uses reached' },
  AUTH_TGT_EXPIRED: { httpStatus: 401, retryable: true, defaultMessage: 'WebSocket Ticket-Granting Token expired' },
  AUTH_TGT_ALREADY_USED: { httpStatus: 401, retryable: false, defaultMessage: 'WebSocket Ticket-Granting Token already consumed' },

  // RBAC_*
  RBAC_INSUFFICIENT_ROLE: { httpStatus: 403, retryable: false, defaultMessage: 'Insufficient permissions for requested action' },
  RBAC_MERGE_NOT_AUTHORIZED: { httpStatus: 403, retryable: false, defaultMessage: 'Non-lead/owner attempting to approve review gate or trigger VCS PR merge' },
  RBAC_KEY_MANAGEMENT_DENIED: { httpStatus: 403, retryable: false, defaultMessage: 'Non-owner attempting to modify provider keys or daily budget caps' },
  RBAC_COCKPIT_TOOL_FORBIDDEN: { httpStatus: 403, retryable: false, defaultMessage: 'Cockpit AI tool-call forbidden by RBAC policy' },
  RBAC_CROSS_TENANT_VIOLATION: { httpStatus: 403, retryable: false, defaultMessage: 'User attempting to access workspace or project they do not belong to' },

  // TASK_*
  TASK_NOT_FOUND: { httpStatus: 404, retryable: false, defaultMessage: 'Task was not found in active workspace' },
  TASK_INVALID_STATE_TRANSITION: { httpStatus: 409, retryable: false, defaultMessage: 'Attempted task state transition violates lifecycle DAG' },
  TASK_BLOCKED_BY_DEPENDENCIES: { httpStatus: 409, retryable: false, defaultMessage: 'Cannot dispatch task with unresolved blocking dependencies' },
  TASK_LOCK_CONTENTION: { httpStatus: 423, retryable: true, defaultMessage: 'Task directory lock held by another process' },
  TASK_CLARIFICATION_LIMIT_REACHED: { httpStatus: 400, retryable: false, defaultMessage: 'Maximum clarification rounds exceeded without resolution' },
  TASK_ALREADY_DISPATCHED: { httpStatus: 409, retryable: false, defaultMessage: 'Task is already executing inside an active container' },
  TASK_SPEND_LIMIT_EXCEEDED: { httpStatus: 402, retryable: false, defaultMessage: 'Task spend ceiling reached' },

  // SANDBOX_*
  SANDBOX_DOCKER_PROXY_UNREACHABLE: { httpStatus: 503, retryable: true, defaultMessage: 'Docker socket proxy is unreachable' },
  SANDBOX_PROVISIONING_FAILED: { httpStatus: 500, retryable: true, defaultMessage: 'Docker daemon failed to create or start runner sandbox container' },
  SANDBOX_OOM_KILLED: { httpStatus: 500, retryable: false, defaultMessage: 'Container killed due to Out-Of-Memory (OOM)' },
  SANDBOX_STARTUP_TIMEOUT: { httpStatus: 504, retryable: true, defaultMessage: 'Runner sandbox failed to establish ARP connection within timeout' },
  SANDBOX_HEARTBEAT_TIMEOUT: { httpStatus: 504, retryable: false, defaultMessage: 'Runner sandbox missed consecutive heartbeats' },
  SANDBOX_IMAGE_PULL_FORBIDDEN: { httpStatus: 403, retryable: false, defaultMessage: 'Image pull forbidden in production topology' },

  // RELAY_*
  RELAY_BLAST_RADIUS_VIOLATION: { httpStatus: 422, exitCode: 2, retryable: false, defaultMessage: 'File write outside permitted writable scope' },
  RELAY_GIT_BARRIER_VIOLATION: { httpStatus: 422, exitCode: 2, retryable: false, defaultMessage: 'Structural git write barrier violation in sandbox' },
  RELAY_SPEND_CEILING_HIT: { httpStatus: 402, exitCode: 0, retryable: false, defaultMessage: 'In-container spend ceiling reached' },
  RELAY_INTERNAL_REVIEW_TWO_STRIKES: { httpStatus: 422, exitCode: 0, retryable: false, defaultMessage: 'Two-strike internal review rejection, escalating to human' },
  RELAY_DETERMINISTIC_LINTER_FAILED: { httpStatus: 422, exitCode: 0, retryable: true, defaultMessage: 'Machine-enforced Constitution linter rules failed' },
  RELAY_UNRECOVERABLE_EXCEPTION: { httpStatus: 500, exitCode: 1, retryable: false, defaultMessage: 'Unrecoverable runtime exception in relay harness' },

  // LLM_*
  LLM_PROVIDER_RATE_LIMITED: { httpStatus: 429, retryable: true, defaultMessage: 'LLM provider rate limit encountered' },
  LLM_CIRCUIT_BREAKER_TRIPPED: { httpStatus: 503, retryable: true, defaultMessage: 'LLM circuit breaker open due to consecutive failures' },
  LLM_CONTEXT_WINDOW_EXCEEDED: { httpStatus: 400, retryable: false, defaultMessage: 'Model context window exceeded' },
  LLM_DAILY_BUDGET_EXCEEDED: { httpStatus: 402, retryable: false, defaultMessage: 'Daily organization or project spend limit exceeded' },
  LLM_LOCAL_MODEL_OFFLINE: { httpStatus: 503, retryable: true, defaultMessage: 'Configured local LLM model instance is offline' },

  // GIT_*
  GIT_REMOTE_AUTH_FAILED: { httpStatus: 401, retryable: false, defaultMessage: 'Git remote authentication failed' },
  GIT_WORKTREE_COLLISION: { httpStatus: 409, retryable: true, defaultMessage: 'Git worktree path collision' },
  GIT_AUTO_REBASE_CONFLICT: { httpStatus: 409, retryable: false, defaultMessage: 'Unresolvable 3-way merge conflict during rebase' },
  GIT_PATCH_APPLICATION_FAILED: { httpStatus: 422, retryable: false, defaultMessage: 'Git patch application failed against target worktree' },

  // ADDON_*
  ADDON_HASH_MISMATCH: { httpStatus: 403, retryable: false, defaultMessage: 'Addon SHA-256 digest failed to match locked hash' },
  ADDON_SLOT_LIMIT_EXCEEDED: { httpStatus: 429, retryable: false, defaultMessage: 'Maximum active addon slot capacity reached' },
  ADDON_UNLINKED_EXTERNAL_USER: { httpStatus: 403, retryable: false, defaultMessage: 'External identity not mapped to workspace member' },

  // GATE_*
  GATE_LOW_CONFIDENCE_FALLBACK: { httpStatus: 200, retryable: true, defaultMessage: 'DecisionGate fell back to full frontier reasoning' },
  GATE_BACKEND_UNAVAILABLE: { httpStatus: 503, retryable: true, defaultMessage: 'DecisionGate backend is unavailable' },

  // System & Validation
  ACI_VALIDATION_FAILED: { httpStatus: 400, retryable: true, defaultMessage: 'Request or tool-call schema validation failed' },
  INTERNAL_SERVER_ERROR: { httpStatus: 500, retryable: false, defaultMessage: 'Internal server error' },
};

export class GraywolfAppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>
  ) {
    const meta = ERROR_METADATA_MAP[code] || {
      httpStatus: 500,
      retryable: false,
      defaultMessage: 'Unknown error',
    };
    super(message || meta.defaultMessage);
    this.name = 'GraywolfAppError';
    this.code = code;
    this.httpStatus = meta.httpStatus;
    this.retryable = meta.retryable;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, GraywolfAppError.prototype);
  }

  public toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details ?? {},
      retryable: this.retryable,
      timestamp: this.timestamp,
    };
  }
}

export const ErrorResponseSchema = Type.Object(
  {
    code: Type.String({
      description: 'Machine-readable, domain-prefixed error identifier',
    }),
    message: Type.String({
      description: 'Human-readable explanation suitable for display',
    }),
    details: Type.Record(Type.String(), Type.Unknown()),
    retryable: Type.Boolean({
      description: 'Whether the client or runner should automatically retry',
    }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO-8601 UTC timestamp of error occurrence',
    }),
  },
  { $id: 'ErrorResponse' }
);

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

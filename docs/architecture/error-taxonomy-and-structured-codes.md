# Graywolf Squad — Deep-Dive Architecture: Error Taxonomy & Structured Codes

## 1. Executive Summary & Design Principles

In an autonomous multi-agent platform, unstructured error strings (such as `throw new Error("Something went wrong")`) lead to brittle regex parsing, ambiguous model reasoning, and poor UI user experiences.

To establish machine-readable predictability across the **Fastify Control Plane**, the **In-Container `relay.mjs` Harness**, the **Agent Relay Protocol (ARP)**, and the **React Dashboard**, Graywolf adopts **ADR-042: Unified Error Taxonomy & Structured Codes**.

### Core Invariants:
1. **Namespace Prefixes**: Every error code begins with a dedicated domain prefix:
   - `AUTH_*`: Authentication, session expiration, and cryptographic token verification.
   - `RBAC_*`: Authorization, privilege boundaries, and Casbin matrix evaluations.
   - `TASK_*`: Task lifecycle transitions, lock contention, and concurrency.
   - `SANDBOX_*`: Container provisioning, Docker proxy communication, and OOM kills.
   - `RELAY_*`: In-container harness invariants, blast-radius enforcement, and git barriers.
   - `LLM_*`: Model provider routing, rate limits, spend limits, and circuit breakers.
   - `GIT_*`: Git worktree creation, merge conflicts, and VCS remote operations.
2. **Standard Payload Wire Format**: All REST, WebSocket, and in-container error outputs share the identical schema:
   ```json
   {
     "code": "RELAY_BLAST_RADIUS_VIOLATION",
     "message": "Attempted to modify path 'src/core/auth.ts' outside permitted writable scope.",
     "details": {
       "attemptedPath": "src/core/auth.ts",
       "writableScope": ["src/modules/tax/**"]
     },
     "retryable": false,
     "timestamp": "2026-09-14T21:55:00.000Z"
   }
   ```
3. **HTTP Status Code Mapping**: Every error code maps deterministically to an HTTP status code (400, 401, 403, 404, 409, 422, 429, 500, 503).
4. **WebSocket Close Code Alignment**: Corresponds directly with ARP custom close frames (4001–4010) defined in ADR-036.

---

## 2. Canonical Error Code Taxonomy

### 2.1 Authentication & Session (`AUTH_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `AUTH_SESSION_MISSING` | 401 | No | No `__session` cookie provided in request headers. |
| `AUTH_SESSION_EXPIRED` | 401 | No | Session timestamp expired in PostgreSQL and Valkey. |
| `AUTH_SESSION_REVOKED` | 401 | No | Session key purged from Valkey following user demotion or ejection. |
| `AUTH_INVITE_INVALID` | 400 | No | Invite token hash not found in `workspace_invites`. |
| `AUTH_INVITE_EXPIRED` | 400 | No | Invite expiration timestamp has passed. |
| `AUTH_INVITE_EXHAUSTED` | 400 | No | Invite `uses_count >= max_uses`. |
| `AUTH_TGT_EXPIRED` | 401 | Yes | WebSocket Ticket-Granting Token expired (>15s cutoff with grace). |
| `AUTH_TGT_ALREADY_USED` | 401 | No | TGT has already been consumed via `GETDEL` (replay prevention). |

---

### 2.2 Authorization & RBAC (`RBAC_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `RBAC_INSUFFICIENT_ROLE` | 403 | No | User's role does not meet minimum threshold (e.g. `viewer` attempting `create_task`). |
| `RBAC_MERGE_NOT_AUTHORIZED` | 403 | No | Non-lead/owner attempting to approve review gate or trigger VCS PR merge. |
| `RBAC_KEY_MANAGEMENT_DENIED` | 403 | No | Non-owner attempting to modify LLM provider keys or daily budget caps. |
| `RBAC_COCKPIT_TOOL_FORBIDDEN` | 403 | No | Chat Cockpit AI tool-call blocked server-side by Fastify Casbin interceptor. |
| `RBAC_CROSS_TENANT_VIOLATION` | 403 | No | User attempting to access a workspace or project they do not belong to. |

---

### 2.3 Task Lifecycle & Concurrency (`TASK_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `TASK_NOT_FOUND` | 404 | No | Requested `taskId` does not exist in the active workspace. |
| `TASK_INVALID_STATE_TRANSITION` | 409 | No | Attempted transition violates state machine (e.g. `BACKLOG` directly to `MERGED`). |
| `TASK_BLOCKED_BY_DEPENDENCIES` | 409 | No | Cannot dispatch task because upstream tasks in `blocked_by` are not `MERGED`. |
| `TASK_LOCK_CONTENTION` | 423 | Yes | `proper-lockfile` directory lock held by another active runner or orchestrator thread. |
| `TASK_CLARIFICATION_LIMIT_REACHED` | 400 | No | Maximum clarification rounds (2) exceeded without resolution. |
| `TASK_ALREADY_DISPATCHED` | 409 | No | Task is already `IN_PROGRESS` inside an active container. |
| `TASK_SPEND_LIMIT_EXCEEDED` | 402 | No | Task token bill hit configured `spendLimitUSD` ceiling. |

---

### 2.4 Runner Sandbox & Container Runtime (`SANDBOX_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `SANDBOX_DOCKER_PROXY_UNREACHABLE` | 503 | Yes | Orchestrator failed to reach `http://docker-proxy:2375` on `daemon-net`. |
| `SANDBOX_PROVISIONING_FAILED` | 500 | Yes | Docker daemon failed to create or start `runner-{TASK_ID}` container. |
| `SANDBOX_OOM_KILLED` | 500 | No | Container exceeded Docker memory limit (`--memory 4g`) and was killed by Linux OOM (Exit 137). |
| `SANDBOX_STARTUP_TIMEOUT` | 504 | Yes | Runner container failed to establish ARP WebSocket connection within boot limit (10s). |
| `SANDBOX_HEARTBEAT_TIMEOUT` | 504 | No | Container missed 3 consecutive 15-second ARP heartbeats (stale runner). |
| `SANDBOX_IMAGE_PULL_FORBIDDEN` | 403 | No | Orchestrator requested unpinned image in production topology (ADR-040 gate). |

---

### 2.5 In-Container Relay Harness (`RELAY_*`)

*Emitted inside the sandbox by `relay.mjs` and returned in `result.json` or ARP frames:*

| Error Code | Exit Code | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `RELAY_BLAST_RADIUS_VIOLATION` | 2 | No | Synchronous file interceptor caught write attempt to Read-Only or Forbidden glob. |
| `RELAY_GIT_BARRIER_VIOLATION` | 2 | No | Agent attempted `git push`, `git commit`, `git merge` via `git-guard.sh`. |
| `RELAY_SPEND_CEILING_HIT` | 0 | No | In-container spend accumulator hit 100% budget ceiling, triggering clean halt. |
| `RELAY_INTERNAL_REVIEW_TWO_STRIKES` | 0 | No | Dev-Level-2 rejected implementation twice; task escalated to human gate. |
| `RELAY_DETERMINISTIC_LINTER_FAILED` | 0 | Yes | Code violated machine-enforced Constitution rules (`ast-grep` banned import / regex). |
| `RELAY_UNRECOVERABLE_EXCEPTION` | 1 | No | Fatal Node.js crash or WebSocket failure inside `relay.mjs`. |

---

### 2.6 LLM Gateway & Spend Controller (`LLM_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `LLM_PROVIDER_RATE_LIMITED` | 429 | Yes | Model provider returned HTTP 429; LiteLLM circuit breaker triggers fallback. |
| `LLM_CIRCUIT_BREAKER_TRIPPED` | 503 | Yes | Primary and fallback providers failed consecutive call thresholds. |
| `LLM_CONTEXT_WINDOW_EXCEEDED` | 400 | No | Task brief, repo map, or diff exceeded model token input limit. |
| `LLM_DAILY_BUDGET_EXCEEDED` | 402 | No | Organization or project hit `dailySpendCapUSD`. |
| `LLM_LOCAL_MODEL_OFFLINE` | 503 | Yes | Local Ollama/vLLM instance unreachable on configured host port. |

---

### 2.7 Git & Version Control (`GIT_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `GIT_REMOTE_AUTH_FAILED` | 401 | No | Invalid PAT, expired token, or rejected SSH key during Git clone/fetch. |
| `GIT_WORKTREE_COLLISION` | 409 | Yes | Worktree directory path already registered in `.git/worktrees`. |
| `GIT_AUTO_REBASE_CONFLICT` | 409 | No | Target branch moved ahead and 3-way merge generated unresolvable conflict (ADR-031). |
| `GIT_PATCH_APPLICATION_FAILED` | 422 | No | `git apply changes.patch` failed against target worktree. |

---

### 2.8 Addon Ecosystem & Software Factory (`ADDON_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `ADDON_HASH_MISMATCH` | 403 | No | Tier 2 community addon SHA-256 digest failed to match locked hash in `.agents/project.config.json` (ADR-080 Fail-Closed). |
| `ADDON_SLOT_LIMIT_EXCEEDED` | 429 | No | Host profile exceeded maximum concurrent addon slots (Topology A cap: 3 Signal + 1 Cockpit). |
| `ADDON_UNLINKED_EXTERNAL_USER` | 403 | No | External chat user ID (Discord/Slack/Teams) has no verified mapping in `workspace_member_identities` (ADR-080). |

---

### 2.9 System-One Decision Gate (`GATE_*`)

| Error Code | HTTP Status | Retryable | Description |
| :--- | :---: | :---: | :--- |
| `GATE_LOW_CONFIDENCE_FALLBACK` | 200 | Yes | Decision gate score fell below threshold (`<0.85` or `<0.90`); execution safely fell back to full frontier model reasoning (ADR-079). |
| `GATE_BACKEND_UNAVAILABLE` | 503 | Yes | Configured local or remote decision gate endpoint unreachable; bypassed or routed to frontier reasoning. |

---

## 3. Fastify & TypeScript Implementation

### 3.1 TypeBox Schema Definition

```typescript
import { Type, Static } from '@sinclair/typebox';

export const ErrorResponseSchema = Type.Object({
  code: Type.String({ 
    description: 'Machine-readable, domain-prefixed error identifier',
    examples: ['RELAY_BLAST_RADIUS_VIOLATION', 'RBAC_INSUFFICIENT_ROLE']
  }),
  message: Type.String({
    description: 'Human-readable explanation suitable for display'
  }),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  retryable: Type.Boolean({
    description: 'Whether the client or runner should automatically retry'
  }),
  timestamp: Type.String({ format: 'date-time' })
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
```

### 3.2 Global Fastify Error Handler

```typescript
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof GraywolfAppError) {
    return reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      retryable: error.retryable,
      timestamp: new Date().toISOString()
    });
  }

  // Fallback for unhandled unexpected runtime crashes
  request.log.error(error);
  return reply.status(500).send({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal error occurred.',
    details: {},
    retryable: false,
    timestamp: new Date().toISOString()
  });
});
```

---

## 4. UI Client Handling Strategy (React / assistant-ui)

The React dashboard and Chat Cockpit consume these structured error codes to render actionable user guidance rather than raw stack traces:

1. **`AUTH_TGT_EXPIRED`**: The dashboard transparently fetches a new ticket from `/telemetry/ws-ticket` and reconnects the WebSocket without showing an error to the user.
2. **`RBAC_COCKPIT_TOOL_FORBIDDEN`**: The Chat Cockpit transforms the error into conversational context, enabling the AI to state: *"You do not have permission to merge this PR. Please ask a Lead Developer or Owner to approve."*
3. **`RELAY_BLAST_RADIUS_VIOLATION`**: The Kanban card displays a red warning badge with a link to inspect the `escalation-request.md` and adjust the task's writable scope.
4. **`GIT_AUTO_REBASE_CONFLICT`**: The UI presents an interactive 3-way diff view allowing the human developer to resolve the conflict or instruct the squad to re-plan.

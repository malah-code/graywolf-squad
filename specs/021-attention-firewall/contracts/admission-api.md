# API & Module Contracts: Attention Firewall & Two-Stage Signal Admission (`021-attention-firewall`)

**Date**: 2026-11-05  
**Spec Reference**: [spec.md](file:///home/tarikelmallah/Projects/GraywolfSquad/specs/021-attention-firewall/spec.md)  
**Protocol**: REST / JSON over HTTP (Fastify 5.x)  
**Authentication & Authorization**: Bearer TGT or Session Cookie + Casbin RBAC (ADR-013, ADR-014)

---

## 1. REST Endpoints Specification

All endpoints are scoped under `/api/v1/projects/:id/admission/*`.

### 1.1 `GET /api/v1/projects/:id/admission/policy`

Fetches the currently active signal admission policy for the project.

- **URL Params**: `id` (UUID, Project ID)
- **Status Codes**:
  - `200 OK`: Policy found and returned.
  - `401 Unauthorized`: Missing or invalid credentials.
  - `403 Forbidden`: User lacks `read` access to the project.
  - `404 Not Found`: Project or active policy not found.
- **Response Body**:
  ```json
  {
    "id": "a5d09b67-73d8-4f81-9b16-43d924df0e59",
    "projectId": "f3b3b44b-4861-42cb-b1b7-7d812ebcebc4",
    "versionHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "mode": "observe",
    "rules": [
      {
        "id": "copy",
        "name": "Copy fixes",
        "enabled": true,
        "instruction": "Explicit requests to correct a typo, wording, punctuation or existing translation."
      },
      {
        "id": "visual",
        "name": "Visual fixes",
        "enabled": true,
        "instruction": "Explicit implementation requests for local spacing, alignment, overflow or styling."
      }
    ],
    "settings": {
      "evalTimeoutSeconds": 120,
      "sources": {
        "github": {
          "allowed": [{ "id": "octocat", "name": "The Octocat" }],
          "ignoredAssignees": ["mohamed"],
          "excludedLabels": ["needs-human", "wontfix"],
          "admission": {
            "listedUnaddressed": "inferred",
            "unlistedAddressed": "ignore",
            "unlistedUnaddressed": "ignore"
          }
        }
      }
    },
    "isActive": true,
    "createdAt": "2026-11-05T12:00:00.000Z"
  }
  ```

---

### 1.2 `PUT /api/v1/projects/:id/admission/policy`

Updates the project's signal admission policy, computes a new SHA-256 version hash, evaluates `policyEffects()` on open tasks, and dispatches advisory `task.inject` notices or pauses.

- **URL Params**: `id` (UUID, Project ID)
- **RBAC**: Requires role `maintainer` or `admin`.
- **Request Body**:
  ```json
  {
    "mode": "auto",
    "rules": [
      {
        "id": "copy",
        "name": "Copy fixes",
        "enabled": true,
        "instruction": "Explicit requests to correct a typo, wording, or punctuation."
      }
    ],
    "settings": {
      "evalTimeoutSeconds": 180,
      "sources": {
        "github": {
          "allowed": [{ "id": "octocat" }],
          "ignoredAssignees": ["mohamed"],
          "excludedLabels": ["needs-human"]
        }
      }
    }
  }
  ```
- **Response Body**:
  ```json
  {
    "policy": {
      "id": "b7e19b67-73d8-4f81-9b16-43d924df0e60",
      "versionHash": "4a5b6c7d8e9f...",
      "mode": "auto"
    },
    "effects": {
      "affectedTasksCount": 1,
      "injectedAdvisories": ["TASK-102"],
      "pausedTasks": []
    }
  }
  ```

---

### 1.3 `GET /api/v1/projects/:id/admission/overview`

Returns an aggregated overview of the Attention Firewall status.

- **Response Body**:
  ```json
  {
    "mode": "observe",
    "versionHash": "9f86d081884c7d...",
    "activeThreadsCount": 2,
    "evaluatingThreadsCount": 1,
    "pendingTriggersCount": 3,
    "observedProposalsCount": 5,
    "lastEvaluatedAt": "2026-11-05T20:15:30.000Z",
    "isPaused": false
  }
  ```

---

### 1.4 `GET /api/v1/projects/:id/admission/decisions`

Lists decisions, with optional filtering for observed proposals shown in the "Needs You" UI card.

- **Query Parameters**:
  - `kind`: `observed` | `all` (default: `all`)
  - `limit`: Integer (default: 20, max: 100)
  - `offset`: Integer (default: 0)
- **Response Body**:
  ```json
  {
    "items": [
      {
        "id": "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
        "threadId": "th_123",
        "primaryTriggerId": "tr_456",
        "policyVersionHash": "9f86d081884c7d...",
        "verdict": "ignore",
        "reasonCode": "observed",
        "proposal": {
          "title": "Fix alignment on sign-in button",
          "scope": "src/dashboard/components/SignIn.tsx",
          "worktreeName": "fix-signin-button"
        },
        "intentEvidence": {
          "quote": "The login button text is overlapping with the icon on mobile",
          "speaker": "sarah"
        },
        "evaluationDurationMs": 1420,
        "createdAt": "2026-11-05T20:10:00.000Z"
      }
    ],
    "total": 1
  }
  ```

---

### 1.5 `POST /api/v1/projects/:id/admission/decisions/:decisionId/promote`

Promotes an observed proposal into a real executing Graywolf task carrying a valid `Mandate`.

- **RBAC**: Requires authenticated human user (role `developer`, `maintainer`, or `admin`).
- **Response Body (`201 Created`)**:
  ```json
  {
    "taskId": "TASK-20261105-001",
    "mandateId": "8f9a0b1c-2d3e-4f5a-6b7c-8d9e0f1a2b3c",
    "status": "QUEUED"
  }
  ```

---

### 1.6 `POST /api/v1/projects/:id/admission/decisions/:decisionId/dismiss`

Dismisses an observed proposal with optional operator feedback.

- **Request Body**:
  ```json
  {
    "reason": "Out of scope for current sprint"
  }
  ```
- **Response Body (`200 OK`)**:
  ```json
  {
    "success": true,
    "decisionId": "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
    "dismissed": true
  }
  ```

---

### 1.7 `POST /api/v1/projects/:id/admission/pause`

Temporarily halts new evaluations and extends the deadline of running evaluations.

- **Request Body**:
  ```json
  {
    "durationMs": 300000
  }
  ```
- **Response Body (`200 OK`)**:
  ```json
  {
    "paused": true,
    "resumesAt": "2026-11-05T20:35:00.000Z",
    "shiftedEvaluationsCount": 2
  }
  ```

# Feature Specification: 001-platform-foundation

**Feature Branch**: `001-platform-foundation`  
**Created**: 2026-10-18  
**Status**: Draft  
**Target Phase**: Phase 0 — Bootstrap, Dual-Port Skeleton & Docker Topology Alignment (`docs/implementation-plan-detailed.md`)  
**Input**: Master Phased Implementation Plan §Phase 0; ADR-005, ADR-040, ADR-041, ADR-042

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dual-Port Server Lifecycle & Health Observability (Priority: P1)

An operator or automated orchestrator starts the Graywolf platform. The system boots two dedicated, network-isolated ports:
1. **Control Plane Port (3000)** for external management REST APIs (`/api/v1/*`), health checks, and dashboard traffic.
2. **Agent Relay Protocol (ARP) Port (3001)** for internal runner container communication (`/relay`).
The system reports its health status deterministically and shuts down gracefully upon receiving termination signals (`SIGINT`/`SIGTERM`) without dropping in-flight connections.

**Why this priority**: Without a cleanly bootstrapped dual-port foundation, no higher-level orchestration, container communication, or web dashboard can function.

**Independent Test**: Can be tested by starting the server process, querying `GET /health` and `GET /api/v1/healthz` on port 3000 (expecting 200 OK), establishing a WebSocket connection to `ws://localhost:3001/relay`, and sending `SIGTERM` to observe clean process shutdown.

**Acceptance Scenarios**:
1. **Given** the service is started with valid environment variables, **When** `GET /health` or `GET /api/v1/healthz` is requested on Port 3000, **Then** the service responds with HTTP 200 and `{ "ok": true, "timestamp": "<ISO-8601>" }`.
2. **Given** the service is running, **When** a client connects via WebSocket to Port 3001 at `/relay`, **Then** the handshake succeeds without interfering with Port 3000 HTTP traffic.
3. **Given** both ports are listening, **When** `SIGINT` or `SIGTERM` is emitted, **Then** both servers close gracefully within 5 seconds with zero zombie processes.

---

### User Story 2 - Deterministic ADR-042 Error Taxonomy & Structured API Failures (Priority: P1)

A client or runner invokes an API route or encounters a runtime error. Rather than receiving an opaque HTML error or unstructured stack trace, the platform intercepts the error at the global boundary and returns a standardized, machine-readable JSON error envelope adhering strictly to ADR-042.

**Why this priority**: Predictable error codes (`AUTH_*`, `RBAC_*`, `TASK_*`, `SANDBOX_*`, `RELAY_*`, etc.) and the uniform `{ code, message, details, retryable, timestamp }` contract prevent hallucination and brittle string parsing across agents and client frontends.

**Independent Test**: Trigger a deliberate route failure or validation error and verify that the response body conforms to the TypeBox error schema with the canonical HTTP status and retryable flag.

**Acceptance Scenarios**:
1. **Given** an invalid request or unhandled exception, **When** Fastify processes the request, **Then** the global error handler intercepts it and formats the response as `{ code, message, details, retryable, timestamp }`.
2. **Given** a known domain exception from `docs/architecture/error-taxonomy-and-structured-codes.md` (e.g., `SANDBOX_PROVISIONING_FAILED` or `RBAC_MERGE_NOT_AUTHORIZED`), **When** thrown, **Then** the exact mapped HTTP status code (e.g. 500 or 403) and retryability flag (`true` or `false`) are emitted.

---

### User Story 3 - Environment Configuration & Multi-Network Docker Alignment (Priority: P2)

The system loads its runtime configuration through a strict Zod-validated environment parser matching the 4-network architecture in `docker-compose.yml` (`PORT_CONTROL`, `PORT_ARP`, `DOCKER_HOST`, `DATABASE_URL`, `VALKEY_URL`, `LITELLM_URL`, `RUNNER_DOCKER_NETWORK`). If any required parameter is missing or malformed, the application fails immediately at boot with descriptive errors.

**Why this priority**: Prevents silent misconfigurations between Docker Compose network namespaces (`edge-net`, `control-net`, `daemon-net`, `runner-net`) and application runtime parameters.

**Independent Test**: Run unit tests on `env.ts` against valid and invalid environment configurations, and verify `docker compose config -q` passes against the repository compose file and Dockerfiles.

**Acceptance Scenarios**:
1. **Given** standard default environment variables, **When** `env.ts` initializes, **Then** all parameters resolve to predictable defaults without runtime errors.
2. **Given** `NODE_ENV=production` and missing critical secrets (e.g. `RELAY_JWT_SECRET` < 32 chars), **When** initialized, **Then** the process terminates with a specific validation error before opening ports.
3. **Given** the docker files for orchestrator and liteLLM configuration, **When** `docker compose config` is executed, **Then** the configuration validates with zero schema syntax errors.

---

### Edge Cases

- What happens when Port 3000 or Port 3001 is already bound by another process? The application logs a fatal error detailing the port conflict and exits with code 1 without starting the companion port.
- How does the system handle high-frequency health probes under load? The `/health` route is unauthenticated and lightweight (in-memory response, sub-5ms latency).
- What happens if an unhandled promise rejection occurs during server boot? Caught by global process handlers, logged via Pino, and exited with status 1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST configure `package.json` with all runtime and development scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `migrate:up`, `migrate:down`, `prompts:compile`) and Fastify 5.x-compatible dependencies.
- **FR-002**: System MUST implement a Zod-validated configuration parser in `src/orchestrator/config/env.ts` reflecting `docker-compose.yml` environment variables.
- **FR-003**: System MUST define the exact canonical ADR-042 Error Taxonomy union (`docs/architecture/error-taxonomy-and-structured-codes.md`), HTTP/WS status mappings, and structured `GraywolfAppError` in `src/orchestrator/errors/taxonomy.ts`.
- **FR-004**: System MUST register a global Fastify error handler in `src/orchestrator/errors/error-handler.ts` enforcing the standardized `{ code, message, details, retryable, timestamp }` JSON wire schema.
- **FR-005**: System MUST initialize Fastify Control Plane on `PORT_CONTROL` (default 3000) with security middlewares (`@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`).
- **FR-006**: System MUST expose `GET /health` and `GET /api/v1/healthz` returning HTTP 200 with JSON payload `{ ok: true, timestamp }`.
- **FR-007**: System MUST initialize a dedicated Agent Relay Protocol (ARP) WebSocket listener on `PORT_ARP` (default 3001) mounted at `/relay`.
- **FR-008**: System MUST implement graceful shutdown handling `SIGINT` and `SIGTERM` across both ports.
- **FR-009**: System MUST supply `docker/orchestrator/Dockerfile`, `docker/dashboard/Dockerfile` (stub), `docker/litellm/config.yaml`, and `docker/postgres/init/00-extensions.sql` to support full `docker-compose.yml` topology validation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm typecheck` and `pnpm lint` pass with 0 errors and 0 warnings.
- **SC-002**: `pnpm test` executes unit and integration test suites covering env parsing, error taxonomy, and dual-port server lifecycle with 100% passing tests.
- **SC-003**: Health endpoints on Port 3000 respond with sub-10ms latency under local testing.
- **SC-004**: `docker compose config -q` passes without errors on the project root.

## Assumptions

- Node.js 20+ runtime is available on the execution host.
- PostgreSQL 16 and Valkey instances are managed either via Docker Compose or local development ports.
- Port 3000 and 3001 are available for binding in development and test environments.

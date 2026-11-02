# Research: Platform Foundation (Thin Vertical Slice)

## 1. Fastify & TypeScript Setup
- **Decision**: Initialize with `pnpm` workspace (if monorepo desired later) or a simple `package.json`, using `fastify`, `@fastify/websocket`, and `pino` for logging.
- **Rationale**: Fastify is the chosen framework per the constitution. It provides built-in WebSocket support via plugins.
- **Alternatives considered**: Express (too slow, no native async/await optimization), NestJS (too heavy for a thin vertical slice).

## 2. Agent Relay Protocol (ARP) Mocking
- **Decision**: The orchestrator will listen on `ws://localhost:3001`. The dummy `relay.mjs` script will use the native `ws` (or global `WebSocket` in Node 21+) to connect, send a hardcoded payload, and exit.
- **Rationale**: Validates the bi-directional execution plane contract without building out the Valkey backpressure buffer or complex routing.

## 3. Docker Sandbox Spawning
- **Decision**: Use `dockerode` to programmatically spawn a container. 
- **Rationale**: `dockerode` provides a robust API for container lifecycle management.
- **Alternatives considered**: Spawning a shell subprocess `docker run` (fragile, hard to parse state), using the Docker REST API directly (unnecessary boilerplate).

## 4. Local Database
- **Decision**: Use `pg` driver and standard SQL statements for the `tasks` table.
- **Rationale**: Minimal setup overhead. ORMs (like Prisma/Drizzle) are deferred until the data model matures.

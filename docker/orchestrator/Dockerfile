# ==============================================================================
# Graywolf Squad Orchestrator Multi-Stage Dockerfile
# Node.js 20 Alpine Linux Runtime
# ==============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

COPY pnpm-workspace.yaml* .npmrc* package.json pnpm-lock.yaml* ./
COPY src/dashboard/package.json ./src/dashboard/
RUN pnpm install --frozen-lockfile || pnpm install

COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/

RUN pnpm build

# ------------------------------------------------------------------------------
# Production Runner Image
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT_CONTROL=3000
ENV PORT_ARP=3001

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

COPY pnpm-workspace.yaml* .npmrc* package.json pnpm-lock.yaml* ./
COPY src/dashboard/package.json ./src/dashboard/
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

COPY --from=builder /app/dist ./dist

# Ports: 3000 (Control Plane REST), 3001 (ARP WebSocket)
EXPOSE 3000 3001

CMD ["node", "dist/orchestrator/index.js"]

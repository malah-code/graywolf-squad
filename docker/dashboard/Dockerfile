# ==============================================================================
# Graywolf Squad Dashboard Multi-Stage Dockerfile (React + Vite + Nginx)
# ==============================================================================

# Stage 1: Build dashboard assets
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY src/dashboard/package.json ./src/dashboard/

# Install dashboard dependencies
RUN pnpm --filter graywolf-dashboard install --frozen-lockfile=false

# Copy dashboard source
COPY src/dashboard ./src/dashboard

# Build dashboard production bundle
RUN pnpm --filter graywolf-dashboard build

# Stage 2: Serve via Nginx
FROM nginx:alpine

# Copy built SPA assets
COPY --from=builder /app/src/dashboard/dist /usr/share/nginx/html

# Expose HTTP port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

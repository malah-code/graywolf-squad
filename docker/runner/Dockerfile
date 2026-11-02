# ==============================================================================
# Graywolf Squad — Hardened Runner Dockerfile (PRD §13.3)
# ==============================================================================
FROM node:20-bookworm-slim

# Install system dependencies, tools, and prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    ca-certificates \
    curl \
    gnupg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install security and AST analysis CLI tools: ast-grep, gitleaks, osv-scanner
RUN npm install -g @ast-grep/cli

# Install gitleaks and osv-scanner binaries
ARG GITLEAKS_VERSION=8.18.2
ARG OSV_SCANNER_VERSION=1.7.0

RUN curl -sSL https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz \
    | tar -xz -C /usr/local/bin gitleaks \
    && chmod +x /usr/local/bin/gitleaks

RUN curl -sSL -o /usr/local/bin/osv-scanner https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64 \
    && chmod +x /usr/local/bin/osv-scanner

# Install Playwright with Chromium and system dependencies
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
    && chmod -R 755 /ms-playwright

# Create dedicated non-root graywolf user and group (UID/GID 10001)
RUN groupadd -g 10001 graywolf \
    && useradd -m -u 10001 -g 10001 -s /bin/bash graywolf

# Prepare directories for workspace, relay, and package cache
RUN mkdir -p /workspace /relay /home/graywolf/.npm /scratch/spill \
    && chown -R graywolf:graywolf /workspace /relay /home/graywolf /scratch/spill

# Set non-root execution context
USER 10001:10001
WORKDIR /workspace

CMD ["node", "/relay/relay.mjs"]

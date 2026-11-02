# Quickstart: Secrets Envelope Encryption, Out-of-Band Proxy, Sub-2s Package Cache & P0 Exit Verification

## Prerequisites

- Node.js 20+ and `pnpm` installed
- Dependencies installed via `pnpm install`

## Run Phase 16 Test Suites

```bash
# 1. Run Task 16.1 unit tests (KEK ~/.graywolf/master.key, AES-256-GCM secret_vault, ADR-055 MCP Redaction):
pnpm vitest run tests/unit/kek-vault-and-mcp-redaction.test.ts

# 2. Run Task 16.2 unit tests (Out-of-Band Secrets Proxy, Git Socket & Streaming Secret Scrubber):
pnpm vitest run tests/unit/secrets-proxy-and-scrubber.test.ts

# 3. Run Task 16.3 integration tests (Tier 1 <2s warm cold start, Tier 2 10m debounce, Opt-in ServiceOtel):
pnpm vitest run tests/integration/cache-cold-start.test.ts

# 4. Run Task 16.4 P0 Platform Maturity Exit Benchmark Suite (PRD §16 all 4 exit criteria):
pnpm vitest run tests/e2e/p0-maturity-benchmarks.test.ts

# 5. Full repository typecheck, lint & test verification:
pnpm typecheck && pnpm lint && pnpm test
```


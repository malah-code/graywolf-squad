# Quickstart: Trajectory Compression & Local SFT Dataset Pipeline (`020-trajectory-compression-and-dataset`)

## 1. Run Unit Tests for Harvester & Hermes Compressor (Task 19.1)

```bash
pnpm test tests/unit/trajectory-compressor.test.ts
```

Verifies:
- Eligibility gate (`dataset.collect === true`, `status === 'COMPLETED'`, `strikes === 0`, `agreedP0P1Findings === 0`).
- Hermes Protect-Head / Protect-Tail / Summarize-Middle compression.
- Tool-call / tool-result pair boundary protection (expanding tail backwards when cutoff lands on a `tool` turn).
- Deterministic 90/10 train/eval split calculation.

## 2. Run Integration Tests for Privacy Redaction, Monthly Rotation & Dataset REST API (Task 19.2)

```bash
pnpm test tests/integration/trajectory-dataset-pipeline.test.ts
```

Verifies:
- Multi-layer privacy redaction (workspace root paths `<REDACTED_PATH>`, git remote URLs `<REDACTED_GIT_REMOTE>`, API keys/tokens `<REDACTED_SECRET>`, DB URLs `<REDACTED_DB_URL>`, PEM private keys `<REDACTED_PRIVATE_KEY>`, and `sensitiveIdentifiers` `<REDACTED_PROJECT>`).
- Monthly JSONL storage under `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl` and expired month pruning.
- `GET /api/v1/projects/:id/dataset/stats`, `GET /api/v1/projects/:id/dataset/export?format=openai|sharegpt`, and `POST /api/v1/projects/:id/dataset/prune`.


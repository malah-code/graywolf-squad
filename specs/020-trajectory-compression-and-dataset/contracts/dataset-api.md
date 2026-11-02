# Contracts: Trajectory Compression & Local SFT Dataset API (`020-trajectory-compression-and-dataset`)

## 1. Module Contracts

### 1.1 `src/orchestrator/learning/trajectory-harvester.ts`
- `computeTrajectorySplit(taskId: string): 'train' | 'eval'`
  - Deterministically hashes `taskId` with SHA-256 (`parseInt(hash.slice(0, 8), 16) % 10 === 0 ? 'eval' : 'train'`).
- `evaluateTrajectoryEligibility(candidate: CandidateTaskTrajectory, config: DatasetCollectionConfig): TrajectoryEligibilityResult`
  - Returns `{ eligible: true, split }` strictly when `config.collect === true && candidate.status === 'COMPLETED' && candidate.strikes === 0 && candidate.agreedP0P1Findings === 0`.
  - Otherwise returns `{ eligible: false, reason, split }`.
- `harvestEligibleTrajectory(candidate: CandidateTaskTrajectory, config: DatasetCollectionConfig, options?: { outputBaseDir?: string; now?: Date; auxiliarySummarizer?: (middleTurns: TrajectoryTurn[]) => Promise<string> })`
  - Evaluates eligibility, compresses via `compressHermesTrajectory`, scrubs via `redactTrajectoryPrivacy`, writes to `.agents/dataset/trajectories/YYYY-MM/<taskId>.jsonl`, and triggers automatic retention pruning when `config.retentionMonths` is set.

### 1.2 `src/orchestrator/learning/trajectory-compressor.ts`
- `compressHermesTrajectory(options: HermesCompressionOptions): Promise<HermesCompressedTrajectory>`
  - **Protected Head**: System prompt + initial task brief (`user` turn) + first `assistant` turn (and any immediately paired `tool` response turns belonging to that first assistant turn).
  - **Protected Tail**: Last `protectTailTurns` (default `4`) turns, expanded backwards if the first tail turn has `role === 'tool'` so its parent `assistant` turn is included in the tail.
  - **Summarize Middle**: Compresses turns between Head and Tail into a single narration message (`role: 'assistant'`), falling back to `buildHermesMiddleNarration(middleTurns)` if no `auxiliarySummarizer` is provided or if it throws.

### 1.3 `src/orchestrator/learning/dataset-manager.ts`
- `redactTrajectoryPrivacy(rawText: string, options?: { workspaceRoot?: string; sensitiveIdentifiers?: string[] }): { scrubbedText: string; redactionCount: number }`
  - Scrubs workspace root prefixes (`<REDACTED_PATH>`), git remote URLs (`<REDACTED_GIT_REMOTE>`), API keys/secrets (`<REDACTED_SECRET>`), Bearer tokens (`Bearer <REDACTED_TOKEN>`), DB URLs (`<REDACTED_DB_URL>`), PEM private keys (`<REDACTED_PRIVATE_KEY>`), and `sensitiveIdentifiers` (`<REDACTED_PROJECT>`).
- `convertToShareGptFormat(record: PersistedTrajectoryRecord): ShareGptTrajectoryRecord`
- `getDatasetStats(projectId: string, outputBaseDir?: string): Promise<DatasetStatsSummary>`
- `exportDatasetJsonl(options: { projectId: string; format?: 'openai' | 'sharegpt'; split?: 'train' | 'eval' | 'all'; month?: string; outputBaseDir?: string }): Promise<{ format: 'openai' | 'sharegpt'; count: number; jsonl: string }>`
- `pruneExpiredTrajectoryMonths(outputBaseDir: string, retentionMonths: number, referenceDate?: Date): Promise<{ prunedMonths: string[]; keptMonths: string[] }>`

---

## 2. REST Endpoints (`src/orchestrator/routes/dataset.ts`)

### 2.1 `GET /api/v1/projects/:id/dataset/stats`
- **Response `200 OK`**:
  ```json
  {
    "projectId": "proj-1",
    "totalTrajectories": 12,
    "trainCount": 11,
    "evalCount": 1,
    "months": [{ "month": "2026-11", "count": 12 }],
    "totalTokensBefore": 48000,
    "totalTokensAfter": 19200,
    "totalRedactions": 7
  }
  ```

### 2.2 `GET /api/v1/projects/:id/dataset/export`
- **Query Parameters**:
  - `format`: `'openai' | 'sharegpt'` (optional, default `'openai'`)
  - `split`: `'train' | 'eval' | 'all'` (optional, default `'all'`)
  - `month`: `YYYY-MM` pattern `^\d{4}-(0[1-9]|1[0-2])$` (optional; returns `400 ACI_VALIDATION_FAILED` if malformed)
- **Response `200 OK`**:
  ```json
  {
    "projectId": "proj-1",
    "format": "openai",
    "split": "all",
    "count": 2,
    "jsonl": "{...}\n{...}\n"
  }
  ```

### 2.3 `POST /api/v1/projects/:id/dataset/prune`
- **Body**: `{ "retentionMonths": 3, "referenceDate"?: "2026-11-01T00:00:00.000Z" }`
- **Response `200 OK`**:
  ```json
  {
    "projectId": "proj-1",
    "prunedMonths": ["2026-06"],
    "keptMonths": ["2026-09", "2026-11"]
  }
  ```


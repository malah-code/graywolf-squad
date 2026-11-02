# Graywolf Squad — Deep-Dive Architecture: Monitoring, Observability & Agent Logs

## 1. Executive Summary & Vision

Developers adopt autonomous software engineering agents only when they can **inspect and understand agent reasoning in real time**. A opaque system that outputs raw diffs without context breeds skepticism and fear of hallucinations. Conversely, spewing hundreds of raw LLM JSON logs into the UI overwhelms the developer with low-level noise.

Graywolf Squad implements a **Unified Event Stream Architecture** featuring:
1. **Dual-Layer Rendering**: A high-level structured narrative timeline as the default view, paired with on-demand deep-dive terminal streaming (Xterm.js) for raw stdout/stderr ground truth.
2. **Granular LLM Cost & Token Ledger (`llm_calls`)**: A dedicated relational analytics table tracking prompt tokens, completion tokens, costs, and prompt-cache hits (`cache_read_tokens`) broken down by persona, model, and task.
3. **Additive OpenTelemetry (OTLP) Exporter**: Native internal storage in PostgreSQL for $0 zero-dependency local runs, with an optional OTLP bridge supporting external enterprise monitoring (Datadog, Grafana, Honeycomb) using emerging `gen_ai.*` semantic conventions.

---

## 2. Unified Event Stream Architecture (Dual Rendering)

Rather than maintaining separate logging pipelines for chat, terminal outputs, and system metrics, every action in Graywolf is emitted to an append-only event stream and rendered through two synchronized lenses:

```
                  ┌──────────────────────────────────────────────┐
                  │ Task Container / Agent Execution Relay       │
                  └──────────────────────┬───────────────────────┘
                                         │ Emits Typed Event
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ Fastify WebSocket & Event Hub (append-only)  │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
┌──────────────────────────────────────────────┐ ┌──────────────────────────────────────────────┐
│ Surface A: Primary Narrative Timeline        │ │ Surface B: Expandable Ground Truth Terminal   │
│ (React UI / Cockpit Activity Stream)         │ │ (Xterm.js Drawer / Slide-out)                │
│                                              │ │                                              │
│ [22:01] 🔍 Dev-Level-1 scanned repo-map      │ │ Sub-stream attached to specific actions:     │
│ [22:02] 📝 Planner drafted plan.md           │ │ - Full npm test execution stdout             │
│ [22:04] ✏️ Implementer modified auth.ts      │ │ - Compiler error traces                      │
│ [22:05] 🧪 Reviewer executed Playwright E2E  │ │ - Playwright test runner live feeds          │
│         └── [▶ Expand Terminal Logs (84L)]   │ │                                              │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────┘
```

### 2.1 Event Schema (`agent_events`)

```typescript
export interface AgentEvent {
  id: string;                      // UUIDv7 (time-ordered)
  taskId: string;                  // 'TASK-104'
  workspaceId: string;
  timestamp: string;               // ISO 8601
  tier: 'dev-level-1' | 'dev-level-2' | 'dev-level-3' | 'orchestrator';
  type: 
    | 'tool_call' 
    | 'tool_result' 
    | 'file_slice_view' 
    | 'file_mutation' 
    | 'command_exec' 
    | 'cost_delta' 
    | 'guard_eval' 
    | 'review_signoff';
  summary: string;                 // Human-readable narrative: "Ran test suite: 14 passing"
  payload: Record<string, unknown>;// Structured inputs & outputs
  hasSubStream: boolean;           // True if raw stdout/stderr exists
  subStreamRef?: string;           // Blob or file pointer to raw terminal logs
}
```

---

## 3. Granular Cost & Token Ledger (`llm_calls`)

To maintain complete visibility over AI spend and identify prompt-caching efficiencies, every individual model invocation is recorded into an ACID relational fact table in PostgreSQL.

### 3.1 Relational Schema

```sql
CREATE TABLE llm_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    persona VARCHAR(32) NOT NULL,   -- 'planner' | 'implementer' | 'reviewer'
    model VARCHAR(128) NOT NULL,    -- 'claude-3-5-sonnet-20241022', 'deepseek-v3'
    provider VARCHAR(64) NOT NULL,  -- 'anthropic', 'openrouter', 'ollama'
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cache_read_tokens INT DEFAULT 0,-- Prompt cache hits (e.g., static Layer 1 repo-map)
    cache_write_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10,6) NOT NULL,-- Calculated via LiteLLM cost tables ($0.00 for local)
    latency_ms INT,
    status VARCHAR(16) NOT NULL DEFAULT 'success', -- 'success' | 'rate_limited' | 'error'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_task ON llm_calls(task_id);
CREATE INDEX idx_llm_calls_workspace_date ON llm_calls(workspace_id, created_at);
CREATE INDEX idx_llm_calls_persona ON llm_calls(persona);
```

### 3.2 Key Analytical Rollups
With this schema, the platform calculates real-time insights without heavy external analytics engines:
1. **Persona Efficiency**: Are reasoning models in Dev-Level-1 (Planner) consuming the bulk of task spend compared to fast code synthesis in Dev-Level-3?
2. **Prompt Cache ROI (`cache_read_tokens`)**: Tracks how effectively Layer 1 Topological Repo Map and system instructions hit provider prompt caches, reducing token costs by up to 90%.
3. **Per-Task Runaway Protection**: Provides the exact data feeding the task-level budget circuit breaker (`spendLimitUSD`).

---

## 4. OpenTelemetry (OTLP) Semantic Export (Enterprise Tier)

For self-hosted local solo users, the internal PostgreSQL ledger powers the entire dashboard with **zero additional dependencies or Docker containers**.

For enterprise teams who manage centralized observability through Datadog, Dynatrace, New Relic, or Grafana Tempo, Graywolf supports an **additive OTLP exporter**:

```jsonc
// In project.config.json or organization settings
{
  "telemetry": {
    "otlpExporter": {
      "enabled": true,
      "endpoint": "http://otel-collector.internal:4318/v1/traces",
      "protocol": "http/json", // "http/json" | "grpc"
      "headers": {
        "x-tenant-id": "engineering-prod"
      }
    }
  }
}
```

### 4.1 OpenTelemetry Trace Hierarchy & `gen_ai.*` Attributes

Graywolf maps each autonomous task lifecycle to an OpenTelemetry distributed trace tree:

```
[Trace: Task TASK-104]
 ├── [Span: Phase: Dev-Level-1 Planning]
 │    ├── [Span: Tool: generate_repo_map]
 │    └── [Span: GenAI Call (gen_ai.system=anthropic, gen_ai.request.model=claude-3-5-sonnet)]
 ├── [Span: Phase: Dev-Level-3 Code Implementation]
 │    ├── [Span: Tool: view_file_range]
 │    ├── [Span: Tool: replace_file_content]
 │    └── [Span: GenAI Call (gen_ai.system=deepseek, gen_ai.request.model=deepseek-v3)]
 └── [Span: Phase: Dev-Level-2 In-Container Review]
      ├── [Span: Exec: npm test]
      └── [Span: Exec: playwright test]
```

Standardized attributes emitted conform to OpenTelemetry GenAI Semantic Conventions:
- `gen_ai.operation.name`: `chat`, `generate_code`, `review_patch`
- `gen_ai.system`: `anthropic`, `openai`, `deepseek`, `ollama`
- `gen_ai.request.model`: Virtual alias or underlying model name
- `gen_ai.usage.input_tokens`: Raw prompt tokens
- `gen_ai.usage.output_tokens`: Completion tokens
- `gen_ai.usage.cache_read_tokens`: Cache hits
- `gen_ai.cost.usd`: Calculated cost in dollars

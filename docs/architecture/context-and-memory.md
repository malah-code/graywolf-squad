# Graywolf Squad — Deep-Dive Architecture: Context & Memory Engine

## 1. Executive Summary & Problem Statement

Navigating codebases containing 50,000 to 500,000+ lines of code without blowing token budgets or hallucinating non-existent modules is the central engineering challenge of autonomous coding agents.

### Why Standard RAG (Pure Vector Search) Fails on Source Code
1. **Semantic Inversion Paradox**: Asking *"Where is `processPayment` called?"* matches the *definition* of `processPayment`, never its call-sites or downstream invocations.
2. **Missing Module & Import Context**: Isolated 500-token chunks lose their root packaging namespace, causing LLMs to guess imports (e.g. `import { Tax } from '@/utils'` instead of `@internal/billing/core/tax`).
3. **Flat Text Fallacy**: Code is not natural language prose. It represents a strict structural directed graph: `Repository -> Package/Module -> File -> Class/Interface -> Functions -> AST Call-Graph`.
4. **Token Cost Explosion**: Ingesting entire files on each turn quickly exhausts 128k/200k context windows and incurs massive monetary cost ($0.50-$2.00 per task step).

Graywolf Squad implements a **4-Layer Context Pyramid** inspired by production-proven systems (Aider's Tree-Sitter PageRank repo-map, Sourcegraph SCIP, and Cursor-style surgical slicing).

---

## 2. The 4-Layer Context Pyramid Architecture

```
┌──────────────────────────────────────────────────────────────────┐  ~1,500 Tokens
│ Layer 1: Topological Repo Map (PageRank Centrality over AST)      │  Always In-Prompt
├──────────────────────────────────────────────────────────────────┤  ~2,000 Tokens
│ Layer 2: Symbol Index & Call-Graph (Tree-sitter AST & SCIP/LSP)   │  Queried On-Demand
├──────────────────────────────────────────────────────────────────┤  ~3,000 Tokens
│ Layer 3: Hybrid Lexical + Vector Engine (BM25 / Ripgrep + Dense) │  Discovered via Tools
├──────────────────────────────────────────────────────────────────┤  ~5,000 - 15,000 Tokens
│ Layer 4: Surgical Line Slices & Unified Diffs                    │  Active Workspace
└──────────────────────────────────────────────────────────────────┘
Total Working Token Budget per Turn: ~10,000 - 20,000 tokens
```

---

## 3. Deep-Dive: The Four Layers

### 3.1 Layer 1: Topological Repo Map (Always-in-Context)
* **Goal**: Provide the agent with an accurate 30,000-foot view of the entire repository structure and exported API signatures in under 2,000 tokens.
* **Mechanism**:
  1. Extract all identifier definitions (classes, functions, interfaces, methods) and import/export statements using **Tree-sitter**.
  2. Build an internal directed dependency graph $G = (V, E)$ where nodes $V$ are symbols/files and edges $E$ are `import` or call relationships.
  3. Compute **PageRank centrality** over $G$:
     - Core utilities and domain interfaces imported across multiple modules receive higher rank.
     - Leaf implementations receive lower rank.
  4. Fill a strict token budget (e.g., 1,500 tokens) starting from the highest-ranked symbols down to lowest.
  5. The output renders a compressed, indented outline of the repo:
     ```typescript
     // src/modules/billing/tax-calculator.ts
     export interface TaxRate { country: string; rate: number; }
     export class TaxCalculator {
       constructor(db: DatabaseConnection);
       public calculate(order: OrderPayload): Promise<TaxResult>;
     }
     ```
* **Anti-Hallucination Impact**: The LLM *sees* exact file paths and exported signatures. It cannot invent non-existent files or modules.

---

### 3.2 Layer 2: AST-Based Symbol Index & Call-Graph (Tree-sitter)
* **Goal**: Enable exact programmatic symbol resolution without guessing or reading whole files.
* **Mechanism**:
  - Incremental parsing using `tree-sitter` (via `web-tree-sitter` or Node native bindings).
  - Background indexer maps every symbol to a tuple:
    `{ name, kind, file, lineStart, lineEnd, exported, signature, hash }`.
  - Maintains two relational index tables in PostgreSQL:
    1. `code_symbols`: Primary declarations, type signatures, and HTTP route endpoints.
    2. `code_references`: Caller-callee pairs, import statements, and client API fetch invocations.
* **Mid-Task Hash Verification**:
  - To prevent reviewers from citing stale pre-edit line numbers (e.g. after Dev-Level-3 modifies a file), `find_symbol_definition` and `find_symbol_references` compute a fast xxHash of the target file on disk. If the hash mismatches the index, the query triggers an **immediate synchronous on-demand AST reindex** for that specific file before returning results.
* **Cross-Language Symbol & Route Tracing (Polyglot Bridging & AST Normalization)**:
  - In polyglot repositories (e.g. Go backend + TypeScript/React frontend), standard AST symbol graphs fail at the language boundary. Graywolf elevates **API Route Literals** into first-class cross-language symbols:
    - *Backend Route Group Concatenation*: Frameworks like `chi`, `gin`, `express`, and `FastAPI` commonly register endpoints inside nested route groups (e.g. `r.Route("/api/v1/orgs", func(r chi.Router) { r.Get("/{id}/members", ...) })`). A naive AST scanner looking only at the leaf string literal would see `/{id}/members` and fail to match the frontend's full URL. Graywolf's Tree-sitter visitor maintains an **AST lexical prefix stack** during traversal, concatenating parent route scopes to reconstruct the canonical full path: `/api/v1/orgs/{id}/members`.
    - *Path Parameter Normalization*: Normalizes parameter variations across language idioms (`:id`, `{id}`, `<id>`) into a canonical parameter representation (`/api/v1/orgs/:id/members`).
    - *Frontend Call Extraction (Static Strings & Modern Template Literals - N11a)*: Tree-sitter extracts both static string literals (`fetch('/api/v1/orgs/' + id + '/members')`) and ES6 template literals (`` fetch(`/api/v1/orgs/${orgId}/members`) ``). For template literals, the AST visitor matches static segments and maps dynamic expression slots (`${...}`) to canonical wildcard parameter positions (`/api/v1/orgs/:id/members`), closing the 31.7% unmatched gap in modern React codebases.
    - *Unified Mapping*: `find_symbol_references("/api/v1/orgs/:id/members")` bridges both worlds, returning the Go handler *and* all frontend React components calling that route.
* **OpenAPI Contract Pipeline & `contract.diff` Severity Classification (ADR-049, N11b)**:
  - When any task touches API handlers or clients, the orchestrator generates the OpenAPI schema and compares it against baseline using `openapi-diff`.
  - Emits `.agents/tasks/{TASK_ID}/review/contract.diff` classified into two explicit severity tiers:
    1. **Breaking Changes (Hard Block)**: Removed routes, changed HTTP methods, altered required request parameters, or modified existing response schemas without corresponding frontend updates. Causes immediate review rejection (red-gate) and halts for human resolution.
    2. **Additive Changes (Green Informational Pass)**: Legitimate new endpoints, optional query parameters, or backward-compatible additive response fields. Does NOT block completion; marked with a green checkmark and an informational note in the PR summary.
* **Exposed Agent Tools**:
  - `find_symbol_definition(symbolName, contextFile?)`
  - `find_symbol_references(symbolName)` — supports symbol names and `/api/v1/...` route paths
  - `get_type_contract(typeName)`
  - `get_module_exports(filePath)`
  - `get_contract_diff()` — inspects API contract changes across backend/frontend

---

### 3.3 Layer 3: Hybrid Search (Lexical Ripgrep + Dense pgvector)
* **Goal**: Help agents locate unfamiliar functionality when only concepts or error strings are known.
* **Dual Engines**:
  1. **Lexical Search (Ripgrep / BM25)**:
     - Exact string, regex, route pattern (e.g., `POST /api/v1/tax`), or error message search.
     - Ultra-fast native execution inside the container via `rg`.
  2. **Dense Semantic Search (`pgvector`)**:
     - Embeds module-level docstrings, `README.md` files, API specifications, and architectural summaries (not raw code blocks).
     - Dimension: 768 vectors indexed with `HNSW` (`m=16, ef_construction=64`) using `nomic-embed-text` (Apache 2.0, local Ollama).
  3. **Reciprocal Rank Fusion (RRF)**:
     $$RRF\_Score(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
     Merges lexical matches and semantic matches with $k=60$, ensuring exact keyword hits rise above vague semantic associations.

---

### 3.4 Layer 4: Surgical File Slicing (The Vibe Coding Standard)
* **Goal**: Prevent loading full 2,000-line files into context when only modifying 20 lines.
* **Mechanism**:
  - Agents interact through surgical window tools:
    - `view_file_outline(filePath)`: View symbols and line ranges.
    - `view_file_range(filePath, startLine, endLine)`: Read 50–150 lines around the target area.
    - `replace_file_content(filePath, targetContent, replacementContent)`: Exact contiguous block replacement.
  - Full files are only read if total file length is $< 300$ lines.

---

## 4. Git History & Architectural Memory (Brownfield Secret Weapon)

Raw git diffs are noisy, but git history contains critical architectural rationale.

### 4.1 What Gets Indexed
1. **Conventional Commit Messages & PR Descriptions**:
   - The last 100 merged Pull Requests or milestone commits are embedded in `pgvector`.
   - Answers: *"Why was this bizarre regex added in 2024?"* $\rightarrow$ *"Workaround for Safari Arabic UTF-8 encoding bug"*.
2. **Code Churn & Hotspot Analysis**:
   - Calculate frequency of edits per file over the last 90 days.
   - High-churn files are automatically flagged to Dev-Level-1 (Planner) and Dev-Level-2 (Reviewer) as **High Risk Areas** requiring higher test coverage.

### 4.2 What Is Deliberately Excluded
- Raw commit diffs across historical commits (massive noise, low signal, wastes vector storage).

---

## 5. Virtual Developer Tiers Context Matrix

| Virtual Developer Tier | Context Received | Tool Access | Primary Token Budget |
| :--- | :--- | :--- | :--- |
| **Dev-Level-1 (Lead Architect / Planner)** | Task Brief + Topological Repo Map + Module Summaries + Past Task Memory | `hybrid_search`, `find_symbol_definition`, `web_search` | ~15,000 input tokens |
| **Dev-Level-3 (Senior Implementer)** | `plan.md` + Targeted File Slices + Symbol Definitions | `view_file_range`, `replace_file_content`, `run_command` (tests/lint) | ~20,000 working context |
| **Dev-Level-2 (In-Container Reviewer)** | `plan.md` + Git Patch Diff (`git diff`) + Reference Checker | `find_symbol_references`, `run_command` (eval/test suite) | ~12,000 input tokens |

---

## 6. Open-Source Ecosystem & Integration Plan

To maintain zero vendor lock-in and avoid reinventing established algorithms:

1. **Tree-sitter (`tree-sitter`, `web-tree-sitter`)**:
   - Universal, incremental syntax parser with grammars for TypeScript, JavaScript, Python, Go, Java, Rust, C#, PHP.
2. **`repomix` & Aider `repomap.py` Architecture**:
   - Standardized algorithms for PageRank-based symbol importance filtering.
3. **Ripgrep (`rg`)**:
   - Pre-installed inside sandbox containers for millisecond lexical search.
4. **PostgreSQL 16 + `pgvector`**:
   - Single unified relational store for symbol tables, call references, and architectural embeddings.

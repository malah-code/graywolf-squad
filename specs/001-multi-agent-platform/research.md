# Phase 0 Research: Autonomous Multi-Agent Software Engineering Platform

- **Feature**: `001-multi-agent-platform`
- **Status**: Completed
- **Date**: 2026-09-09

---

## 1. Research Questions & Architectural Resolutions

### 1.1 Container Virtualization & Worktree Mounting Paradox
- **Challenge**: Git worktrees created via `git worktree add` store a pointer file `.git` referencing an absolute host filesystem path (`gitdir: /host/path/.../.git/worktrees/<task>`). Inside an isolated Docker container mount namespace, this host path does not exist, causing `fatal: not a git repository: .git`.
- **Resolution**:
  1. Provision worktrees using relative paths (`--relative-paths` in Git 2.48+ or rewrite the `.git` pointer to `gitdir: ../../.git/worktrees/<task>`).
  2. Mount the main repository's `.git` directory into the container at an identical relative path in read-only mode (`:ro`).
  3. Set `git config --global --add safe.directory /workspace` inside the container entrypoint to prevent ownership mismatch aborts between host UID and container UID.
  4. Explicitly disable background GC (`git config gc.auto 0`) inside the container to prevent pruning remote references.

### 1.2 Concurrency & Atomic File Locking Across Process Boundaries
- **Challenge**: Standard POSIX advisory locks (`fcntl` / `flock`) are unreliable across Docker container bind mounts and host virtualization boundaries.
- **Resolution**:
  - Implement directory creation locks (`mkdir` protocol via `proper-lockfile`).
  - Kernel-level `mkdir` is atomic on all POSIX filesystems (returns `EEXIST` to concurrent callers).
  - Store metadata inside the `.lock` directory containing PID, container ID, and heartbeat timestamp.
  - Automatically recover stale locks when heartbeats exceed 30 seconds.

### 1.3 LLM Gateway & Heterogeneous Model Tiering
- **Challenge**: Running agents purely on frontier models (e.g. Claude 3.5 Sonnet / Opus) for repetitive linting or test loops exhausts API budgets quickly. Open-source or compact models fail at architectural decomposition.
- **Resolution**:
  - Deploy **LiteLLM Proxy** as an intermediary reverse proxy.
  - Expose virtual model aliases mapped to specialized agent roles:
    - `agent-architect`: Frontier reasoning (Claude 3.5 Sonnet / Gemini 1.5 Pro).
    - `agent-coder`: High-throughput code synthesis (DeepSeek-V3 / Haiku).
    - `agent-qa`: Deep reasoning / trace inspection (DeepSeek-R1 / GPT-4o-mini).
    - `agent-reviewer`: Frontier alignment & security (Claude 3.5 Sonnet).
  - Implement Redis-backed rate limiting and circuit breaking (reroute on 3 consecutive HTTP 429/500 errors).

### 1.4 Non-Committing Relay Pattern (`relay.mjs`)
- **Challenge**: LLM agents often prematurely create git commits or dirty branch heads with broken code.
- **Resolution**:
  - All agent executions inside the container run through a lightweight relay harness (`relay.mjs`).
  - Relay traps OS signals, measures execution duration and memory peaks, extracts touched files, and emits `result.json` conforming to `delegate-relay.result.v1`.
  - Zero git commit operations are permitted inside the container. All code changes remain in the working tree as uncommitted modifications until human approval.

---

## 2. Technology Choices & Justifications

| Component | Selected Technology | Alternative Rejected | Justification |
| :--- | :--- | :--- | :--- |
| **Backend Framework** | Node.js 20+ with Fastify | Python FastAPI / Go Gin | Unified TypeScript definitions with the React frontend, high-speed async I/O, native npm ecosystem for `proper-lockfile` and `chokidar`. |
| **Container Engine** | Standard Docker Engine (`/var/run/docker.sock`) | Rootless Podman | Full compatibility with OpenHands action execution server, zero UID mapping translation issues for volume bind-mounts. |
| **Frontend Framework** | React 18+ on Vite | Next.js / Plane fork | No server-side rendering complexity needed; fast SPA development, seamless local WebSocket terminal streaming with Xterm.js. |
| **UI Components** | Tailwind CSS + Shadcn UI | Material UI / AntD | Zero runtime overhead; headless Radix UI primitives copied directly into the project repository. |
| **In-Memory Cache & State** | Valkey (BSD-3-Clause) | Redis | Complete drop-in wire compatibility with Redis without licensing liabilities (avoiding SSPL/RSAL/AGPL entanglements). |
| **Relational & Vector DB** | PostgreSQL 16+ with `pgvector` | Standalone Pinecone | Single ACID relational store; avoids dual-write consistency problems and separate SaaS vendor bills. |

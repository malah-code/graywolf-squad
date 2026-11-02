# Graywolf Squad — Deep-Dive Architecture: Build & Package Cache Optimization

## 1. Executive Summary & Problem Statement

To achieve true agent agility and conversational responsiveness, task sandboxes must achieve a **sub-2 second startup time**. 

In conventional developer workflows, running a clean `npm install` or `pip install` takes between **30 and 120 seconds**, downloading hundreds of megabytes of dependencies across the network. If an autonomous agent suffered this penalty on every task or iteration, developer velocity would collapse, and ephemeral sandboxing would become unviable.

However, naive caching approaches introduce fatal pitfalls:
- **Sharing raw `node_modules` or `.venv` directories across containers**: Leads to native binary libc mismatches, stale symlinks, lockfile corruption, and postinstall script failures across concurrent tasks.
- **Rebuilding Docker images on every `package.json` push**: Reintroduces the 30–120s latency tax at the image-build layer, triggers CI build storms during active feature branches, and consumes excessive disk space.

Graywolf Squad implements a **Two-Tier Cache Architecture** designed to drop package installation times to **2–8 seconds** while maintaining 100% build fidelity and isolation.

---

## 2. The Two-Tier Cache Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATOR / DOCKER HOST                            │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ Tier 1: Persistent Content-Addressable Cache Volume                      │   │
│   │ Volume: pkg-cache-{project_id}                                           │   │
│   │ Holds: ~/.npm, ~/.cache/pip, ~/.cargo/registry, Go module cache          │   │
│   └───────────────────────────────────┬──────────────────────────────────────┘   │
│                                       │ Read-Write Bind Mount                    │
│                     ┌─────────────────┴─────────────────┐                        │
│                     ▼                                   ▼                        │
│   ┌───────────────────────────────────┐   ┌───────────────────────────────────┐  │
│   │ Task Sandbox A (TASK-101)         │   │ Task Sandbox B (TASK-102)         │  │
│   │ - Isolated Git Worktree           │   │ - Isolated Git Worktree           │  │
│   │ - Fresh, local node_modules/      │   │ - Fresh, local node_modules/      │  │
│   │ - npm ci runs in 2-5s (from disk) │   │ - npm ci runs in 2-5s (from disk) │  │
│   └───────────────────────────────────┘   └───────────────────────────────────┘  │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ Tier 2 (Debounced): Pre-Baked Snapshot Image Layer                       │   │
│   │ Triggers: Lockfile changes + 10-minute quiescence window                 │   │
│   │ Uses: BuildKit cache mounts (`--mount=type=cache`)                       │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tier 1: Shared Package-Manager Content-Addressable Cache (Always-On)

### 3.1 Mechanism
Instead of sharing the mutable destination directory (`node_modules` or `.venv`), Graywolf mounts the **underlying package manager's immutable, content-addressable cache directory** as a persistent Docker volume (`pkg-cache-{project_id}`) into the non-root `graywolf` user's home (`/home/graywolf/`).

| Package Manager / Language | Host/Volume Cache Path Mounted | Container Mount Point |
| :--- | :--- | :--- |
| **npm** | `pkg-cache-{project_id}/npm` | `/home/graywolf/.npm` |
| **pnpm** | `pkg-cache-{project_id}/pnpm-store` | `/home/graywolf/.local/share/pnpm/store` |
| **pip / uv** | `pkg-cache-{project_id}/pip` | `/home/graywolf/.cache/pip` (`/home/graywolf/.cache/uv`) |
| **Go (Build Cache)** | `pkg-cache-{project_id}/go-build` | `/home/graywolf/.cache/go-build` |
| **Go (Module Cache)** | `pkg-cache-{project_id}/go-mod` | `/home/graywolf/go/pkg/mod` |
| **Rust / Cargo** | `pkg-cache-{project_id}/cargo-registry`<br>`pkg-cache-{project_id}/cargo-git` | `/home/graywolf/.cargo/registry`<br>`/home/graywolf/.cargo/git` |
| **Java (Maven / Gradle)** | `pkg-cache-{project_id}/maven`<br>`pkg-cache-{project_id}/gradle` | `/home/graywolf/.m2/repository`<br>`/home/graywolf/.gradle/caches` |
| **C# / .NET (NuGet)** | `pkg-cache-{project_id}/nuget` | `/home/graywolf/.nuget/packages` |
| **PHP (Composer)** | `pkg-cache-{project_id}/composer` | `/home/graywolf/.cache/composer` |

### 3.2 Benefits Over Raw `node_modules` Sharing
1. **Zero Native Binary Corruption**: Native C/C++ addons (e.g., `bcrypt`, `sharp`, `esbuild`) compile cleanly against the sandbox container's specific architecture and libc during the local install step.
2. **Deterministic Integrity**: `npm ci`, `go mod download`, or `pip install` still executes a real installation pass, guaranteeing symlinks, monorepo workspace hoisting, and postinstall hooks run properly.
3. **Local Disk Velocity**: Because all package tarballs, wheels, go modules, and crate metadata are read from local SSD storage rather than remote registries, dependency resolution and extraction drops from **30–120s down to 2–8s**.

---

## 4. Tier 2: Debounced Pre-Baked Snapshot Layer (Heavy Projects)

For massive monorepos or Python ML environments where unpacking thousands of packages still exceeds 8 seconds, Graywolf provides an automated snapshot layer:

1. **Repo-Scoped Lockfile Change Detection**: Rather than running global watchers across all 8 languages, the orchestrator scopes its file watcher strictly to the manifest and lockfile patterns discovered during the project's reconnaissance pass (`recon-report.md`):
   - *Node repos*: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`
   - *Python repos*: `poetry.lock`, `Pipfile.lock`, `requirements.txt`
   - *Go repos*: `go.mod`, `go.sum`
   - *Rust repos*: `Cargo.lock`
   - *Java repos*: `gradle.lockfile`, `pom.xml`
   - *C# / .NET repos*: `packages.lock.json`
   - *PHP repos*: `composer.lock`
2. **Debounced Quiescence (10 Minutes)**: To prevent rebuild storms during active development where a developer or agent pushes multiple commits in rapid succession, a 10-minute quiescence timer is enforced.
3. **Background Image Rebuild**: Once the relevant lockfile remains quiet for 10 minutes, a background BullMQ job builds a specialized, pre-warmed snapshot image matching the project's detected stack:

   ```dockerfile
   # Example A: Node.js Monorepo Cache Seed
   # Syntax: docker/dockerfile:1.4
   FROM runner-base AS project-cache
   WORKDIR /cache-seed
   COPY package.json package-lock.json ./
   RUN --mount=type=cache,target=/root/.npm npm ci
   ```

   ```dockerfile
   # Example B: Polyglot (Go + React) Cache Seed
   # Syntax: docker/dockerfile:1.4
   FROM runner-polyglot-node-go AS project-cache
   WORKDIR /cache-seed
   # Pre-seed Go module cache
   COPY go.mod go.sum ./
   RUN --mount=type=cache,target=/root/go/pkg/mod go mod download
   # Pre-seed Frontend npm cache
   COPY web/package.json web/package-lock.json ./web/
   RUN --mount=type=cache,target=/root/.npm npm --prefix ./web ci
   ```

4. Subsequent ephemeral task containers spin up directly from this pre-warmed snapshot image, reaching **sub-second** container readiness.

---

## 5. Mid-Task Package Additions & Post-Merge Cache Warming

### 5.1 Mid-Task Package Additions
When an agent is actively exploring solutions and installs a package (e.g., `npm install axios` or `pip install httpx`):
- **Task Sandbox Isolation**: The new package and lockfile modifications exist strictly inside the task's ephemeral container and Git worktree. The project's baseline snapshot is untouched.
- **Tarball Cache Absorption**: The download is automatically cached inside the Tier 1 persistent package-manager volume (`pkg-cache-{project_id}`). Because tarballs are cryptographically checksummed by registry hashes, this accelerates candidate package installs across tasks with zero risk of cache poisoning.

### 5.2 Post-Merge Cache Warming
When a Pull Request / task is approved and merged:
- The orchestrator fires a background cache-warming job.
- The job executes `npm ci` / `pip install` against the newly merged lockfile into the Tier 1 cache.
- The *next* scheduled task benefits immediately from pre-cached tarballs without experiencing any network download latency.

---

## 6. Performance Benchmark Targets

| Scenario | Cold Network Install | Shared Raw Directory (Anti-pattern) | Graywolf Tier 1 (Tarball Cache) | Graywolf Tier 2 (Pre-Baked Snapshot) |
| :--- | :---: | :---: | :---: | :---: |
| **Fresh Node.js (500 packages)** | 45s | 1s *(High Flakiness Risk)* | **3.8s** *(100% Reliable)* | **0.8s** |
| **Fresh Python ML (PyTorch/Transformers)** | 180s | Broken venv paths | **12s** *(Local Wheels)* | **1.2s** |
| **Subsequent Task with identical lockfile** | 42s | Stale lock conflicts | **2.1s** | **0.6s** |
| **Agent Adds 1 New Package** | 12s | Pollutes baseline | **1.8s** (isolated) | **1.8s** (isolated) |

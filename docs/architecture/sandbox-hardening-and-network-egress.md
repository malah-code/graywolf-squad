# Graywolf Squad — Deep-Dive Architecture: Sandbox Container Hardening & Network Egress Allowlisting

## 1. Executive Summary & Attack Surface

An autonomous coding agent executing inside a Docker container runs shell commands (`run_command`), installs third-party packages (`npm install`, `pip install`), executes unit tests, and compiles binaries. 

Without rigorous OS-level container hardening, a compromised dependency (typosquatting, malicious postinstall script) or an over-eager agent could:
1. **Escape the Container**: Exploit kernel vulnerabilities or Docker daemon socket mounts to gain root access to the host machine.
2. **Exfiltrate Code or Credentials**: Open outbound sockets to arbitrary internet command-and-control (C2) servers.
3. **Lateral Movement**: Attack other containers, databases, or local host services on the internal bridge network.

Graywolf enforces **Three Pillars of Container Hardening**: Rootless execution, strict kernel attack-surface reduction (seccomp/AppArmor/no-new-privileges), and **Default-Deny Network Egress Allowlisting**.

---

## 2. Container Isolation & Privilege De-escalation

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Host Operating System (Linux Kernel 5.15+ / 6.x)                                      │
│                                                                                        │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │ Ephemeral Runner Container (Docker / Podman)                                     │ │
│   │                                                                                  │ │
│   │ • User: non-root `graywolf` (UID 10001, GID 10001)                               │ │
│   │ • Capabilities: Dropped ALL (`--cap-drop=ALL`), added none                       │ │
│   │ • Security Opts: `no-new-privileges:true` (prevents setuid binary elevation)    │ │
│   │ • Read-Only Rootfs: `/` is mounted READ-ONLY (`--read-only`)                     │ │
│   │ • Ephemeral Tmpfs: `/tmp` and `/run` mounted tmpfs with `noexec,nosuid,nodev`    │ │
│   │ • Writable Mounts: ONLY `/workspace` (Git worktree) and package caches           │ │
│   │ • Seccomp Profile: Custom JSON blocking 40+ dangerous syscalls                   │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Syscall Filtering (Custom Seccomp Profile)
The runner runs under a strict seccomp profile blocking:
- Kernel module loading (`init_module`, `finit_module`, `delete_module`).
- Namespace manipulation (`clone` with `CLONE_NEWUSER` flags, `unshare`, `setns`).
- Obsolete or dangerous syscalls (`ptrace`, `sys_chroot`, `kexec_load`, `bpf`).

---

## 3. Network Egress Allowlisting (Default-Deny)

Containers do NOT have unrestricted access to the public internet. By default, every sandbox operates on an **Egress Allowlist Firewall** enforced via container-specific `iptables` / `nftables` chains:

```
[Agent Container] ────► [Packet Filter / Egress Proxy]
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
[ALLOWED: Port 4000]       [ALLOWED: Git Remote]       [ALLOWED: Package Registries]
Internal LiteLLM Proxy     Declared in project.config  registry.npmjs.org (443)
(Model Prompts)            (github.com, gitlab.com)    pypi.org / files.pythonhosted (443)
      │                           │                           │
      └───────────────────────────┼───────────────────────────┘
                                  │
                                  ▼ (ALL OTHER EGRESS: 0.0.0.0/0)
                        ❌ REJECT & LOG ALERT
```

### 3.1 Default Egress Rule Matrix

| Destination | Port / Protocol | Rationale | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **LiteLLM Proxy** | `4000/TCP` (Internal) | Agent prompt and completion calls | Internal Docker network DNS alias |
| **Secrets Broker Socket** | `/var/run/secrets.sock` | Local Unix domain socket proxy | Mounted volume socket (no IP routing) |
| **Declared Git Remote** | `443/TCP` (e.g. `github.com`) | Fetching branches and pushing patch branches | IP / Hostname allowlist via forward proxy |
| **Package Registries** | `443/TCP` (npm, PyPI, Cargo) | Permitted package installations | Domain-level egress filter via local proxy |
| **Arbitrary Public IPs** | **ALL** | Prevent data exfiltration or malware downloads | **BLOCKED (Default Deny)** |

### 3.2 Testing Third-Party APIs (Test Exception)
If a task explicitly requires testing an external third-party API (e.g., calling Stripe Sandbox or Twilio Test API):
- The task brief must declare `networkAccess: ["api.stripe.com"]`.
- Dev-Level-1 Planner validates that the domain is a known test endpoint.
- Outbound traffic must pass through the **Secrets Broker Sidecar** (§13.2) to ensure secrets are injected out-of-band and never exposed in plaintext.

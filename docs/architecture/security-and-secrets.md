# Graywolf Squad — Deep-Dive Architecture: Security & Secret Management

## 1. Executive Summary & Problem Statement

Autonomous multi-agent platforms face unique security hazards that conventional CI/CD or developer tooling never encounters:
1. **Agent Context Leaks**: An agent troubleshooting a failed API call or debugging tests may casually execute `console.log(process.env)` or print HTTP headers, inadvertently committing secrets, API keys, or Git tokens to the agent's LLM context, terminal logs, or git patches.
2. **Database At-Rest Vulnerability**: Standard PostgreSQL installations in self-hosted `docker compose` environments frequently lack filesystem-level encryption, exposing raw credentials in database volume dumps (`pg_dump`) or disk backups.
3. **Friction vs. Security Trade-off**: Forcing developers to enter a master decryption password every time the application boots or spins up a container violates the fundamental **"< 1 second boot, zero-config"** principle defined in ADR-015.

Graywolf Squad implements a zero-trust, out-of-band secret architecture combining **zero-prompt column-level envelope encryption**, an **isolated secrets proxy / sidecar broker**, and **automated regex secret scrubbing**.

---

## 2. Zero-Prompt Column-Level Envelope Encryption

Instead of relying solely on full-disk encryption (which fails if a database dump is leaked) or prompting the user for a master passphrase on boot (which breaks unattended automation), Graywolf implements **Envelope Encryption** at the column level via `pgcrypto` (AES-256):

```
┌────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 16 (Relational & Secret Vault)                              │
│                                                                        │
│  TABLE: secret_vault                                                   │
│  ├── id: UUID                                                          │
│  ├── workspace_id: UUID (RLS Scoped)                                   │
│  ├── secret_name: VARCHAR ('GIT_PAT', 'STRIPE_TEST_KEY')               │
│  └── encrypted_value: BYTEA (AES-256 encrypted via DEK)                │
│  └── encrypted_dek: BYTEA (DEK encrypted via external KEK)             │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Decrypts DEK using KEK
┌───────────────────────────────────┴────────────────────────────────────┐
│ Key Encryption Key (KEK) Storage (Kept OUTSIDE PostgreSQL)              │
│                                                                        │
│ • Local / Solo Mode:                                                   │
│   ~/.graywolf/master.key (chmod 600, generated silently on first boot) │
│                                                                        │
│ • Enterprise / Hybrid SaaS:                                            │
│   HashiCorp Vault / AWS KMS / GCP Cloud KMS plugin                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Benefits
- **Zero Friction**: On initial boot (`docker compose up`), the system creates `~/.graywolf/master.key` with strict filesystem permissions (`chmod 600`). Solo developers never see a password prompt.
- **Backup Safety**: A stolen `pg_dump` or PostgreSQL snapshot does NOT contain the KEK; encrypted secrets cannot be decrypted without physical access to the host's protected key file.
- **Enterprise Ready**: Seamlessly transitions to HashiCorp Vault or Cloud KMS for enterprise teams without altering the database schema.

---

## 3. Out-of-Band Sandbox Secrets Proxy (Zero Environment Exposure)

**The Core Rule**: Real secret values are **NEVER** injected as standard environment variables inside the agent's task sandbox. 

Instead, credentials are provided out-of-band through specialized proxies and local broker sockets:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Task Container Sandbox (Ephemeral)                                                     │
│                                                                                        │
│  ┌─────────────────────────────────┐       ┌──────────────────────────────────────┐   │
│  │ Agent Process (Dev-Level-1/2/3) │       │ Secrets Broker Sidecar (Local Unix)  │   │
│  │                                 │       │                                      │   │
│  │ Calls:                          │       │ Socket: /var/run/secrets.sock        │   │
│  │ git clone / push                │──────►│ Authenticates via short-lived token  │   │
│  │ (via credential.helper)         │       │                                      │   │
│  │                                 │       │ Rewrites outgoing test requests      │   │
│  │ curl -H "X-Mock: stripe-test"   │──────►│ Injects real STRIPE_TEST_KEY         │   │
│  │                                 │       │ Strips secrets from error responses  │   │
│  └─────────────────────────────────┘       └──────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Git Credentials (Git PATs)
- Git operations within the sandbox rely on Git's native `credential.helper`.
- When `git` requires credentials, it queries a local Unix socket managed by the orchestrator.
- The orchestrator provides an ephemeral, short-lived scoped token.
- The agent process never inspects or prints the raw token string.

### 3.2 Model Provider Keys (LiteLLM)
- Governed by ADR-005 (Technology Stack) and ADR-018 (Secrets Architecture). The agent process is configured with:
  ```bash
  OPENAI_BASE_URL=http://litellm-proxy:4000
  OPENAI_API_KEY=sk-graywolf-internal-proxy-token
  ```
- The actual Anthropic, OpenAI, or Gemini provider keys remain strictly within the control plane server and never enter the sandbox container.

### 3.3 Third-Party Test API Keys (Secrets Broker Sidecar)
- For tasks requiring integration testing against third-party sandboxes (e.g. Stripe, SendGrid, Twilio test environments), the task container routes outbound requests through a **Secrets Broker Sidecar** attached to the container network namespace.
- The agent uses placeholder credentials (`sk_test_placeholder_stripe`).
- The broker substitutes the real encrypted credential in-flight on the outbound request, and filters it out of returned headers or stack traces on responses.

---

## 4. Automated Regex Secret Scrubber (Defense-in-Depth)

Even with proxies, an agent or a build tool might output a secret found in a repository `.env.example` or test fixture.

To prevent leaks:
1. **Real-Time Stream Scrubbing**: All terminal stdout/stderr emitted by sandbox containers passes through a high-throughput streaming regex scrubber before being written to disk, sent to Xterm.js, or bundled into PR Review Packets.
2. **Detection Signatures**:
   - High-entropy strings matching common API key patterns (GitHub PATs, AWS Access Keys, OpenAI keys, Slack webhooks, Private Keys).
   - Any secret string currently registered in the project's `secret_vault`.
3. **Replacement**: Detected matches are replaced with `[REDACTED_SECRET_BY_GRAYWOLF]`.

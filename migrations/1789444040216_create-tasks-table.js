/**
 * Canonical PostgreSQL 16 + pgvector Migration
 * Phase 1 — Canonical Data Model, PostgreSQL RLS & Core Schemas
 * Source of Truth: specs/001-multi-agent-platform/data-model.md §2 & docs/implementation-plan-detailed.md Phase 1
 */

exports.up = (pgm) => {
  // 1. Extensions
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);

  // 2. Tenancy Tables (1–7)
  pgm.sql(`
    -- 1. Organizations
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      plan_tier VARCHAR(32) NOT NULL DEFAULT 'community',
      mode VARCHAR(32) NOT NULL DEFAULT 'personal',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 2. Workspaces
    CREATE TABLE workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(org_id, slug)
    );

    -- 3. Users
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      full_name VARCHAR(255),
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 4. Workspace Members
    CREATE TABLE workspace_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(32) NOT NULL DEFAULT 'developer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, user_id)
    );

    -- 5. Workspace Invites
    CREATE TABLE workspace_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) UNIQUE NOT NULL,
      target_role VARCHAR(32) NOT NULL DEFAULT 'developer',
      max_uses INT NOT NULL DEFAULT 1,
      uses_count INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 6. Workspace Member Identities (ADR-080)
    CREATE TABLE workspace_member_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(32) NOT NULL,
      external_provider_user_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, provider, external_provider_user_id)
    );

    -- 7. Sessions
    CREATE TABLE sessions (
      id VARCHAR(128) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 3. Core Tables (8–13)
  pgm.sql(`
    -- 8. Projects
    CREATE TABLE projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(64) NOT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'brownfield',
      git_remote_url TEXT NOT NULL,
      git_provider VARCHAR(32) NOT NULL DEFAULT 'github',
      config_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, slug)
    );

    -- 9. Tasks
    CREATE TABLE tasks (
      id VARCHAR(64) PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title VARCHAR(512) NOT NULL,
      type VARCHAR(32) NOT NULL CHECK (type IN ('feature', 'bug', 'refactor', 'bug-bash-sprint')),
      status VARCHAR(48) NOT NULL DEFAULT 'BACKLOG' CHECK (status IN (
        'BACKLOG', 'QUEUED', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_CLARIFICATION',
        'INTERNAL_REVIEW', 'INTERNAL_REVIEW_FAILED', 'GUARD_VERIFYING', 'QA_FIXING',
        'VERIFICATION_FAILED', 'HUMAN_REVIEW_GATE', 'MERGED', 'REJECTED',
        'ESCALATED', 'UPDATED', 'CANCELLED'
      )),
      priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
      assigned_tier VARCHAR(16),
      blocked_by TEXT[] DEFAULT '{}',
      writable_scope TEXT[] DEFAULT '{}',
      spend_limit_usd NUMERIC(10, 4) DEFAULT 0.0000,
      current_spend_usd NUMERIC(10, 4) DEFAULT 0.0000,
      internal_review_attempts INT DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 10. Task Dependencies
    CREATE TABLE task_dependencies (
      task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_by_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_by_task_id)
    );

    -- 11. Task Artifacts
    CREATE TABLE task_artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      artifact_type VARCHAR(32) NOT NULL,
      authored_by VARCHAR(16),
      file_path TEXT NOT NULL,
      content_hash VARCHAR(64) NOT NULL,
      embedding vector(768),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 12. Escalations
    CREATE TABLE escalations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      escalation_type VARCHAR(32) NOT NULL,
      agent_tier VARCHAR(16) NOT NULL,
      emitted_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolution VARCHAR(16)
    );

    -- 13. Task Locks
    CREATE TABLE task_locks (
      task_id VARCHAR(64) PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      pid INT NOT NULL,
      container_id VARCHAR(128),
      acquired_at BIGINT NOT NULL,
      last_heartbeat BIGINT NOT NULL,
      stale_timeout_ms INT NOT NULL DEFAULT 30000
    );
  `);

  // 4. Observability & Gates Tables (14–16)
  pgm.sql(`
    -- 14. LLM Calls (ADR-017, ADR-081)
    CREATE TABLE llm_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      persona VARCHAR(32) NOT NULL,
      model VARCHAR(128) NOT NULL,
      provider VARCHAR(64) NOT NULL,
      input_tokens INT NOT NULL,
      output_tokens INT NOT NULL,
      cache_read_tokens INT DEFAULT 0,
      cache_write_tokens INT DEFAULT 0,
      cost_usd NUMERIC(10, 6),
      latency_ms INT,
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 15. Task Gate Decisions (ADR-079)
    CREATE TABLE task_gate_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      gate VARCHAR(32) NOT NULL,
      question TEXT NOT NULL,
      result JSONB NOT NULL,
      confidence NUMERIC(4, 3) NOT NULL,
      latency_ms INT NOT NULL,
      model_backend VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 16. Review Evidence
    CREATE TABLE review_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      command_type VARCHAR(32) NOT NULL,
      command TEXT NOT NULL,
      exit_code INT NOT NULL,
      duration_ms INT NOT NULL,
      stdout_summary TEXT,
      stderr_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 5. Security & Calibration Tables (17–19)
  pgm.sql(`
    -- 17. Secret Vault
    CREATE TABLE secret_vault (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      secret_name VARCHAR(128) NOT NULL,
      encrypted_value BYTEA NOT NULL,
      encrypted_dek BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(workspace_id, secret_name)
    );

    -- 18. MCP Servers
    CREATE TABLE mcp_servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name VARCHAR(128) NOT NULL,
      transport VARCHAR(32) NOT NULL,
      command_or_url TEXT NOT NULL,
      secret_refs TEXT[] DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    );

    -- 19. Confidence Calibration
    CREATE TABLE confidence_calibration (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id VARCHAR(64) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      model_id VARCHAR(64) NOT NULL,
      model_version VARCHAR(32) NOT NULL,
      file_path TEXT NOT NULL,
      file_language VARCHAR(32),
      file_type VARCHAR(32),
      confidence_score NUMERIC(3, 2) NOT NULL,
      justification TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 6. Learning & Context Tables (20–24)
  pgm.sql(`
    -- 20. Project Lessons (ADR-022, ADR-051)
    CREATE TABLE project_lessons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      is_org_wide BOOLEAN NOT NULL DEFAULT false,
      source_task_id VARCHAR(64) REFERENCES tasks(id) ON DELETE SET NULL,
      provenance VARCHAR(32) NOT NULL,
      confidence_score NUMERIC(3, 2) NOT NULL,
      category VARCHAR(32) NOT NULL,
      trigger_scope TEXT[] NOT NULL,
      summary TEXT NOT NULL,
      rule_content TEXT NOT NULL,
      embedding vector(768),
      times_applied INT DEFAULT 0,
      times_rejected INT DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      last_applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 21. Code Symbols
    CREATE TABLE code_symbols (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      kind VARCHAR(32) NOT NULL,
      file_path TEXT NOT NULL,
      line_start INT NOT NULL,
      line_end INT NOT NULL,
      exported BOOLEAN DEFAULT false,
      signature TEXT,
      hash VARCHAR(64) NOT NULL
    );

    -- 22. Code References
    CREATE TABLE code_references (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      caller_symbol_id UUID REFERENCES code_symbols(id) ON DELETE CASCADE,
      callee_symbol_id UUID REFERENCES code_symbols(id) ON DELETE CASCADE,
      reference_type VARCHAR(16) NOT NULL
    );

    -- 23. Skills
    CREATE TABLE skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(64) NOT NULL,
      description VARCHAR(128) NOT NULL,
      version VARCHAR(32) NOT NULL DEFAULT '0.1.0',
      origin VARCHAR(32) NOT NULL DEFAULT 'agent-created',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      pinned BOOLEAN NOT NULL DEFAULT false,
      file_path TEXT NOT NULL,
      usage_count INT NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    );

    -- 24. Addon Registry (ADR-080)
    CREATE TABLE addon_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      package_name VARCHAR(255) NOT NULL,
      addon_type VARCHAR(32) NOT NULL,
      tier VARCHAR(32) NOT NULL,
      shadow_state VARCHAR(32) NOT NULL DEFAULT 'shadow',
      shadow_run_count INT NOT NULL DEFAULT 0,
      shadow_discard_rate NUMERIC(4, 3) NOT NULL DEFAULT 0.000,
      content_hash VARCHAR(64),
      approved_at TIMESTAMPTZ,
      approved_by VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, package_name)
    );
  `);

  // 7. Performance & Integrity Indexes
  pgm.sql(`
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_project ON tasks(project_id);
    CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);
    CREATE INDEX idx_artifacts_task ON task_artifacts(task_id);
    CREATE INDEX idx_dependencies_task ON task_dependencies(task_id);
    CREATE INDEX idx_dependencies_blocker ON task_dependencies(blocked_by_task_id);
    CREATE INDEX idx_llm_calls_task ON llm_calls(task_id);
    CREATE INDEX idx_llm_calls_workspace_date ON llm_calls(workspace_id, created_at);
    CREATE INDEX idx_llm_calls_persona ON llm_calls(persona);
    CREATE INDEX idx_task_gate_decisions_task ON task_gate_decisions(task_id);
    CREATE INDEX idx_task_gate_decisions_gate ON task_gate_decisions(gate, created_at DESC);
    CREATE INDEX idx_lessons_project ON project_lessons(project_id);
    CREATE INDEX idx_lessons_workspace ON project_lessons(workspace_id);
    CREATE INDEX idx_symbols_project ON code_symbols(project_id);
    CREATE INDEX idx_symbols_name ON code_symbols(name);
    CREATE INDEX idx_references_project ON code_references(project_id);
    CREATE INDEX idx_confidence_calibration_agg ON confidence_calibration(workspace_id, file_language, file_type);
    CREATE INDEX idx_workspace_invites_hash ON workspace_invites(token_hash);
  `);

  // 8. Row-Level Security (RLS) Policies (ADR-015, ADR-051)
  const rlsTables = [
    'tasks',
    'task_artifacts',
    'llm_calls',
    'task_gate_decisions',
    'review_evidence',
    'secret_vault',
    'mcp_servers',
    'confidence_calibration',
    'code_symbols',
    'code_references',
    'skills',
    'addon_registry',
    'escalations',
    'task_locks',
  ];

  for (const table of rlsTables) {
    pgm.sql(`
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY workspace_isolation ON ${table}
        FOR ALL
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID);
    `);
  }

  // Dual workspace + org-wide policy for project_lessons (ADR-051)
  pgm.sql(`
    ALTER TABLE project_lessons ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_lessons FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_and_org_lesson_isolation ON project_lessons
      FOR ALL
      USING (
        (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID)
        OR
        (is_org_wide = true AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
      )
      WITH CHECK (
        workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::UUID
        AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID
      );
  `);
};

exports.down = (pgm) => {
  // Drop tables in reverse dependency order
  pgm.sql(`
    DROP TABLE IF EXISTS addon_registry CASCADE;
    DROP TABLE IF EXISTS skills CASCADE;
    DROP TABLE IF EXISTS code_references CASCADE;
    DROP TABLE IF EXISTS code_symbols CASCADE;
    DROP TABLE IF EXISTS project_lessons CASCADE;
    DROP TABLE IF EXISTS confidence_calibration CASCADE;
    DROP TABLE IF EXISTS mcp_servers CASCADE;
    DROP TABLE IF EXISTS secret_vault CASCADE;
    DROP TABLE IF EXISTS review_evidence CASCADE;
    DROP TABLE IF EXISTS task_gate_decisions CASCADE;
    DROP TABLE IF EXISTS llm_calls CASCADE;
    DROP TABLE IF EXISTS task_locks CASCADE;
    DROP TABLE IF EXISTS escalations CASCADE;
    DROP TABLE IF EXISTS task_artifacts CASCADE;
    DROP TABLE IF EXISTS task_dependencies CASCADE;
    DROP TABLE IF EXISTS tasks CASCADE;
    DROP TABLE IF EXISTS projects CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS workspace_member_identities CASCADE;
    DROP TABLE IF EXISTS workspace_invites CASCADE;
    DROP TABLE IF EXISTS workspace_members CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS workspaces CASCADE;
    DROP TABLE IF EXISTS organizations CASCADE;
  `);
};

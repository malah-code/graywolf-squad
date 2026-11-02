-- ========================================
-- Provider Keys Table
-- ========================================

CREATE TABLE provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  provider provider_t NOT NULL,
  vault_secret_id UUID NOT NULL,
  label TEXT,
  key_hint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_valid BOOLEAN,
  last_validated_at TIMESTAMPTZ,
  last_validation_error TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add check constraints
ALTER TABLE provider_keys
  ADD CONSTRAINT chk_provider_keys_label_length
    CHECK (label IS NULL OR LENGTH(TRIM(label)) <= 100),
  ADD CONSTRAINT chk_provider_keys_key_hint_format
    CHECK (key_hint IS NULL OR key_hint ~ '^[A-Za-z0-9_-]{2,16}$');

-- Add indexes
CREATE UNIQUE INDEX uq_provider_keys_one_active ON provider_keys(brand_id, provider) WHERE is_active;
CREATE INDEX idx_provider_keys_lookup ON provider_keys(brand_id, provider, created_at DESC);

-- Add comments
COMMENT ON TABLE provider_keys IS 'API key metadata for image generation providers';
COMMENT ON COLUMN provider_keys.id IS 'Provider key ID (UUID)';
COMMENT ON COLUMN provider_keys.brand_id IS 'Owning brand';
COMMENT ON COLUMN provider_keys.provider IS 'Provider type (openai or gemini)';
COMMENT ON COLUMN provider_keys.vault_secret_id IS 'Reference to Vault secret storing the actual key';
COMMENT ON COLUMN provider_keys.label IS 'User-assigned label (max 100 characters)';
COMMENT ON COLUMN provider_keys.key_hint IS 'Last N chars of key for display (2-16 chars)';
COMMENT ON COLUMN provider_keys.is_active IS 'Whether this is the active key for the provider';
COMMENT ON COLUMN provider_keys.is_valid IS 'Last validation result';
COMMENT ON COLUMN provider_keys.last_validated_at IS 'Last validation timestamp';
COMMENT ON COLUMN provider_keys.last_validation_error IS 'Error from last validation';
COMMENT ON COLUMN provider_keys.last_used_at IS 'Last generation usage timestamp';

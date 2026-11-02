-- ========================================
-- Generations Table
-- ========================================

CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  provider provider_t NOT NULL,
  model TEXT NOT NULL,
  platform_preset platform_preset_t NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  logo_mode logo_mode_t NOT NULL DEFAULT 'none',
  status generation_status_t NOT NULL DEFAULT 'pending',
  provider_request_id TEXT,
  image_path TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add check constraints
ALTER TABLE generations
  ADD CONSTRAINT chk_generations_prompt_length
    CHECK (LENGTH(TRIM(prompt)) >= 3 AND LENGTH(TRIM(prompt)) <= 4000),
  ADD CONSTRAINT chk_generations_model_length
    CHECK (LENGTH(TRIM(model)) >= 3 AND LENGTH(TRIM(model)) <= 100),
  ADD CONSTRAINT chk_generations_dimensions
    CHECK (width >= 256 AND width <= 4096 AND height >= 256 AND height <= 4096),
  ADD CONSTRAINT chk_generations_image_path_format
    CHECK (image_path IS NULL OR image_path ~ '^brands/[0-9a-f-]+/generations/[0-9a-f-]+\.png$'),
  ADD CONSTRAINT chk_generations_status_succeeded
    CHECK (
      status != 'succeeded' OR (
        image_path IS NOT NULL AND
        error_code IS NULL AND
        error_message IS NULL AND
        completed_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT chk_generations_status_failed
    CHECK (
      status != 'failed' OR (
        image_path IS NULL AND
        error_code IS NOT NULL AND
        completed_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT chk_generations_status_pending_processing
    CHECK (
      status NOT IN ('pending', 'processing') OR (
        image_path IS NULL AND
        error_code IS NULL AND
        error_message IS NULL AND
        completed_at IS NULL
      )
    );

-- Add indexes
CREATE INDEX idx_generations_brand_created ON generations(brand_id, created_at DESC);
CREATE INDEX idx_generations_brand_status_created ON generations(brand_id, status, created_at DESC);
CREATE INDEX idx_generations_brand_provider_created ON generations(brand_id, provider, created_at DESC);

-- Add comments
COMMENT ON TABLE generations IS 'Image generation requests and outcomes';
COMMENT ON COLUMN generations.id IS 'Generation ID (UUID)';
COMMENT ON COLUMN generations.brand_id IS 'Owning brand';
COMMENT ON COLUMN generations.prompt IS 'User prompt (3-4000 characters)';
COMMENT ON COLUMN generations.provider IS 'AI provider (openai or gemini)';
COMMENT ON COLUMN generations.model IS 'Model identifier (3-100 characters)';
COMMENT ON COLUMN generations.platform_preset IS 'Target social platform size';
COMMENT ON COLUMN generations.width IS 'Output width in pixels (256-4096)';
COMMENT ON COLUMN generations.height IS 'Output height in pixels (256-4096)';
COMMENT ON COLUMN generations.logo_mode IS 'Logo handling mode';
COMMENT ON COLUMN generations.status IS 'Lifecycle status';
COMMENT ON COLUMN generations.provider_request_id IS 'Provider request ID for tracking';
COMMENT ON COLUMN generations.image_path IS 'Storage path to generated image';
COMMENT ON COLUMN generations.error_code IS 'Error code on failure';
COMMENT ON COLUMN generations.error_message IS 'Error description on failure';
COMMENT ON COLUMN generations.completed_at IS 'Timestamp when generation completed (success or failure)';

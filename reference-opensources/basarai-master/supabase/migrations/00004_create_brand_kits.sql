-- ========================================
-- Brand Kits Table
-- ========================================

CREATE TABLE brand_kits (
  brand_id UUID PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  tagline TEXT,
  tone tone_t,
  audience TEXT,
  colors TEXT[] NOT NULL DEFAULT '{}',
  avoid_words TEXT,
  summary TEXT,
  status kit_status_t NOT NULL DEFAULT 'not_started',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add check constraints
ALTER TABLE brand_kits
  ADD CONSTRAINT chk_brand_kits_tagline_length
    CHECK (tagline IS NULL OR LENGTH(TRIM(tagline)) <= 160),
  ADD CONSTRAINT chk_brand_kits_audience_length
    CHECK (audience IS NULL OR (LENGTH(TRIM(audience)) >= 2 AND LENGTH(TRIM(audience)) <= 500)),
  ADD CONSTRAINT chk_brand_kits_colors_count
    CHECK (cardinality(colors) <= 3),
  ADD CONSTRAINT chk_brand_kits_colors_format
    CHECK (all_hex_colors(colors)),
  ADD CONSTRAINT chk_brand_kits_status_complete_consistency
    CHECK (
      (status = 'complete' AND tone IS NOT NULL AND audience IS NOT NULL AND cardinality(colors) >= 1)
      OR
      (status != 'complete')
    ),
  ADD CONSTRAINT chk_brand_kits_completed_at_consistency
    CHECK (
      (status = 'complete' AND completed_at IS NOT NULL)
      OR
      (status != 'complete' AND completed_at IS NULL)
    );

-- Add comments
COMMENT ON TABLE brand_kits IS 'Brand identity questionnaire answers - one-to-one with brands';
COMMENT ON COLUMN brand_kits.brand_id IS 'Brand ID (PK, FK to brands)';
COMMENT ON COLUMN brand_kits.tagline IS 'Brand slogan (max 160 characters)';
COMMENT ON COLUMN brand_kits.tone IS 'Brand tone of voice';
COMMENT ON COLUMN brand_kits.audience IS 'Target audience (2-500 characters)';
COMMENT ON COLUMN brand_kits.colors IS 'Brand colors (array of hex codes, max 3)';
COMMENT ON COLUMN brand_kits.avoid_words IS 'Words/themes to avoid';
COMMENT ON COLUMN brand_kits.summary IS 'Derived brand context summary';
COMMENT ON COLUMN brand_kits.status IS 'Completion status';
COMMENT ON COLUMN brand_kits.completed_at IS 'Timestamp when status became complete';

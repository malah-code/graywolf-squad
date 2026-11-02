-- ========================================
-- Brands Table
-- ========================================

CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add check constraints
ALTER TABLE brands
  ADD CONSTRAINT chk_brands_name_length
    CHECK (LENGTH(TRIM(name)) >= 2 AND LENGTH(TRIM(name)) <= 120),
  ADD CONSTRAINT chk_brands_logo_path_format
    CHECK (logo_path IS NULL OR logo_path ~ '^brands/[0-9a-f-]+/logo\.[A-Za-z0-9]+$');

-- Add indexes
CREATE UNIQUE INDEX uq_brands_owner_name_ci ON brands(owner_user_id, lower(name));
CREATE INDEX idx_brands_owner_created ON brands(owner_user_id, created_at DESC);

-- Add comments
COMMENT ON TABLE brands IS 'Business brands owned by users';
COMMENT ON COLUMN brands.id IS 'Brand ID (UUID)';
COMMENT ON COLUMN brands.owner_user_id IS 'User who owns this brand';
COMMENT ON COLUMN brands.name IS 'Brand display name (2-120 characters)';
COMMENT ON COLUMN brands.logo_path IS 'Storage path for brand logo';

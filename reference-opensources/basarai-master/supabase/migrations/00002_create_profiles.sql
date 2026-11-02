-- ========================================
-- Profiles Table
-- ========================================

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add check constraints
ALTER TABLE profiles
  ADD CONSTRAINT chk_profiles_full_name_length
    CHECK (full_name IS NULL OR (LENGTH(TRIM(full_name)) >= 2 AND LENGTH(TRIM(full_name)) <= 120)),
  ADD CONSTRAINT chk_profiles_avatar_url_format
    CHECK (avatar_url IS NULL OR avatar_url ~ '^https?://.+');

-- Add comment
COMMENT ON TABLE profiles IS 'User profile information - one-to-one with auth.users';
COMMENT ON COLUMN profiles.user_id IS 'User ID from auth.users';
COMMENT ON COLUMN profiles.full_name IS 'User display name (2-120 characters when provided)';
COMMENT ON COLUMN profiles.avatar_url IS 'URL to user avatar image (must be valid HTTP/HTTPS URL)';

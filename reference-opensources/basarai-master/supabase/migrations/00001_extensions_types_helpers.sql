-- Enable pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========================================
-- Custom Types (Enums)
-- ========================================

-- Provider enum for API key providers
CREATE TYPE provider_t AS ENUM ('openai', 'gemini');

-- Tone enum for brand voice
CREATE TYPE tone_t AS ENUM ('formal', 'casual', 'playful', 'professional', 'friendly');

-- Logo mode enum for image generation
CREATE TYPE logo_mode_t AS ENUM ('none', 'prompt', 'watermark', 'both');

-- Brand kit status enum
CREATE TYPE kit_status_t AS ENUM ('not_started', 'in_progress', 'complete');

-- Generation status enum
CREATE TYPE generation_status_t AS ENUM ('pending', 'processing', 'succeeded', 'failed');

-- Platform preset enum for social media platforms
CREATE TYPE platform_preset_t AS ENUM (
  'instagram_post',
  'instagram_story',
  'facebook_post',
  'facebook_story',
  'twitter_post',
  'twitter_header',
  'linkedin_post',
  'linkedin_banner',
  'pinterest_pin',
  'tiktok_video',
  'youtube_thumbnail',
  'youtube_banner',
  'snapchat_story'
);

-- ========================================
-- Helper Functions
-- ========================================

-- Function to automatically set updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to validate that all colors are in hex format (#RRGGBB)
CREATE OR REPLACE FUNCTION all_hex_colors(TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM unnest($1) AS color
    WHERE color !~ '^#[0-9A-Fa-f]{6}$'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

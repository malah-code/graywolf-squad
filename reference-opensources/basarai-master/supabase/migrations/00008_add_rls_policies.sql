-- ========================================
-- RLS Policies
-- ========================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

-- Force RLS (no one can bypass)
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
ALTER TABLE brand_kits FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE generations FORCE ROW LEVEL SECURITY;

-- ========================================
-- Helper Functions
-- ========================================

-- Function to check if current user owns a brand
CREATE OR REPLACE FUNCTION is_brand_owner(brand_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM brands
    WHERE brands.id = $1
      AND brands.owner_user_id = auth.uid()
  );
END;
$$;

-- ========================================
-- Profiles RLS Policies
-- ========================================

-- Users can only see their own profile
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can only insert their own profile (auto-created via trigger)
CREATE POLICY profiles_insert_own ON profiles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own profile
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own profile
CREATE POLICY profiles_delete_own ON profiles
  FOR DELETE
  USING (user_id = auth.uid());

-- ========================================
-- Brands RLS Policies
-- ========================================

-- Users can only see their own brands
CREATE POLICY brands_select_own ON brands
  FOR SELECT
  USING (owner_user_id = auth.uid());

-- Users can only insert their own brands
CREATE POLICY brands_insert_own ON brands
  FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

-- Users can only update their own brands
CREATE POLICY brands_update_own ON brands
  FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Users can only delete their own brands
CREATE POLICY brands_delete_own ON brands
  FOR DELETE
  USING (owner_user_id = auth.uid());

-- ========================================
-- Brand Kits RLS Policies
-- ========================================

-- Users can only see brand kits for brands they own
CREATE POLICY brand_kits_select_own ON brand_kits
  FOR SELECT
  USING (is_brand_owner(brand_id));

-- Users can only insert brand kits for brands they own
CREATE POLICY brand_kits_insert_own ON brand_kits
  FOR INSERT
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only update brand kits for brands they own
CREATE POLICY brand_kits_update_own ON brand_kits
  FOR UPDATE
  USING (is_brand_owner(brand_id))
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only delete brand kits for brands they own
CREATE POLICY brand_kits_delete_own ON brand_kits
  FOR DELETE
  USING (is_brand_owner(brand_id));

-- ========================================
-- Provider Keys RLS Policies
-- ========================================

-- Users can only see provider keys for brands they own
CREATE POLICY provider_keys_select_own ON provider_keys
  FOR SELECT
  USING (is_brand_owner(brand_id));

-- Users can only insert provider keys for brands they own
CREATE POLICY provider_keys_insert_own ON provider_keys
  FOR INSERT
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only update provider keys for brands they own
CREATE POLICY provider_keys_update_own ON provider_keys
  FOR UPDATE
  USING (is_brand_owner(brand_id))
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only delete provider keys for brands they own
CREATE POLICY provider_keys_delete_own ON provider_keys
  FOR DELETE
  USING (is_brand_owner(brand_id));

-- ========================================
-- Generations RLS Policies
-- ========================================

-- Users can only see generations for brands they own
CREATE POLICY generations_select_own ON generations
  FOR SELECT
  USING (is_brand_owner(brand_id));

-- Users can only insert generations for brands they own
CREATE POLICY generations_insert_own ON generations
  FOR INSERT
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only update generations for brands they own
CREATE POLICY generations_update_own ON generations
  FOR UPDATE
  USING (is_brand_owner(brand_id))
  WITH CHECK (is_brand_owner(brand_id));

-- Users can only delete generations for brands they own
CREATE POLICY generations_delete_own ON generations
  FOR DELETE
  USING (is_brand_owner(brand_id));

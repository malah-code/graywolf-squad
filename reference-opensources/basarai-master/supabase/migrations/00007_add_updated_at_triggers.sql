-- ========================================
-- Updated At Triggers
-- ========================================

-- Create trigger for profiles
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Create trigger for brands
CREATE TRIGGER trigger_brands_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Create trigger for brand_kits
CREATE TRIGGER trigger_brand_kits_updated_at
  BEFORE UPDATE ON brand_kits
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Create trigger for provider_keys
CREATE TRIGGER trigger_provider_keys_updated_at
  BEFORE UPDATE ON provider_keys
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Create trigger for generations
CREATE TRIGGER trigger_generations_updated_at
  BEFORE UPDATE ON generations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

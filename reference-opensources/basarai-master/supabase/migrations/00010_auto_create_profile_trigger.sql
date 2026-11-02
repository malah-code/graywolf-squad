-- ========================================
-- Auto-Create Profile Trigger
-- ========================================

-- Function to auto-create profile when new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'full_name'),
    (NEW.raw_user_meta_data->>'avatar_url')
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger to call the function on user insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Add comments
COMMENT ON FUNCTION handle_new_user() IS 'Auto-creates profile row when new user signs up via Supabase Auth';

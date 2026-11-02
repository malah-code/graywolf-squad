-- Fix public.insert_vault_secret to use vault.create_secret() instead of
-- direct INSERT INTO vault.secrets.
--
-- The previous implementation (migration 00012) did a raw INSERT, which fires
-- Vault's BEFORE INSERT encryption trigger. That trigger calls the pgsodium
-- function _crypto_aead_det_noncegen, and the SECURITY DEFINER function owner
-- does not have permission to invoke pgsodium helpers on hosted Supabase.
-- Result: `POST /brands/{id}/keys` returned 502 with
--   "permission denied for function _crypto_aead_det_noncegen" (SQLSTATE 42501).
--
-- vault.create_secret(secret text, name text, description text) is the
-- Supabase-recommended entry point — it has the right privileges baked in.
-- See: https://supabase.com/docs/guides/database/vault

CREATE OR REPLACE FUNCTION public.insert_vault_secret(name text, secret text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  new_id := vault.create_secret(secret, name);
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_vault_secret(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_vault_secret(text, text) TO service_role;
-- Vault RPC helper functions for provider key management
-- All functions use SECURITY DEFINER and are restricted to service_role only

CREATE OR REPLACE FUNCTION public.insert_vault_secret(name text, secret text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name) VALUES (secret, name) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_vault_secret(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_vault_secret(text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.read_vault_secret(secret_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  decrypted text;
BEGIN
  SELECT decrypted_secret INTO decrypted FROM vault.decrypted_secrets WHERE id = secret_id;
  RETURN decrypted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.read_vault_secret(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_vault_secret(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.delete_vault_secret(secret_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = secret_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_vault_secret(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vault_secret(uuid) TO service_role;

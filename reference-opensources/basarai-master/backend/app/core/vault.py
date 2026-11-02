from app.core.supabase import get_service_client


def store_secret(name: str, value: str) -> str:
    client = get_service_client()
    resp = client.rpc("insert_vault_secret", {"name": name, "secret": value}).execute()
    return resp.data


def read_secret(secret_id: str) -> str | None:
    client = get_service_client()
    resp = client.rpc("read_vault_secret", {"secret_id": secret_id}).execute()
    return resp.data


def delete_secret(secret_id: str) -> None:
    client = get_service_client()
    client.rpc("delete_vault_secret", {"secret_id": secret_id}).execute()

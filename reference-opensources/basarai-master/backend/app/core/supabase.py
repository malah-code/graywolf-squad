from functools import lru_cache
from supabase import Client, ClientOptions, create_client

from app.config import settings


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SECRET_KEY,
        options=ClientOptions(postgrest_client_timeout=30, storage_client_timeout=30),
    )

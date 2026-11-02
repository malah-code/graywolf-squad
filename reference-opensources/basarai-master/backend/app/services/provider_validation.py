import logging

import httpx

logger = logging.getLogger(__name__)


async def validate_openai_key(api_key: str) -> tuple[bool | None, str | None]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code == 200:
                return (True, None)
            if resp.status_code == 401:
                try:
                    message = resp.json()["error"]["message"]
                except ValueError:
                    message = "Invalid API key"
                return (False, message)
            return (False, f"Unexpected status code: {resp.status_code}")
    except httpx.TimeoutException:
        return (None, "Provider API timed out")
    except httpx.HTTPError:
        logger.exception("OpenAI validation request failed")
        return (None, "Provider API request failed")


async def validate_gemini_key(api_key: str) -> tuple[bool | None, str | None]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": api_key},
                params={"pageSize": "1"},
            )
            if resp.status_code == 200:
                return (True, None)
            if resp.status_code in (400, 403):
                try:
                    data = resp.json()
                    message = data.get("error", {}).get("message", "Invalid API key")
                except ValueError:
                    message = "Invalid API key"
                return (False, message)
            return (False, f"Unexpected status code: {resp.status_code}")
    except httpx.TimeoutException:
        return (None, "Provider API timed out")
    except httpx.HTTPError:
        logger.exception("Gemini validation request failed")
        return (None, "Provider API request failed")


async def validate_provider_key(provider: str, api_key: str) -> tuple[bool | None, str | None]:
    logger.debug("Validating %s key", provider)
    if provider == "openai":
        return await validate_openai_key(api_key)
    if provider == "gemini":
        return await validate_gemini_key(api_key)
    return (False, f"Unsupported provider: {provider}")

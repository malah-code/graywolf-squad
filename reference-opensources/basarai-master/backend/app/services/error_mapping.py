import httpx

ERROR_USER_MESSAGES: dict[str, str] = {
    "INVALID_KEY":           "Your provider key was rejected. Please check your keys.",
    "RATE_LIMITED":          "The provider is currently rate-limiting your account. Please try again in a moment.",
    "CONTENT_POLICY":        "The provider refused this prompt due to its content policy. Please try a different description.",
    "TIMEOUT":               "The request took too long to complete. Please try again.",
    "NETWORK":               "Could not reach the provider. Please check your connection and try again.",
    "EMPTY_RESPONSE":        "The provider returned no image. Please try again.",
    "PROVIDER_CLIENT_ERROR": "The provider rejected this request. Please try again or adjust your prompt.",
    "PROVIDER_SERVER_ERROR": "The provider service is temporarily unavailable. Please try again.",
}


def classify_provider_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, httpx.TimeoutException):
        return ("TIMEOUT", ERROR_USER_MESSAGES["TIMEOUT"])

    if isinstance(exc, (httpx.ConnectError, httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError)):
        return ("NETWORK", ERROR_USER_MESSAGES["NETWORK"])

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 401:
            return ("INVALID_KEY", ERROR_USER_MESSAGES["INVALID_KEY"])
        if status == 403:
            body = exc.response.text.lower() if exc.response is not None else ""
            if (
                "api key" in body
                or "permission" in body
                or "credential" in body
            ):
                return ("INVALID_KEY", ERROR_USER_MESSAGES["INVALID_KEY"])
            return ("PROVIDER_CLIENT_ERROR", ERROR_USER_MESSAGES["PROVIDER_CLIENT_ERROR"])
        if status == 429:
            return ("RATE_LIMITED", ERROR_USER_MESSAGES["RATE_LIMITED"])
        if status in (400, 422):
            body = exc.response.text.lower() if exc.response is not None else ""
            if "policy" in body or "safety" in body or "blocked" in body:
                return ("CONTENT_POLICY", ERROR_USER_MESSAGES["CONTENT_POLICY"])
            return ("PROVIDER_CLIENT_ERROR", ERROR_USER_MESSAGES["PROVIDER_CLIENT_ERROR"])
        if 400 <= status < 500:
            return ("PROVIDER_CLIENT_ERROR", ERROR_USER_MESSAGES["PROVIDER_CLIENT_ERROR"])
        if 500 <= status < 600:
            return ("PROVIDER_SERVER_ERROR", ERROR_USER_MESSAGES["PROVIDER_SERVER_ERROR"])

    return ("PROVIDER_SERVER_ERROR", ERROR_USER_MESSAGES["PROVIDER_SERVER_ERROR"])

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple, Union

from dotenv import load_dotenv

try:
    from openai import AsyncOpenAI, OpenAI
    from openai import APIError, APIStatusError, APITimeoutError, RateLimitError
except ImportError:  # pragma: no cover - handled at runtime
    AsyncOpenAI = None
    OpenAI = None

    class APIError(Exception):
        ...

    class APIStatusError(APIError):
        ...

    class APITimeoutError(APIError):
        ...

    class RateLimitError(APIError):
        ...


primary_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "configs", ".env")
fallback_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "users", ".env")

if os.path.exists(primary_env_path):
    load_dotenv(primary_env_path)
else:
    load_dotenv(fallback_env_path)


class OpenAIIntegrationError(RuntimeError):
    """Raised when an OpenAI-compatible request cannot be fulfilled."""


def _first_env_match(candidates: Iterable[str]) -> Optional[str]:
    for variable in candidates:
        value = os.getenv(variable)
        if value:
            return value.strip()
    return None


def _provider_env_candidates(provider: str, suffix: str) -> List[str]:
    normalized = provider.upper().replace("-", "_")
    return [
        f"{normalized}_{suffix}",
        f"{normalized}-{suffix}",
        f"OPENAI_{suffix}" if provider == "openai" else None,
        f"OPENAI-{suffix}" if provider == "openai" else None,
        f"AI_{normalized}_{suffix}",
    ]


@dataclass
class ProviderConfig:
    """Resolved connection details for an OpenAI-compatible provider."""

    provider: str
    api_key: str
    base_url: Optional[str] = None
    organization: Optional[str] = None
    default_model: Optional[str] = None
    extra_headers: Dict[str, str] = field(default_factory=dict)

    def client_kwargs(self) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url.rstrip("/")
        if self.organization:
            kwargs["organization"] = self.organization
        if self.extra_headers:
            kwargs["default_headers"] = self.extra_headers
        return kwargs


def resolve_provider_config(
    provider: str = "openai",
    overrides: Optional[Dict[str, Any]] = None,
    user_api_key: Optional[str] = None,
) -> ProviderConfig:
    """
    Build a ProviderConfig pulling values from environment variables first, then overrides.
    """

    provider = provider.strip().lower()
    overrides = overrides or {}

    def pick_value(suffix: str, fallback: Optional[str] = None) -> Optional[str]:
        env_candidates = [v for v in _provider_env_candidates(provider, suffix) if v]
        env_value = _first_env_match(env_candidates)
        return overrides.get(suffix.lower()) or env_value or fallback

    api_key = (
        user_api_key
        or overrides.get("api_key")
        or _first_env_match(
            [
                *[v for v in _provider_env_candidates(provider, "API_KEY") if v],
                "OPENAI_API_KEY",
                "OPENAI_KEY",
                "OPENAI-KEY",
                "DEFAULT_OPENAI_API_KEY",
            ]
        )
    )

    if not api_key:
        raise OpenAIIntegrationError(
            f"No API key available for provider '{provider}'. "
            "Supply one via user input, overrides, or environment variables."
        )

    base_url = pick_value("BASE_URL")
    if not base_url and overrides.get("endpoint"):
        base_url = overrides["endpoint"]

    organization = pick_value("ORGANIZATION")
    default_model = overrides.get("default_model") or pick_value("DEFAULT_MODEL")

    headers_json = pick_value("HEADERS")
    extra_headers: Dict[str, str] = {}
    if overrides.get("headers"):
        extra_headers.update(overrides["headers"])
    if headers_json:
        try:
            extra_headers.update(json.loads(headers_json))
        except json.JSONDecodeError:
            # ignore malformed headers string, but do not crash
            pass

    return ProviderConfig(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        organization=organization,
        default_model=default_model,
        extra_headers=extra_headers,
    )


def _require_async_client() -> None:
    if AsyncOpenAI is None:
        raise OpenAIIntegrationError(
            "openai package is not available or outdated. "
            "Install `openai>=1.0` to enable AsyncOpenAI support."
        )


def _require_sync_client() -> None:
    if OpenAI is None:
        raise OpenAIIntegrationError(
            "openai package is not available or outdated. "
            "Install `openai>=1.0` to enable OpenAI client support."
        )


def get_async_client(
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
) -> "AsyncOpenAI":
    """Return an AsyncOpenAI client configured for the requested provider."""
    _require_async_client()
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    return AsyncOpenAI(**config.client_kwargs())


def get_client(
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
) -> "OpenAI":
    """Return a synchronous OpenAI client configured for the requested provider."""
    _require_sync_client()
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    return OpenAI(**config.client_kwargs())


async def create_chat_completion(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Execute a chat completion request using an OpenAI-compatible endpoint.
    """
    client = get_async_client(provider=provider, user_api_key=user_api_key, overrides=overrides)
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    final_model = model or config.default_model
    if not final_model:
        raise OpenAIIntegrationError("Model name must be supplied via parameter or provider configuration.")

    try:
        request = client.chat.completions.create(
            model=final_model,
            messages=messages,
            timeout=timeout,
            **kwargs,
        )
        return await request
    except (APIStatusError, RateLimitError, APITimeoutError) as err:
        raise OpenAIIntegrationError(f"Chat completion failed for provider '{provider}': {err}") from err
    except APIError as err:
        raise OpenAIIntegrationError(f"Chat completion error for provider '{provider}': {err}") from err


async def stream_chat_completion(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> AsyncGenerator[str, None]:
    """
    Stream chat completion deltas from an OpenAI-compatible endpoint, yielding text chunks.
    """
    client = get_async_client(provider=provider, user_api_key=user_api_key, overrides=overrides)
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    final_model = model or config.default_model
    if not final_model:
        raise OpenAIIntegrationError("Model name must be supplied via parameter or provider configuration.")

    try:
        stream = await client.chat.completions.create(
            model=final_model,
            messages=messages,
            stream=True,
            **kwargs,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta and getattr(delta, "content", None):
                yield delta.content
    except (APIStatusError, RateLimitError, APITimeoutError) as err:
        raise OpenAIIntegrationError(f"Streaming chat completion failed for provider '{provider}': {err}") from err
    except APIError as err:
        raise OpenAIIntegrationError(f"Streaming chat completion error for provider '{provider}': {err}") from err


async def create_embeddings(
    inputs: Union[str, List[str]],
    model: Optional[str] = None,
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> Tuple[List[List[float]], Dict[str, Any]]:
    """
    Generate vector embeddings and return both the vectors and the raw response metadata.
    """
    client = get_async_client(provider=provider, user_api_key=user_api_key, overrides=overrides)
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    final_model = model or config.default_model
    if not final_model:
        raise OpenAIIntegrationError("Embedding model must be specified.")

    try:
        response = await client.embeddings.create(model=final_model, input=inputs, **kwargs)
        embeddings = [item.embedding for item in response.data]
        return embeddings, {"usage": response.usage, "model": response.model}
    except (APIStatusError, RateLimitError, APITimeoutError) as err:
        raise OpenAIIntegrationError(f"Embeddings failed for provider '{provider}': {err}") from err
    except APIError as err:
        raise OpenAIIntegrationError(f"Embeddings error for provider '{provider}': {err}") from err


async def transcribe_audio(
    audio_path: str,
    model: Optional[str] = None,
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Transcribe an audio file using Speech-To-Text endpoints supported by OpenAI-compatible vendors.
    """
    client = get_async_client(provider=provider, user_api_key=user_api_key, overrides=overrides)
    config = resolve_provider_config(provider=provider, overrides=overrides, user_api_key=user_api_key)
    final_model = model or config.default_model
    if not final_model:
        raise OpenAIIntegrationError("Transcription model must be specified.")

    try:
        with open(audio_path, "rb") as audio_file:
            response = await client.audio.transcriptions.create(
                model=final_model,
                file=audio_file,
                **kwargs,
            )
        return response
    except FileNotFoundError as err:
        raise OpenAIIntegrationError(f"Audio file not found: {audio_path}") from err
    except (APIStatusError, RateLimitError, APITimeoutError) as err:
        raise OpenAIIntegrationError(f"Transcription failed for provider '{provider}': {err}") from err
    except APIError as err:
        raise OpenAIIntegrationError(f"Transcription error for provider '{provider}': {err}") from err


async def call_with_retry(
    coro_factory,
    *,
    retries: int = 2,
    backoff_factor: float = 2.0,
    retry_exceptions: Tuple[type, ...] = (OpenAIIntegrationError,),
) -> Any:
    """
    Retry helper for async OpenAI-compatible calls. Expects a zero-argument coroutine factory.
    """
    attempt = 0
    delay = 1.0
    while True:
        try:
            return await coro_factory()
        except retry_exceptions as err:
            attempt += 1
            if attempt > retries:
                raise
            await asyncio.sleep(delay)
            delay *= backoff_factor


def list_models(
    provider: str = "openai",
    user_api_key: Optional[str] = None,
    overrides: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    List available models from an OpenAI-compatible provider.

    Returns a list of dicts with at least: { id: str, owned_by?: str }.
    Uses the synchronous client for simplicity.
    """
    client = get_client(provider=provider, user_api_key=user_api_key, overrides=overrides)
    result = []
    try:
        models = client.models.list()
        # The SDK returns a list-like object with .data
        items = getattr(models, "data", models) or []
        for m in items:
            # Objects from SDK expose attributes; be defensive
            model_id = getattr(m, "id", None) or getattr(m, "name", None)
            if not model_id:
                continue
            owned_by = getattr(m, "owned_by", None) or getattr(m, "organization", None)
            result.append({
                "id": model_id,
                "owned_by": owned_by,
            })
    except Exception as err:  # noqa: BLE001 - surface upstream
        # Re-raise as OpenAIIntegrationError for consistent handling upstream
        raise OpenAIIntegrationError(f"Failed to list models for provider '{provider}': {err}") from err
    return result

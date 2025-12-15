import asyncio
import threading
from collections import defaultdict, deque
from concurrent.futures import Future
from dataclasses import dataclass
from typing import Any, Deque, Dict, Optional

from integrations import gemini_api
from integrations import openai as openai_integration
from integrations.openai import OpenAIIntegrationError


class AIServiceError(RuntimeError):
    """Base class for AI service related errors."""


class ProviderNotRegisteredError(AIServiceError):
    """Raised when a request targets a provider that is not registered."""


class AIServiceQueueFullError(AIServiceError):
    """Raised when the queue is full and cannot accept more requests."""


class UnsupportedOperationError(AIServiceError):
    """Raised when a provider does not support the requested operation."""


@dataclass
class AIRequestTask:
    """Represents a queued AI request."""

    provider: str
    operation: str
    payload: Dict[str, Any]
    user_hash: str
    future: Future
    user_api_key: Optional[str] = None
    provider_overrides: Optional[Dict[str, Any]] = None


class BaseAIProvider:
    """Common interface for OpenAI-compatible providers."""

    def __init__(self, name: str, core_api=None):
        self.name = name
        self.core_api = core_api

    def run(self, task: AIRequestTask) -> Any:  # pragma: no cover - interface
        raise NotImplementedError


class OpenAIProvider(BaseAIProvider):
    """Adapter around integrations.openai providing common operations."""

    def _merge_overrides(self, task: AIRequestTask) -> Dict[str, Any]:
        overrides: Dict[str, Any] = {}
        if task.provider_overrides:
            overrides.update(task.provider_overrides)
        payload_overrides = task.payload.get("overrides")
        if isinstance(payload_overrides, dict):
            overrides.update(payload_overrides)
        return overrides

    @staticmethod
    def _run_async(coro):
        """Execute an asyncio coroutine inside worker threads."""
        return asyncio.run(coro)

    def run(self, task: AIRequestTask) -> Any:
        overrides = self._merge_overrides(task)
        target_provider = task.payload.get("provider") or overrides.pop("provider", self.name)
        operation = task.operation.lower()

        try:
            if operation in ("chat", "chat_completion"):
                messages = task.payload.get("messages")
                if not messages:
                    raise AIServiceError("messages are required for chat completion operations.")
                model = task.payload.get("model")
                timeout = task.payload.get("timeout")
                extra_kwargs = task.payload.get("kwargs") or {}
                return self._run_async(
                    openai_integration.create_chat_completion(
                        messages=messages,
                        model=model,
                        provider=target_provider,
                        user_api_key=task.user_api_key,
                        overrides=overrides or None,
                        timeout=timeout,
                        **extra_kwargs,
                    )
                )

            if operation in ("embeddings", "embedding"):
                inputs = task.payload.get("inputs")
                if inputs is None:
                    raise AIServiceError("inputs are required for embedding operations.")
                model = task.payload.get("model")
                extra_kwargs = task.payload.get("kwargs") or {}
                return self._run_async(
                    openai_integration.create_embeddings(
                        inputs=inputs,
                        model=model,
                        provider=target_provider,
                        user_api_key=task.user_api_key,
                        overrides=overrides or None,
                        **extra_kwargs,
                    )
                )

            if operation in ("speech_to_text", "transcribe", "transcription"):
                audio_path = task.payload.get("audio_path")
                if not audio_path:
                    raise AIServiceError("audio_path is required for transcription operations.")
                model = task.payload.get("model")
                extra_kwargs = task.payload.get("kwargs") or {}
                return self._run_async(
                    openai_integration.transcribe_audio(
                        audio_path=audio_path,
                        model=model,
                        provider=target_provider,
                        user_api_key=task.user_api_key,
                        overrides=overrides or None,
                        **extra_kwargs,
                    )
                )

            custom_callable = task.payload.get("callable")
            if callable(custom_callable):
                # Last resort: allow plugins to perform custom logic with a configured client.
                client = openai_integration.get_async_client(
                    provider=target_provider,
                    user_api_key=task.user_api_key,
                    overrides=overrides or None,
                )
                return self._run_async(custom_callable(client))

        except OpenAIIntegrationError as err:
            raise AIServiceError(str(err)) from err

        raise UnsupportedOperationError(
            f"OpenAI provider does not support operation '{task.operation}'."
        )


class GeminiProvider(BaseAIProvider):
    """Adapter around integrations.gemini_api with common operations."""

    @staticmethod
    def _run_async(coro):
        return asyncio.run(coro)

    @staticmethod
    def _normalize_text_from_content(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, dict):
            if "text" in content and isinstance(content["text"], str):
                return content["text"]
            return str(content)
        if isinstance(content, list):
            fragments = []
            for part in content:
                if isinstance(part, dict):
                    part_type = part.get("type")
                    if part_type == "text" and part.get("text"):
                        fragments.append(part["text"])
                    elif part_type == "image_url" and part.get("image_url"):
                        url = part["image_url"].get("url")
                        if url:
                            fragments.append(f"[Image: {url}]")
                    elif part_type == "input_audio" and part.get("input_audio"):
                        fragments.append("[Audio attachment]")
            if fragments:
                return "\n".join(fragments)
        return str(content)

    def _convert_messages(self, messages: Any) -> list[dict]:
        converted: list[dict] = []
        if not isinstance(messages, list):
            return converted
        for message in messages:
            if not isinstance(message, dict):
                continue
            # Preserve Gemini-style messages with explicit parts (for tool-calling)
            if isinstance(message.get("parts"), list) and message.get("role"):
                converted.append(message)
                continue

            role = message.get("role", "user")
            text = self._normalize_text_from_content(message.get("content"))
            if not text:
                continue
            if role == "system":
                converted.append({"role": "user", "text": text})
            else:
                converted.append({"role": role, "text": text})
        return converted

    def run(self, task: AIRequestTask) -> Any:
        operation = task.operation.lower()
        payload = task.payload or {}
        api_key = task.user_api_key

        if operation in ("chat", "chat_completion"):
            messages = self._convert_messages(payload.get("messages"))
            if not messages:
                raise AIServiceError("Gemini chat requires non-empty messages.")
            model = payload.get("model", "gemini-2.5-flash")
            kwargs = payload.get("kwargs") or {}
            return self._run_async(
                gemini_api.chat(
                    conversation=messages,
                    model=model,
                    temperature=kwargs.get("temperature"),
                    max_tokens=kwargs.get("max_tokens"),
                    user_api_key=api_key,
                    tools=payload.get("tools"),
                    tool_mode=payload.get("tool_mode"),
                        structured_output=payload.get("structured_output"),
                )
            )

        if operation in ("text", "generate_text"):
            return self._run_async(
                gemini_api.generate_text(
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "gemini-2.5-flash"),
                    temperature=payload.get("temperature"),
                    max_tokens=payload.get("max_tokens"),
                    user_api_key=api_key,
                )
            )

        if operation in ("structured_json", "json"):
            return self._run_async(
                gemini_api.generate_structured_json(
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "gemini-2.5-flash"),
                    temperature=payload.get("temperature"),
                    max_tokens=payload.get("max_tokens"),
                    user_api_key=api_key,
                    **(payload.get("kwargs") or {}),
                )
            )

        if operation in ("memory_update", "user_memory"):
            return self._run_async(
                gemini_api.generate_user_memory_update(
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "gemini-2.5-flash"),
                    temperature=payload.get("temperature"),
                    max_tokens=payload.get("max_tokens"),
                    user_api_key=api_key,
                )
            )

        if operation in ("image", "generate_image"):
            return self._run_async(
                gemini_api.generate_image(
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "imagen-3.0-generate-001"),
                    number_of_images=payload.get("number_of_images", 1),
                    user_api_key=api_key,
                )
            )

        if operation in ("content_with_image", "json_with_image"):
            image_bytes = payload.get("image_bytes")
            if image_bytes is None:
                raise AIServiceError("image_bytes are required for content_with_image operations.")
            return self._run_async(
                gemini_api.generate_content_with_image(
                    prompt=payload.get("prompt", ""),
                    image_bytes=image_bytes,
                    model=payload.get("model", "gemini-1.5-flash-latest"),
                    temperature=payload.get("temperature"),
                    max_tokens=payload.get("max_tokens"),
                    user_api_key=api_key,
                    **(payload.get("kwargs") or {}),
                )
            )

        if operation in ("music", "generate_music"):
            prompts = payload.get("prompts")
            if not prompts:
                raise AIServiceError("prompts are required for music generation.")
            return self._run_async(
                gemini_api.generate_music(
                    prompts=prompts,
                    bpm=payload.get("bpm", 90),
                    temperature=payload.get("temperature", 1.0),
                    model=payload.get("model", "models/lyria-realtime-exp"),
                    user_api_key=api_key,
                )
            )

        if operation in ("text_to_speech", "tts"):
            return self._run_async(
                gemini_api.text_to_speech(
                    text=payload.get("text", ""),
                    voice=payload.get("voice", "Kore"),
                    model=payload.get("model", "gemini-2.5-flash-preview-tts"),
                    user_api_key=api_key,
                )
            )

        if operation in ("speech_to_text", "transcribe", "transcription"):
            audio_path = payload.get("audio_path")
            if not audio_path:
                raise AIServiceError("audio_path is required for speech_to_text operations.")
            return self._run_async(
                gemini_api.speech_to_text(
                    audio_path=audio_path,
                    model=payload.get("model", "gemini-2.5-flash"),
                    user_api_key=api_key,
                )
            )

        if operation in ("analyze_video", "video"):
            return self._run_async(
                gemini_api.analyze_video(
                    video_path=payload.get("video_path", ""),
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "gemini-2.5-flash"),
                    user_api_key=api_key,
                )
            )

        if operation in ("analyze_audio", "audio"):
            return self._run_async(
                gemini_api.analyze_audio(
                    audio_path=payload.get("audio_path", ""),
                    prompt=payload.get("prompt", ""),
                    model=payload.get("model", "gemini-2.5-flash"),
                    user_api_key=api_key,
                )
            )

        custom_callable = payload.get("callable")
        if callable(custom_callable):
            client = gemini_api._get_client(api_key)  # type: ignore[attr-defined]
            return custom_callable(client)

        raise UnsupportedOperationError(f"Gemini provider does not support operation '{task.operation}'.")
class AIService:
    """
    Centralized service that arbitrates access to AI providers and manages request queues.
    """

    def __init__(
        self,
        core_api,
        *,
        max_workers: int = 4,
        per_user_concurrency: int = 1,
        max_queue_size: int = 100,
        per_user_queue_limit: int = 10,
    ):
        self.core_api = core_api
        self._max_workers = max(1, max_workers)
        self._per_user_concurrency = max(1, per_user_concurrency)
        self._max_queue_size = max_queue_size
        self._per_user_queue_limit = per_user_queue_limit

        self._providers: Dict[str, BaseAIProvider] = {}
        self._waiting: Dict[str, Deque[AIRequestTask]] = defaultdict(deque)
        self._round_robin: Deque[str] = deque()
        self._inflight: Dict[str, int] = defaultdict(int)
        self._queued_count = 0

        self._lock = threading.RLock()
        self._new_task_event = threading.Event()
        self._shutdown_event = threading.Event()

        self._workers = [
            threading.Thread(target=self._worker_loop, name=f"ai-worker-{idx}", daemon=True)
            for idx in range(self._max_workers)
        ]
        for worker in self._workers:
            worker.start()

        # Register default providers.
        self.register_provider(OpenAIProvider("openai", core_api))
        self.register_provider(OpenAIProvider("openai-compatible", core_api))
        # LM Studio speaks OpenAI-compatible API; register as alias
        self.register_provider(OpenAIProvider("lmstudio", core_api))
        self.register_provider(GeminiProvider("gemini", core_api))

    def register_provider(self, provider: BaseAIProvider) -> None:
        with self._lock:
            self._providers[provider.name] = provider

    def submit(
        self,
        *,
        provider: str,
        operation: str,
        payload: Optional[Dict[str, Any]] = None,
        user_hash: str,
        user_api_key: Optional[str] = None,
        provider_overrides: Optional[Dict[str, Any]] = None,
    ) -> Future:
        if self._shutdown_event.is_set():
            raise AIServiceError("AIService is shutting down and cannot accept new requests.")

        with self._lock:
            if provider not in self._providers:
                raise ProviderNotRegisteredError(f"Provider '{provider}' is not registered.")

            user_queue = self._waiting[user_hash]
            if self._per_user_queue_limit and len(user_queue) >= self._per_user_queue_limit:
                raise AIServiceQueueFullError("Per-user AI request queue is full.")

            if 0 <= self._max_queue_size <= self._queued_count:
                raise AIServiceQueueFullError("Global AI request queue is full.")

            future = Future()
            task = AIRequestTask(
                provider=provider,
                operation=operation,
                payload=payload or {},
                user_hash=user_hash,
                future=future,
                user_api_key=user_api_key,
                provider_overrides=provider_overrides,
            )
            user_queue.append(task)
            self._queued_count += 1
            if user_hash not in self._round_robin:
                self._round_robin.append(user_hash)

        self._new_task_event.set()
        return future

    async def request_async(self, **kwargs) -> Any:
        future = self.submit(**kwargs)
        return await asyncio.wrap_future(future)

    def request(self, timeout: Optional[float] = None, **kwargs) -> Any:
        future = self.submit(**kwargs)
        return future.result(timeout=timeout)

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "queued": self._queued_count,
                "inflight": dict(self._inflight),
                "providers": list(self._providers.keys()),
            }

    def shutdown(self, wait: bool = True, timeout: float = 5.0) -> None:
        self._shutdown_event.set()
        self._new_task_event.set()

        with self._lock:
            for queue in self._waiting.values():
                while queue:
                    task = queue.popleft()
                    if not task.future.done():
                        task.future.set_exception(AIServiceError("AIService shutdown before execution."))
            self._waiting.clear()
            self._round_robin.clear()
            self._queued_count = 0

        if wait:
            for worker in self._workers:
                worker.join(timeout)

    # --- Internal helpers ---

    def _worker_loop(self) -> None:
        while not self._shutdown_event.is_set():
            task = self._next_task()
            if task is None:
                self._new_task_event.wait(timeout=0.5)
                self._new_task_event.clear()
                continue

            provider = self._providers.get(task.provider)
            if not provider:
                task.future.set_exception(
                    ProviderNotRegisteredError(f"Provider '{task.provider}' was deregistered.")
                )
                self._release_task(task.user_hash)
                continue

            try:
                result = provider.run(task)
            except Exception as exc:  # noqa: BLE001
                task.future.set_exception(exc)
            else:
                task.future.set_result(result)
            finally:
                self._release_task(task.user_hash)

    def _next_task(self) -> Optional[AIRequestTask]:
        with self._lock:
            scanned_users = len(self._round_robin)
            for _ in range(scanned_users):
                user_hash = self._round_robin.popleft()
                inflight = self._inflight.get(user_hash, 0)
                queue = self._waiting.get(user_hash)
                if not queue:
                    continue

                if inflight >= self._per_user_concurrency:
                    self._round_robin.append(user_hash)
                    continue

                task = queue.popleft()
                self._inflight[user_hash] += 1
                self._queued_count -= 1

                if queue:
                    self._round_robin.append(user_hash)
                else:
                    self._waiting.pop(user_hash, None)
                return task
        return None

    def _release_task(self, user_hash: str) -> None:
        with self._lock:
            current = self._inflight.get(user_hash)
            if current is None:
                return
            if current > 1:
                self._inflight[user_hash] = current - 1
            else:
                self._inflight.pop(user_hash, None)
        self._new_task_event.set()

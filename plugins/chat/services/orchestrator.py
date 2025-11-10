import asyncio
import copy
import json
import threading
import time
import uuid
import re
from queue import Queue
from typing import Any, Dict, List, Optional

from integrations import gemini_api
from integrations import openai as openai_integration

from .character_store import CharacterDefinitionStore
from .settings_store import GenerationSettingsStore
from .history_store import ChatHistoryStore


class ChatOrchestrator:
    """
    High-level coordinator that combines data stores with the AIService queue.
    """

    def __init__(self, core_api):
        self.core_api = core_api
        data_manager = core_api.data_manager
        self.definitions = CharacterDefinitionStore(data_manager)
        self.settings = GenerationSettingsStore(data_manager)
        self.histories = ChatHistoryStore(data_manager)
        self.ai_service = getattr(core_api, "ai_service", None)

        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    # --- Character utilities ---

    def list_character_cards(self, user_hash: str) -> Dict[str, Any]:
        definitions = self.definitions.all(user_hash)
        histories = self.histories.list_sessions(user_hash)
        cards = []
        for character_id, definition in definitions.items():
            sessions = histories.get(character_id, [])
            last_message = None
            updated_at = None
            if isinstance(sessions, list) and sessions:
                # sessions are a list of { session_id, messages, created_at, updated_at }
                # pick the latest by updated_at and take its last message
                latest_session = max(
                    sessions,
                    key=lambda sess: (sess.get("updated_at") or (sess.get("messages") or [{}])[-1].get("created_at") if (sess.get("messages") or []) else 0) or 0,
                )
                msgs = latest_session.get("messages") or []
                last_message = msgs[-1] if msgs else None
                updated_at = latest_session.get("updated_at") or (last_message.get("created_at") if last_message else None)
            cards.append({
                "id": character_id,
                "display_name": definition.get("display_name") or definition.get("name"),
                "avatar": definition.get("avatar"),
                "last_message": last_message,
                "updated_at": updated_at,
            })
        cards.sort(key=lambda item: item.get("updated_at") or 0, reverse=True)
        return {"characters": cards}

    def get_character_definition(self, user_hash: str, character_id: str) -> Optional[Dict[str, Any]]:
        return self.definitions.get(user_hash, character_id)

    def _normalize_definition_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "avatar": payload.get("avatar"),
            "display_name": payload.get("display_name") or payload.get("name"),
            "name": payload.get("name"),
            "appearance": payload.get("appearance", []),
            "scenario": payload.get("scenario"),
            "first_messages": payload.get("first_messages", []),
            "example_dialogs": payload.get("example_dialogs", []),
            "current": payload.get("current", {}),
        }

    def _generate_character_id(self, user_hash: str) -> str:
        existing = self.definitions.all(user_hash)
        while True:
            candidate = uuid.uuid4().hex[:8]
            if candidate not in existing:
                return candidate

    def create_character_definition(self, user_hash: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        character_id = payload.get("id") or self._generate_character_id(user_hash)
        definition = self.upsert_character_definition(user_hash, character_id, payload)
        return {
            "id": character_id,
            "definition": definition,
        }

    def upsert_character_definition(self, user_hash: str, character_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self._normalize_definition_payload(payload)
        return self.definitions.save(user_hash, character_id, normalized)

    def delete_character_definition(self, user_hash: str, character_id: str) -> bool:
        return self.definitions.delete(user_hash, character_id)

    # --- Settings ---

    def get_generation_settings(self, user_hash: str) -> Dict[str, Any]:
        return self.settings.get(user_hash)

    def update_generation_settings(self, user_hash: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.settings.save(user_hash, payload)

    # --- Histories ---

    def list_chat_sessions(self, user_hash: str) -> Dict[str, Any]:
        summaries = []
        histories = self.histories.list_sessions(user_hash)
        definitions = self.definitions.all(user_hash)
        for character_id, entries in histories.items():
            definition = definitions.get(character_id, {})
            if isinstance(entries, list) and entries and isinstance(entries[0], dict) and "messages" in entries[0]:
                # new format: list of session dicts
                for sess in entries:
                    messages = sess.get("messages") or []
                    last_message = messages[-1] if messages else None
                    summaries.append({
                        "character_id": character_id,
                        "session_id": sess.get("session_id"),
                        "display_name": definition.get("display_name") or definition.get("name"),
                        "avatar": definition.get("avatar"),
                        "message_count": len(messages),
                        "last_message": last_message,
                        "updated_at": sess.get("updated_at") or (last_message.get("created_at") if last_message else None),
                    })
            else:
                # legacy: entries is the messages list
                messages = entries or []
                last_message = messages[-1] if messages else None
                summaries.append({
                    "character_id": character_id,
                    "session_id": None,
                    "display_name": definition.get("display_name") or definition.get("name"),
                    "avatar": definition.get("avatar"),
                    "message_count": len(messages),
                    "last_message": last_message,
                    "updated_at": last_message.get("created_at") if last_message else None,
                })
        summaries.sort(key=lambda item: item.get("updated_at") or 0, reverse=True)
        return {"sessions": summaries}

    def get_chat_history(self, user_hash: str, character_id: str, *, session_id: Optional[str] = None) -> Dict[str, Any]:
        definition = self.definitions.get(user_hash, character_id)
        # Resolve active session id if not explicitly provided (maintains backward compatibility)
        resolved_session_id = session_id
        if resolved_session_id is None:
            all_histories = self.histories.all(user_hash)
            value = all_histories.get(character_id)
            if isinstance(value, dict) and "sessions" in value:
                # Prefer explicitly tracked active_session_id; fallback to latest by updated_at
                active_sid = value.get("active_session_id")
                if active_sid in (value.get("sessions") or {}):
                    resolved_session_id = active_sid
                else:
                    sessions = value.get("sessions") or {}
                    if sessions:
                        resolved_session_id = max(sessions.keys(), key=lambda sid: sessions[sid].get("updated_at") or 0)
        messages = self.histories.get_history(user_hash, character_id, session_id=resolved_session_id)
        messages = self._seed_first_messages(user_hash, character_id, definition, messages, session_id=resolved_session_id)
        return {"character_id": character_id, "definition": definition, "messages": messages, "session_id": resolved_session_id}

    def clear_chat_history(self, user_hash: str, character_id: str, *, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Clear all messages (history) for a character. Keeps the character definition intact.

        Returns a standard payload similar to get_chat_history with empty messages, so
        the client can keep rendering the chat page in an empty state.
        """
        # Save empty history and return a minimal structure
        self.histories.save_history(user_hash, character_id, [], session_id=session_id)
        definition = self.definitions.get(user_hash, character_id) or {}
        return {
            "character_id": character_id,
            "definition": definition,
            "messages": [],
        }

    def delete_chat_session(self, user_hash: str, character_id: str, *, session_id: Optional[str] = None) -> bool:
        """Delete the chat session for a character (remove history key or specific session)."""
        return self.histories.delete_session(user_hash, character_id, session_id=session_id)

    def append_message(
        self,
        user_hash: str,
        character_id: str,
        role: str,
        content: Dict[str, Any],
        *,
        message_type: str = "text",
        metadata: Optional[Dict[str, Any]] = None,
        reference_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        message = {
            "id": str(uuid.uuid4()),
            "role": role,
            "type": message_type,
            "content": content,
            "metadata": metadata or {},
            "reference_id": reference_id,
            "created_at": time.time(),
            "character_id": character_id,
            "session_id": session_id,
        }
        # Do not persist ephemeral instruction messages like [Continue xxx]
        if role == "user" and self._is_ephemeral_instruction(message):
            return message
        return self.histories.upsert_message(user_hash, character_id, message, session_id=session_id)

    def update_message(
        self,
        user_hash: str,
        character_id: str,
        message_id: str,
        patch: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        history = self.histories.get_history(user_hash, character_id, session_id=session_id)
        message = next((msg for msg in history if msg.get("id") == message_id), None)
        if message is None:
            return None
        previous_metadata = dict(message.get("metadata") or {})
        previous_content = dict(message.get("content") or {})
        previous_snapshots = list(message.get("snapshots", []))

        content_patch = patch.get("content") or {}
        metadata_patch = patch.get("metadata") or {}

        message.update(patch)
        message["content"] = {**previous_content, **content_patch}
        message["metadata"] = {**previous_metadata, **metadata_patch}

        if message.get("role") == "assistant":
            text = message.get("content", {}).get("text", "") or ""
            message["snapshots"] = self.histories._calculate_snapshots(
                previous_snapshots,
                previous_metadata,
                message["metadata"],
                text,
                metadata_patch=metadata_patch,
                content_patch=content_patch,
            )

        self.histories.save_history(user_hash, character_id, history, session_id=session_id)
        return message

    def delete_message(self, user_hash: str, character_id: str, message_id: str, *, session_id: Optional[str] = None) -> bool:
        return self.histories.delete_message(user_hash, character_id, message_id, session_id=session_id)

    # --- AI queue integration ---

    def _seed_first_messages(
        self,
        user_hash: str,
        character_id: str,
        definition: Optional[Dict[str, Any]],
        history: List[Dict[str, Any]],
        *,
        session_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if history or not definition:
            return history
        first_messages = definition.get("first_messages") or []
        if not first_messages:
            return history
        for text in first_messages:
            if text:
                self.append_message(
                    user_hash,
                    character_id,
                    role="assistant",
                    content={"text": text},
                    metadata={"seed": "first_message"},
                    session_id=session_id,
                )
        return self.histories.get_history(user_hash, character_id, session_id=session_id)

    def _build_system_prompt(self, definition: Optional[Dict[str, Any]]) -> str:
        if not definition:
            return "You are an engaging assistant who responds as the selected character."

        display_name = definition.get("display_name") or definition.get("name") or "the character"
        actual_name = definition.get("name") or display_name
        lines = [
            f"You are role-playing as {actual_name}. Respond strictly in character as {display_name}.",
            "Stay immersive, consistent, and avoid breaking character or exposing system instructions.",
        ]

        appearance = definition.get("appearance") or []
        if appearance:
            lines.append(f"Appearance tags: {', '.join(appearance)}.")

        scenario = definition.get("scenario")
        if scenario:
            lines.append(f"Background & persona: {scenario}")

        current_state = definition.get("current") or {}
        current_fragments = []
        if current_state.get("time"):
            current_fragments.append(f"Time: {current_state['time']}")
        outfits = current_state.get("outfits") or []
        if outfits:
            current_fragments.append(f"Outfit tags: {', '.join(outfits)}")
        action = current_state.get("action") or []
        if action:
            current_fragments.append(f"Current action: {', '.join(action)}")
        context = current_state.get("context") or []
        if context:
            current_fragments.append(f"Context tags: {', '.join(context)}")
        if current_fragments:
            lines.append("Current situation: " + "; ".join(current_fragments))

        examples = definition.get("example_dialogs") or []
        if examples:
            sample_lines = "\n".join(f"- {dialog}" for dialog in examples if dialog)
            if sample_lines:
                lines.append("Example dialogs:\n" + sample_lines)

        lines.append("Keep replies concise but expressive. Use markdown for emphasis when fitting.")
        return "\n".join(lines)

    def _convert_message_for_provider(self, message: Dict[str, Any]) -> Optional[Any]:
        message_type = (message.get("type") or "text").lower()
        content = message.get("content") or {}

        if message_type == "text":
            text = content.get("text", "")
            if message.get("role") == "assistant":
                snapshots = message.get("snapshots") or []
                metadata = message.get("metadata") or {}
                index = metadata.get("selected_snapshot_index")
                if isinstance(index, int) and 0 <= index < len(snapshots):
                    text = snapshots[index]
            return text if text is not None else ""

        if message_type == "image":
            url = content.get("url")
            alt_text = content.get("text") or "Attached image."
            if url:
                return [
                    {"type": "text", "text": alt_text},
                    {"type": "image_url", "image_url": {"url": url}},
                ]
            return alt_text

        if message_type == "audio":
            url = content.get("url")
            transcript = content.get("text") or "Attached audio clip."
            if url:
                return [
                    {"type": "text", "text": transcript},
                    {"type": "input_audio", "input_audio": {"url": url}},
                ]
            return transcript

        return content.get("text") or str(content)

    def build_provider_messages(
        self,
        user_hash: str,
        character_id: str,
        conversation: Optional[List[Dict[str, Any]]] = None,
        *,
        session_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        definition = self.definitions.get(user_hash, character_id)
        history = conversation if conversation is not None else self.histories.get_history(user_hash, character_id, session_id=session_id)
        history = sorted(history, key=lambda item: item.get("created_at", 0))
        # Filter out ephemeral instruction messages such as [Continue xxx]
        history = [item for item in history if not self._is_ephemeral_instruction(item)]

        provider_messages: List[Dict[str, Any]] = []
        system_prompt = self._build_system_prompt(definition)
        # Append global system instruction if configured
        try:
            gen_settings = self.get_generation_settings(user_hash) or {}
            extra_instruction = gen_settings.get("system_instruction")
            if isinstance(extra_instruction, str) and extra_instruction.strip():
                system_prompt = f"{system_prompt}\n\nAdditional instruction:\n{extra_instruction.strip()}"
        except Exception:
            pass
        provider_messages.append({"role": "system", "content": system_prompt})

        for item in history:
            role = "assistant" if item.get("role") == "assistant" else "user"
            converted = self._convert_message_for_provider(item)
            if converted is None:
                continue
            provider_messages.append({"role": role, "content": converted})

        return provider_messages

    def _is_ephemeral_instruction(self, item: Dict[str, Any]) -> bool:
        try:
            if not isinstance(item, dict):
                return False
            if item.get("role") != "user":
                return False
            md = item.get("metadata") or {}
            if md.get("instruction") or md.get("continue") or md.get("transient"):
                return True
            content = item.get("content") or {}
            text = content.get("text") or ""
            if isinstance(text, str):
                # Bracketed single-line or multi-line instruction like [Continue xxx]
                return bool(re.match(r"^\s*\[[\s\S]*\]\s*$", text))
            return False
        except Exception:
            return False

    def _extract_continue_seed(self, item: Dict[str, Any]) -> Optional[str]:
        try:
            if not isinstance(item, dict):
                return None
            md = item.get("metadata") or {}
            seed = md.get("seed")
            if seed:
                return str(seed)
            content = item.get("content") or {}
            text = content.get("text") or ""
            if not isinstance(text, str):
                return None
            m = re.search(r"Continue\s+([\w\-]+)", text, flags=re.IGNORECASE)
            if m:
                return m.group(1)
            return None
        except Exception:
            return None

    def _build_continue_instruction_text(self, seed: Optional[str]) -> str:
        seed_text = f" seed:{seed}" if seed else ""
        return (
            "Continue the assistant's last response seamlessly. "
            "Do not restart, summarize, or change topics. "
            "Maintain the same persona, tone, and style. "
            "Pick up mid-sentence if needed and avoid repeating prior content."
            f"(Seed: {seed_text})"
        )

    def enqueue_generation(
        self,
        user_hash: str,
        character_id: str,
        messages: Optional[List[Dict[str, Any]]] = None,
        *,
        operation: str = "chat",
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.ai_service:
            raise RuntimeError("AIService is not available within CoreAPI.")

        generation_settings = self.get_generation_settings(user_hash)
        provider = generation_settings.get("provider", "openai")
        model = generation_settings.get("model")
        if not model:
            raise ValueError("No model configured. Please update generation settings.")

        sess_id = (context or {}).get("session_id") if context else None
        conversation = messages if messages is not None else self.histories.get_history(user_hash, character_id, session_id=sess_id)
        if context and context.get("action") == "regen" and context.get("message_id"):
            target_id = context["message_id"]
            conversation = [msg for msg in conversation if msg.get("id") != target_id]
        provider_messages = self.build_provider_messages(user_hash, character_id, conversation, session_id=sess_id)

        # If this is a continue operation (or conversation contains an ephemeral continue instruction),
        # append a strong SYSTEM directive to guide the model.
        is_continue = (context and context.get("action") == "continue") or any(
            self._is_ephemeral_instruction(msg) for msg in (conversation or [])
        )
        if is_continue:
            # Extract seed from the last ephemeral instruction in conversation if present
            seed = None
            for msg in reversed(conversation or []):
                if self._is_ephemeral_instruction(msg):
                    seed = self._extract_continue_seed(msg)
                    break
            provider_messages.append({
                "role": "system",
                "content": self._build_continue_instruction_text(seed),
            })

        payload = {
            "messages": provider_messages,
            "model": model,
            "kwargs": {
                "temperature": generation_settings.get("temperature"),
                "max_tokens": generation_settings.get("max_tokens"),
            },
        }

        job_id = str(uuid.uuid4())
        future = self.ai_service.submit(
            provider=provider,
            operation=operation,
            payload=payload,
            user_hash=user_hash,
            user_api_key=generation_settings.get("api_key"),
            provider_overrides=generation_settings.get("overrides"),
        )

        with self._lock:
            self._jobs[job_id] = {
                "status": "queued",
                "created_at": time.time(),
                "character_id": character_id,
                "operation": operation,
                "context": context or {},
                "user_hash": user_hash,
            }

        future.add_done_callback(
            lambda fut, jid=job_id, uh=user_hash, cid=character_id: self._handle_ai_result(jid, fut, uh, cid)
        )

        return {"job_id": job_id, "status": "queued"}

    def stream_regeneration(
        self,
        user_hash: str,
        character_id: str,
        *,
        target_message_id: str,
        messages: Optional[List[Dict[str, Any]]] = None,
        session_id: Optional[str] = None,
    ):
        if not target_message_id:
            raise ValueError("Missing message_id for regeneration.")

        generation_settings = self.get_generation_settings(user_hash)
        provider = (generation_settings.get("provider") or "openai").lower()
        model = generation_settings.get("model")
        if not model:
            raise ValueError("No model configured. Please update generation settings.")

        if provider not in {"openai", "gemini"}:
            raise ValueError(f"Streaming is not supported for provider '{provider}'.")

        history = self.histories.get_history(user_hash, character_id, session_id=session_id)
        target_message = next((msg for msg in history if msg.get("id") == target_message_id), None)
        if target_message is None:
            raise ValueError("Target message not found.")
        if target_message.get("role") != "assistant":
            raise ValueError("Only assistant messages can be regenerated.")

        base_conversation = messages if isinstance(messages, list) and messages else history
        conversation = [msg for msg in base_conversation if msg.get("id") != target_message_id]
        provider_messages = self.build_provider_messages(user_hash, character_id, conversation, session_id=session_id)

        reference_id = target_message.get("reference_id")
        original_content = copy.deepcopy(target_message.get("content") or {})
        original_metadata = copy.deepcopy(target_message.get("metadata") or {})
        original_snapshots = copy.deepcopy(target_message.get("snapshots") or [])
        placeholder_metadata = {
            **original_metadata,
            "provider": provider,
            "streaming": True,
            "regen": True,
            "generated_at": time.time(),
        }
        placeholder_metadata.pop("error", None)

        placeholder_message = {
            **target_message,
            "content": {**original_content, "text": ""},
            "metadata": placeholder_metadata,
        }
        if original_snapshots:
            placeholder_message["snapshots"] = copy.deepcopy(original_snapshots)

        stream_kwargs = {
            "temperature": generation_settings.get("temperature"),
            "max_tokens": generation_settings.get("max_tokens"),
        }
        overrides = generation_settings.get("overrides")
        user_api_key = generation_settings.get("api_key")

        def event_stream():
            yield self._encode_stream_event({"type": "assistant_message", "message": placeholder_message})

            max_attempts = 2
            for attempt in range(1, max_attempts + 1):
                accumulated: List[str] = []
                try:
                    for delta in self._generate_stream_deltas(
                        provider=provider,
                        model=model,
                        provider_messages=provider_messages,
                        stream_kwargs=stream_kwargs,
                        overrides=overrides,
                        user_api_key=user_api_key,
                    ):
                        if not delta:
                            continue
                        accumulated.append(delta)
                        current_text = "".join(accumulated)
                        streaming_message = {
                            **placeholder_message,
                            "content": {**original_content, "text": current_text},
                            "metadata": {**placeholder_metadata},
                        }
                        payload = {
                            "type": "delta",
                            "message_id": target_message_id,
                            "delta": delta,
                            "text": current_text,
                        }
                        payload["message"] = streaming_message
                        yield self._encode_stream_event(payload)
                except Exception as exc:  # noqa: BLE001
                    restored_message = {
                        **target_message,
                        "content": copy.deepcopy(original_content),
                        "metadata": copy.deepcopy(original_metadata),
                    }
                    if original_snapshots:
                        restored_message["snapshots"] = copy.deepcopy(original_snapshots)
                    yield self._encode_stream_event(
                        {"type": "assistant_message", "message": restored_message}
                    )
                    yield self._encode_stream_event(
                        {
                            "type": "error",
                            "message_id": target_message_id,
                            "error": str(exc),
                        }
                    )
                    return

                final_text = "".join(accumulated).strip()
                if final_text:
                    final_metadata = {
                        **placeholder_metadata,
                        "streaming": False,
                        "regen": True,
                        "generated_at": time.time(),
                        "provider": provider,
                    }
                    final_metadata.pop("error", None)
                    final_metadata["selected_snapshot_index"] = len(original_snapshots) if original_snapshots else 0
                    final_message = self.update_message(
                        user_hash,
                        character_id,
                        target_message_id,
                        {
                            "content": {"text": final_text},
                            "metadata": final_metadata,
                        },
                    ) or {
                        **target_message,
                        "content": {"text": final_text},
                        "metadata": final_metadata,
                    }
                    if final_message is not None:
                        final_message["metadata"] = {**(final_message.get("metadata") or {}), **final_metadata}

                    yield self._encode_stream_event(
                        {
                            "type": "done",
                            "message_id": target_message_id,
                            "text": final_text,
                            "message": final_message,
                        }
                    )
                    return

                if attempt < max_attempts:
                    continue

                error_text = "The AI didn't return any text after two attempts. Please try again."
                restored_message = copy.deepcopy(target_message)
                restored_message["content"] = copy.deepcopy(original_content)
                restored_message = {
                    **target_message,
                    "content": copy.deepcopy(original_content),
                    "metadata": copy.deepcopy(original_metadata),
                }
                if original_snapshots:
                    restored_message["snapshots"] = copy.deepcopy(original_snapshots)
                yield self._encode_stream_event({"type": "assistant_message", "message": restored_message})
                yield self._encode_stream_event(
                    {
                        "type": "error",
                        "message_id": target_message_id,
                        "error": error_text,
                    }
                )
                return

        return event_stream()

    def stream_chat_response(
        self,
        user_hash: str,
        character_id: str,
        *,
        user_message: Dict[str, Any],
        session_id: Optional[str] = None,
    ):
        generation_settings = self.get_generation_settings(user_hash)
        provider = (generation_settings.get("provider") or "openai").lower()
        model = generation_settings.get("model")
        if not model:
            raise ValueError("No model configured. Please update generation settings.")

        if provider not in {"openai", "gemini"}:
            raise ValueError(f"Streaming is not supported for provider '{provider}'.")

        history = self.histories.get_history(user_hash, character_id, session_id=session_id)
        provider_messages = self.build_provider_messages(user_hash, character_id, history, session_id=session_id)

        # Detect ephemeral instruction (e.g., [Continue xyz]) and include as a SYSTEM directive only,
        # without saving to history or emitting as a separate user_message event.
        ephemeral_instruction = self._is_ephemeral_instruction(user_message)
        if ephemeral_instruction:
            seed = self._extract_continue_seed(user_message)
            provider_messages.append({"role": "system", "content": self._build_continue_instruction_text(seed)})

        reference_id = user_message.get("id")
        assistant_message = self.append_message(
            user_hash,
            character_id,
            role="assistant",
            content={"text": ""},
            metadata={
                "provider": provider,
                "streaming": True,
                "reference_id": reference_id,
                "generated_at": time.time(),
            },
            reference_id=reference_id,
            session_id=session_id,
        )

        stream_kwargs = {
            "temperature": generation_settings.get("temperature"),
            "max_tokens": generation_settings.get("max_tokens"),
        }
        overrides = generation_settings.get("overrides")
        user_api_key = generation_settings.get("api_key")

        def event_stream():
            if not ephemeral_instruction:
                yield self._encode_stream_event({"type": "user_message", "message": user_message})
            yield self._encode_stream_event({"type": "assistant_message", "message": assistant_message})

            max_attempts = 2
            for attempt in range(1, max_attempts + 1):
                accumulated: List[str] = []
                try:
                    for delta in self._generate_stream_deltas(
                        provider=provider,
                        model=model,
                        provider_messages=provider_messages,
                        stream_kwargs=stream_kwargs,
                        overrides=overrides,
                        user_api_key=user_api_key,
                    ):
                        if not delta:
                            continue
                        accumulated.append(delta)
                        current_text = "".join(accumulated)
                        updated = self.update_message(
                            user_hash,
                            character_id,
                            assistant_message["id"],
                            {
                                "content": {"text": current_text},
                                "metadata": {"streaming": True},
                            },
                            session_id=session_id,
                        )
                        payload = {
                            "type": "delta",
                            "message_id": assistant_message["id"],
                            "delta": delta,
                            "text": current_text,
                        }
                        if updated is not None:
                            payload["message"] = updated
                        yield self._encode_stream_event(payload)
                except Exception as exc:  # noqa: BLE001
                    error_metadata = {
                        "provider": provider,
                        "streaming": False,
                        "error": str(exc),
                        "generated_at": time.time(),
                    }
                    self.update_message(
                        user_hash,
                        character_id,
                        assistant_message["id"],
                        {
                            "metadata": error_metadata,
                        },
                        session_id=session_id,
                    )
                    yield self._encode_stream_event(
                        {
                            "type": "error",
                            "message_id": assistant_message["id"],
                            "error": str(exc),
                        }
                    )
                    return

                final_text = "".join(accumulated).strip()
                if final_text:
                    final_metadata = {
                        "provider": provider,
                        "streaming": False,
                        "generated_at": time.time(),
                        "selected_snapshot_index": 0,
                    }
                    final_message = self.update_message(
                        user_hash,
                        character_id,
                        assistant_message["id"],
                        {
                            "content": {"text": final_text},
                            "metadata": final_metadata,
                        },
                        session_id=session_id,
                    ) or {**assistant_message, "content": {"text": final_text}, "metadata": final_metadata}
                    if final_message is not None:
                        final_message["metadata"] = {**(final_message.get("metadata") or {}), **final_metadata}

                    yield self._encode_stream_event(
                        {
                            "type": "done",
                            "message_id": assistant_message["id"],
                            "text": final_text,
                            "message": final_message,
                        }
                    )
                    return

                if attempt < max_attempts:
                    continue

                error_text = "The AI didn't return any text after two attempts. Please try again."
                self.delete_message(user_hash, character_id, assistant_message["id"], session_id=session_id)
                yield self._encode_stream_event(
                    {
                        "type": "error",
                        "message_id": assistant_message["id"],
                        "error": error_text,
                        "remove_message": True,
                    }
                )
                return

        return event_stream()

    def _encode_stream_event(self, payload: Dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False) + "\n"

    def _generate_stream_deltas(
        self,
        *,
        provider: str,
        model: str,
        provider_messages: List[Dict[str, Any]],
        stream_kwargs: Dict[str, Any],
        overrides: Optional[Dict[str, Any]],
        user_api_key: Optional[str],
    ):
        kwargs = {key: value for key, value in stream_kwargs.items() if value is not None}
        if provider == "gemini":
            conversation = self._convert_messages_for_gemini(provider_messages)
            async_gen = gemini_api.stream_chat(
                conversation=conversation,
                model=model,
                temperature=kwargs.get("temperature"),
                max_tokens=kwargs.get("max_tokens"),
                user_api_key=user_api_key,
            )
            yield from self._iterate_async_generator(async_gen)
            return

        # Default to OpenAI-compatible providers
        async_gen = openai_integration.stream_chat_completion(
            messages=provider_messages,
            model=model,
            provider=provider,
            user_api_key=user_api_key,
            overrides=overrides,
            **kwargs,
        )
        yield from self._iterate_async_generator(async_gen)

    def _iterate_async_generator(self, async_generator):
        queue: Queue = Queue()
        sentinel = object()

        def runner():
            async def consume():
                try:
                    async for item in async_generator:
                        queue.put(("chunk", item))
                    queue.put(("done", None))
                except Exception as exc:  # noqa: BLE001
                    queue.put(("error", exc))

            asyncio.run(consume())

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()

        while True:
            kind, value = queue.get()
            if kind == "chunk":
                yield value
            elif kind == "done":
                break
            elif kind == "error":
                raise value

    def _convert_messages_for_gemini(self, provider_messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        conversation: List[Dict[str, str]] = []
        for message in provider_messages:
            role = message.get("role", "user")
            content = message.get("content")
            text = self._flatten_content_for_gemini(content)
            if not text:
                continue
            gemini_role = "user" if role in {"system", "user"} else "model"
            conversation.append(
                {
                    "role": gemini_role,
                    "text": text,
                }
            )
        return conversation

    @staticmethod
    def _flatten_content_for_gemini(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            fragments: List[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                part_type = part.get("type")
                if part_type == "text" and part.get("text"):
                    fragments.append(part["text"])
                elif part_type == "image_url":
                    url = (part.get("image_url") or {}).get("url")
                    if url:
                        fragments.append(f"[Image: {url}]")
                elif part_type == "input_audio":
                    fragments.append("[Audio attachment]")
                elif part_type and part.get("text"):
                    fragments.append(part.get("text"))
            return "\n".join(fragments)
        if isinstance(content, dict):
            if "text" in content and isinstance(content["text"], str):
                return content["text"]
            return json.dumps(content, ensure_ascii=False)
        return str(content)

    def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._jobs.get(job_id)
            return dict(record) if record else None

    def _handle_ai_result(self, job_id: str, future, user_hash: str, character_id: str) -> None:
        with self._lock:
            job_context = dict(self._jobs.get(job_id, {}).get("context") or {})
        # Ensure we apply updates to the correct chat session
        session_id = job_context.get("session_id")
        try:
            result = future.result()
            text = self._extract_text_from_result(result)
            metadata = {
                "provider_response": result,
                "generated_at": time.time(),
                "action": job_context.get("action"),
            }

            action = job_context.get("action")
            target_message_id = job_context.get("message_id")
            reference_id = job_context.get("parent_id") or target_message_id

            if action == "regen" and target_message_id:
                history = self.histories.get_history(user_hash, character_id, session_id=session_id)
                existing_message = next((msg for msg in history if msg.get("id") == target_message_id), None)
                previous_snapshots = existing_message.get("snapshots", []) if existing_message else []
                selected_index = len(previous_snapshots) if previous_snapshots else 0
                regen_metadata = {**metadata, "regen": True, "selected_snapshot_index": selected_index}
                updated = self.update_message(
                    user_hash,
                    character_id,
                    target_message_id,
                    {
                        "content": {"text": text},
                        "metadata": regen_metadata,
                        "created_at": time.time(),
                    },
                    session_id=session_id,
                )
                message = updated or self.append_message(
                    user_hash,
                    character_id,
                    role="assistant",
                    content={"text": text},
                    metadata=regen_metadata,
                    reference_id=reference_id,
                    session_id=session_id,
                )
            else:
                if action == "swipe":
                    metadata["swipe"] = True
                if action == "continue" and job_context.get("seed"):
                    metadata["seed"] = job_context.get("seed")
                metadata.setdefault("selected_snapshot_index", 0)
                message = self.append_message(
                    user_hash,
                    character_id,
                    role="assistant",
                    content={"text": text},
                    metadata=metadata,
                    reference_id=reference_id,
                    session_id=session_id,
                )
            status_update = {
                "status": "completed",
                "completed_at": time.time(),
                "message": message,
                "context": {**job_context, "session_id": session_id},
            }
        except Exception as exc:  # noqa: BLE001
            status_update = {
                "status": "error",
                "completed_at": time.time(),
                "error": str(exc),
            }

        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(status_update)

    @staticmethod
    def _extract_text_from_result(result: Any) -> str:
        if not result:
            return ""
        if isinstance(result, dict):
            choices = result.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0]
                if isinstance(first, dict):
                    message = first.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, str):
                            return content
                        if isinstance(content, list):
                            fragments = []
                            for part in content:
                                if isinstance(part, dict):
                                    if part.get("type") == "text" and part.get("text"):
                                        fragments.append(part["text"])
                            if fragments:
                                return "\n".join(fragments)
                    if "text" in first:
                        return first["text"]
            if "text" in result:
                return result["text"]
            return str(result)
        return str(result)

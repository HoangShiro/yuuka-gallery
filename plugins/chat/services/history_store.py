import time
import uuid
from typing import Any, Dict, List, Optional


class ChatHistoryStore:
    """Persistence layer for chat histories per character."""

    filename = "chat_histories.json"

    def __init__(self, data_manager):
        self.data_manager = data_manager

    def all(self, user_hash: str) -> Dict[str, List[Dict[str, Any]]]:
        return self.data_manager.load_user_data(
            self.filename,
            user_hash,
            default_value={},
            obfuscated=True,
        )

    def list_sessions(self, user_hash: str) -> Dict[str, List[Dict[str, Any]]]:
        """Return a mapping of character_id -> list of session dicts.
        Backward compatible: legacy list will be treated as a single session.
        Each session dict: { "session_id", "messages", "created_at", "updated_at" }
        """
        data = self.all(user_hash)
        result: Dict[str, List[Dict[str, Any]]] = {}
        for character_id, value in (data or {}).items():
            sessions_list: List[Dict[str, Any]] = []
            if isinstance(value, dict) and "sessions" in value:
                for sid, sess in (value.get("sessions") or {}).items():
                    sessions_list.append({
                        "session_id": sid,
                        "messages": list(sess.get("messages") or []),
                        "created_at": sess.get("created_at"),
                        "updated_at": sess.get("updated_at"),
                    })
            else:
                # legacy format: value is a list of messages
                messages = list(value or [])
                created_at = messages[0].get("created_at") if messages else None
                updated_at = messages[-1].get("created_at") if messages else None
                sessions_list.append({
                    "session_id": None,
                    "messages": messages,
                    "created_at": created_at,
                    "updated_at": updated_at,
                })
            result[character_id] = sessions_list
        return result

    def get_history(self, user_hash: str, character_id: str, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        data = self.all(user_hash)
        value = data.get(character_id)
        history: List[Dict[str, Any]] = []
        resolved_sid: Optional[str] = session_id
        if isinstance(value, dict) and "sessions" in value:
            record = value
            sessions = record.get("sessions", {})
            target_sid = session_id or record.get("active_session_id")
            if not target_sid:
                # fallback to latest by updated_at
                if sessions:
                    target_sid = max(sessions.keys(), key=lambda sid: sessions[sid].get("updated_at") or 0)
            resolved_sid = target_sid
            history = list(sessions.get(target_sid, {}).get("messages", [])) if target_sid else []
        else:
            # legacy
            history = list(value or [])
        if not history:
            return history
        return self._prune_history(user_hash, character_id, history, session_id=resolved_sid)

    def save_history(self, user_hash: str, character_id: str, history: List[Dict[str, Any]], session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        all_histories = self.all(user_hash)
        value = all_histories.get(character_id)
        now = time.time()
        if isinstance(value, dict) and "sessions" in value:
            record = value
            target_sid = session_id or record.get("active_session_id")
            if not target_sid:
                target_sid = uuid.uuid4().hex[:8]
            sess = record.setdefault("sessions", {}).setdefault(target_sid, {"messages": [], "created_at": now, "updated_at": None})
            sess["messages"] = history
            sess["updated_at"] = history[-1].get("created_at") if history else now
            record["active_session_id"] = target_sid
            all_histories[character_id] = record
        else:
            # legacy: save plain list
            all_histories[character_id] = history
        self.data_manager.save_user_data(
            all_histories,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return history

    def _prune_history(
        self,
        user_hash: str,
        character_id: str,
        history: List[Dict[str, Any]],
        *,
        session_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        changed = False
        now = time.time()
        pruned: List[Dict[str, Any]] = []
        for message in history:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            message_type = message.get("type", "text")
            content = message.get("content") or {}
            metadata = message.get("metadata") or {}
            snapshots = message.get("snapshots")
            if isinstance(snapshots, list):
                filtered_snapshots = [
                    entry for entry in snapshots
                    if isinstance(entry, str) and entry.strip()
                ]
                if len(filtered_snapshots) != len(snapshots):
                    message["snapshots"] = filtered_snapshots
                    changed = True
                else:
                    message["snapshots"] = snapshots
            if role == "assistant" and message_type == "text":
                text = content.get("text", "")
                text_str = text if isinstance(text, str) else ""
                is_streaming = bool(metadata.get("streaming"))
                message_snapshots = message.get("snapshots") or []
                created_at = message.get("created_at") if isinstance(message.get("created_at"), (int, float)) else None
                age = (now - created_at) if created_at else None
                should_consider_prune = (
                    not is_streaming
                    and not text_str.strip()
                    and (not message_snapshots or all(not (entry.strip() if isinstance(entry, str) else "") for entry in message_snapshots))
                )
                if should_consider_prune and (age is None or age > 5):
                    if message_snapshots:
                        latest = message_snapshots[-1]
                        if content.get("text") != latest:
                            content["text"] = latest
                            message["content"] = content
                            changed = True
                    else:
                        changed = True
                        continue
            pruned.append(message)
        if changed:
            # IMPORTANT: always persist back to the same session to avoid cross-session overwrite.
            self.save_history(user_hash, character_id, pruned, session_id=session_id)
        return pruned

    def _calculate_snapshots(
        self,
        prev_snapshots: List[str],
        previous_metadata: Dict[str, Any],
        new_metadata: Dict[str, Any],
        new_text: str,
        metadata_patch: Optional[Dict[str, Any]] = None,
        content_patch: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        snapshots = list(prev_snapshots or [])
        metadata_patch = metadata_patch or {}
        content_patch = content_patch or {}
        prev_streaming = bool((previous_metadata or {}).get("streaming"))
        streaming_flag = bool((new_metadata or {}).get("streaming"))
        regen_flag = bool((new_metadata or {}).get("regen"))
        editing_flag = bool(snapshots) and bool(content_patch) and not metadata_patch and not streaming_flag

        if streaming_flag:
            if not prev_streaming:
                snapshots.append(new_text)
            elif snapshots:
                snapshots[-1] = new_text
            else:
                snapshots.append(new_text)
        else:
            selected_index = new_metadata.get("selected_snapshot_index")
            target_index = None
            if isinstance(selected_index, int) and 0 <= selected_index < len(snapshots):
                target_index = selected_index
            elif snapshots:
                target_index = len(snapshots) - 1

            if editing_flag:
                if target_index is None:
                    if new_text:
                        snapshots = [new_text]
                    return snapshots
                if 0 <= target_index < len(snapshots):
                    snapshots[target_index] = new_text
                elif new_text:
                    snapshots.append(new_text)
                return snapshots

            if prev_streaming:
                if snapshots:
                    snapshots[-1] = new_text
                elif new_text:
                    snapshots.append(new_text)
            elif new_text:
                if regen_flag and snapshots:
                    if snapshots[-1] != new_text:
                        snapshots.append(new_text)
                elif not snapshots or snapshots[-1] != new_text:
                    snapshots.append(new_text)

        return snapshots

    def upsert_message(
        self,
        user_hash: str,
        character_id: str,
        message: Dict[str, Any],
        *,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        history = self.get_history(user_hash, character_id, session_id=session_id)
        existing_index = next((i for i, msg in enumerate(history) if msg.get("id") == message.get("id")), None)
        role = message.get("role")
        content = message.get("content") or {}
        metadata = message.get("metadata") or {}
        text = content.get("text", "") or ""

        if role == "assistant":
            if existing_index is None:
                snapshots = []
                if text or metadata.get("streaming"):
                    snapshots = self._calculate_snapshots([], {}, metadata, text)
                message["snapshots"] = snapshots
                history.append(message)
            else:
                existing = history[existing_index]
                prev_snapshots = list(existing.get("snapshots", []))
                prev_metadata = existing.get("metadata") or {}
                snapshots = self._calculate_snapshots(prev_snapshots, prev_metadata, metadata, text)
                merged = {**existing, **message}
                merged["content"] = {**(existing.get("content") or {}), **content}
                merged["metadata"] = {**prev_metadata, **metadata}
                merged["snapshots"] = snapshots
                history[existing_index] = merged
                message = merged
        else:
            if existing_index is None:
                history.append(message)
            else:
                existing = history[existing_index]
                merged = {**existing, **message}
                merged["content"] = {**(existing.get("content") or {}), **content}
                merged["metadata"] = {**(existing.get("metadata") or {}), **metadata}
                history[existing_index] = merged
                message = merged

        self.save_history(user_hash, character_id, history, session_id=session_id)
        return message

    def delete_message(self, user_hash: str, character_id: str, message_id: str, *, session_id: Optional[str] = None) -> bool:
        history = self.get_history(user_hash, character_id, session_id=session_id)
        index = next((i for i, msg in enumerate(history) if msg.get("id") == message_id), None)
        if index is None:
            return False
        # Cascade delete: remove the message and everything after it.
        history = history[:index]
        self.save_history(user_hash, character_id, history, session_id=session_id)
        return True

    def delete_session(self, user_hash: str, character_id: str, session_id: Optional[str] = None) -> bool:
        """Delete a session for a character. If session_id is None, drop the entire character entry (legacy behavior)."""
        all_histories = self.all(user_hash)
        if character_id not in all_histories:
            return False
        value = all_histories.get(character_id)
        if session_id is None or not isinstance(value, dict) or "sessions" not in value:
            # delete entire entry
            del all_histories[character_id]
        else:
            sessions = value.get("sessions", {})
            if session_id in sessions:
                del sessions[session_id]
            # if no sessions remain, drop character key
            if not sessions:
                del all_histories[character_id]
            else:
                # adjust active_session_id if needed
                if value.get("active_session_id") == session_id:
                    # pick latest by updated_at
                    new_active = max(sessions.keys(), key=lambda sid: sessions[sid].get("updated_at") or 0)
                    value["active_session_id"] = new_active
                all_histories[character_id] = value
        self.data_manager.save_user_data(
            all_histories,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return True

    def create_session(self, user_hash: str, character_id: str) -> str:
        """Create a new empty session for a character and set it as active. Returns session_id.
        Migrates legacy histories to session format if needed.
        """
        all_histories = self.all(user_hash)
        value = all_histories.get(character_id)
        now = time.time()
        if not isinstance(value, dict) or "sessions" not in value:
            # migrate legacy list -> first session
            legacy_messages = list(value or [])
            legacy_created = legacy_messages[0].get("created_at") if legacy_messages else now
            legacy_updated = legacy_messages[-1].get("created_at") if legacy_messages else None
            legacy_sid = uuid.uuid4().hex[:8]
            value = {
                "sessions": {
                    legacy_sid: {
                        "messages": legacy_messages,
                        "created_at": legacy_created,
                        "updated_at": legacy_updated,
                    }
                },
                "active_session_id": legacy_sid,
            }
        new_sid = uuid.uuid4().hex[:8]
        value.setdefault("sessions", {})[new_sid] = {"messages": [], "created_at": now, "updated_at": None}
        value["active_session_id"] = new_sid
        all_histories[character_id] = value
        self.data_manager.save_user_data(
            all_histories,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return new_sid

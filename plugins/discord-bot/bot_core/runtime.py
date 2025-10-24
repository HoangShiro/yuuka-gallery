from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, List, Optional

from .logging import BotLogBuffer
from .utils import _format_datetime, normalize_timestamp


@dataclass
class BotRuntime:
    user_hash: str
    bot_id: str
    config: dict
    log_buffer: BotLogBuffer = field(default_factory=BotLogBuffer)
    state: str = "idle"  # idle | starting | running | stopping | stopped | error
    last_error: Optional[str] = None
    task: Optional["ManagedThreadTask"] = None  # type: ignore[name-defined]
    runner: Optional["DiscordBotRunner"] = None  # type: ignore[name-defined]
    lock: threading.RLock = field(default_factory=threading.RLock)
    intents: List[str] = field(default_factory=list)
    started_at: Optional[datetime] = None
    actual_name: Optional[str] = None
    persist_name_callback: Optional[Callable[[str], None]] = None

    def update_state(self, state: str, error: Optional[str] = None) -> None:
        with self.lock:
            self.state = state
            if error:
                self.last_error = error

    def snapshot(self) -> dict:
        with self.lock:
            display_name = self.actual_name or self.config.get("name") or "Unnamed bot"
            started_at_str = _format_datetime(self.started_at)
            fallback_updated = normalize_timestamp(self.config.get("updated_at"))
            updated_at_str = started_at_str or fallback_updated
            return {
                "bot_id": self.bot_id,
                "name": display_name,
                "actual_name": self.actual_name,
                "modules": self.config.get("modules", []),
                "auto_start": bool(self.config.get("auto_start", False)),
                "intents": list(self.intents) or self.config.get("intents", []),
                "started_at": started_at_str,
                "updated_at": updated_at_str,
                "state": self.state,
                "last_error": self.last_error,
            }


__all__ = ["BotRuntime"]

from __future__ import annotations

import threading
from collections import deque
from typing import List, Optional

from .utils import _iso_now


class BotLogBuffer:
    """Thread-safe log buffer with sequence numbers for incremental fetch."""

    def __init__(self, max_entries: int = 500):
        self._entries = deque(maxlen=max_entries)
        self._lock = threading.Lock()
        self._seq = 0

    def add(self, level: str, message: str, *, metadata: Optional[dict] = None) -> None:
        timestamp = _iso_now()
        entry = {
            "seq": None,
            "timestamp": timestamp,
            "level": level,
            "message": message,
            "metadata": metadata or {},
        }
        with self._lock:
            self._seq += 1
            entry["seq"] = self._seq
            self._entries.append(entry)

    def get_since(self, seq: int) -> List[dict]:
        with self._lock:
            if seq <= 0:
                return list(self._entries)
            return [entry for entry in self._entries if entry["seq"] > seq]

    def reset(self) -> None:
        with self._lock:
            self._entries.clear()
            self._seq = 0


__all__ = ["BotLogBuffer"]

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def _format_datetime(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_now() -> str:
    formatted = _format_datetime(datetime.now(timezone.utc))
    return formatted or datetime.now(timezone.utc).isoformat()


def normalize_timestamp(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = value.strip()
    try:
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        parsed = datetime.fromisoformat(cleaned)
        normalized = _format_datetime(parsed)
        return normalized or value
    except Exception:  # noqa: BLE001
        return value


__all__ = ["_format_datetime", "_iso_now", "normalize_timestamp"]

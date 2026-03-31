from __future__ import annotations

from abc import ABC, abstractmethod

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer


class BotModule(ABC):
    """Base class for optional bot modules."""

    module_id: str = "core.base"
    name: str = "Base"
    description: str = "Base module."
    module_type: str = "normal"
    admin: bool = False

    def get_dashboard_ui(self) -> dict:
        return {}

    def get_policy_definitions(self) -> list[dict]:
        return []

    @abstractmethod
    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - interface
        raise NotImplementedError


__all__ = ["BotModule"]

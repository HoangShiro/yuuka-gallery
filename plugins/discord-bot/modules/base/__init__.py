from __future__ import annotations

from abc import ABC, abstractmethod

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer


class BotModule(ABC):
    """Base class for optional bot modules."""

    module_id: str = "core.base"
    name: str = "Base"
    description: str = "Base module."

    @abstractmethod
    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - interface
        raise NotImplementedError


__all__ = ["BotModule"]

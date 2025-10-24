from __future__ import annotations

try:  # py-cord
    import discord  # type: ignore[import-not-found]
    from discord.ext import commands  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - graceful degradation if py-cord missing
    discord = None
    commands = None

__all__ = ["discord", "commands"]

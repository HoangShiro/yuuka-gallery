from __future__ import annotations

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer

from modules.base import BotModule


class PingModule(BotModule):
    module_id = "core.ping"
    name = "Ping"
    description = "Provides !ping command that replies with Pong!"

    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - relies on discord runtime
        @bot.command(name="ping")
        async def ping(ctx):
            await ctx.reply("Pong!")
            log.add("info", f"[{ctx.guild}] {ctx.author} used !ping")


__all__ = ["PingModule"]

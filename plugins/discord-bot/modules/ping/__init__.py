from __future__ import annotations

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer

from modules.base import BotModule


class PingModule(BotModule):
    module_id = "core.ping"
    name = "Ping"
    description = "Provides !ping command that replies with Pong!"

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Quick latency/availability check command for Discord guilds.",
            "sections": [
                {
                    "title": "Command",
                    "items": [
                        {"label": "Trigger", "value": "!ping"},
                        {"label": "Response", "value": "Pong!"},
                    ],
                },
                {
                    "title": "Usage",
                    "text": "Use this module to quickly verify that the bot is online and listening in a channel.",
                },
            ],
        }

    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - relies on discord runtime
        @bot.command(name="ping")
        async def ping(ctx):
            await ctx.reply("Pong!")
            log.add("info", f"[{ctx.guild}] {ctx.author} used !ping")


__all__ = ["PingModule"]

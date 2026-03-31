from __future__ import annotations

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer

from modules.base import BotModule


class EchoModule(BotModule):
    module_id = "core.echo"
    name = "Echo"
    description = "Repeats back messages starting with !echo."

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Echoes user-provided text back to the channel for quick bot interaction tests.",
            "sections": [
                {
                    "title": "Command",
                    "items": [
                        {"label": "Trigger", "value": "!echo <text>"},
                        {"label": "Behavior", "value": "Replies with the exact provided text"},
                    ],
                },
                {
                    "title": "Tip",
                    "text": "Useful for checking message parsing and permission setup in each guild/channel.",
                },
            ],
        }

    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - relies on discord runtime
        @bot.command(name="echo")
        async def echo(ctx, *, content: str):
            await ctx.reply(content)
            log.add("info", f"[{ctx.guild}] {ctx.author} echoed: {content}")


__all__ = ["EchoModule"]

from __future__ import annotations

from bot_core.discord_imports import commands
from bot_core.logging import BotLogBuffer

from modules.base import BotModule


class EchoModule(BotModule):
    module_id = "core.echo"
    name = "Echo"
    description = "Repeats back messages starting with !echo."

    def setup(self, bot: "commands.Bot", log: BotLogBuffer) -> None:  # pragma: no cover - relies on discord runtime
        @bot.command(name="echo")
        async def echo(ctx, *, content: str):
            await ctx.reply(content)
            log.add("info", f"[{ctx.guild}] {ctx.author} echoed: {content}")


__all__ = ["EchoModule"]

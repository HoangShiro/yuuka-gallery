from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone
from typing import List, Optional

from .discord_imports import commands, discord
from .logging import BotLogBuffer
from .runtime import BotRuntime
from modules import AVAILABLE_MODULES, DEFAULT_MODULE_IDS


class DiscordBotRunner:
    """Wraps discord.Bot lifecycle inside a managed thread."""

    def __init__(self, runtime: BotRuntime):
        self.runtime = runtime
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._client: Optional[commands.Bot] = None  # type: ignore[assignment]
        self._stop_ack = threading.Event()

    @property
    def log(self) -> BotLogBuffer:
        return self.runtime.log_buffer

    def run(self, stop_event: threading.Event) -> None:
        if discord is None or commands is None:
            self.runtime.update_state("error", "py-cord is not installed.")
            self.log.add("error", "py-cord (discord) is not installed. Install 'py-cord' to enable the bot.")
            return

        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True

        self.runtime.intents = self._intents_to_list(intents)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        bot = commands.Bot(command_prefix="!", intents=intents)
        self._client = bot

        @bot.event
        async def on_ready():
            self.runtime.update_state("running")
            self.runtime.started_at = datetime.now(timezone.utc)
            try:
                display_name = getattr(bot.user, "display_name", None) or getattr(bot.user, "name", None)
                if display_name:
                    resolved_name = str(display_name)
                    self.runtime.actual_name = resolved_name
                    self.runtime.config["name"] = resolved_name
                    callback = self.runtime.persist_name_callback
                    if callable(callback):
                        try:
                            callback(resolved_name)
                        except Exception as cb_err:  # noqa: BLE001
                            self.log.add("warning", f"Failed to persist bot name: {cb_err}")
            except Exception:
                self.runtime.actual_name = None
            self.log.add(
                "info",
                f"Connected as {bot.user} (ID: {bot.user.id}) - Guilds: {len(bot.guilds)}",
            )

        @bot.event
        async def on_disconnect():
            self.log.add("warning", "Disconnected from Discord gateway.")

        @bot.event
        async def on_resumed():
            self.log.add("info", "Session resumed from Discord.")

        self._load_modules(bot)

        async def watchdog():
            while not stop_event.is_set():
                await asyncio.sleep(1.0)
            await self._shutdown_client()

        async def runner():
            token = self.runtime.config.get("token")
            if not token:
                raise RuntimeError("Discord token is missing.")
            await asyncio.gather(
                watchdog(),
                self._start_bot(token),
            )

        try:
            self.runtime.update_state("starting")
            self.log.add("info", "Starting Discord bot runner...")
            loop.run_until_complete(runner())
        except Exception as exc:  # noqa: BLE001
            if not isinstance(exc, asyncio.CancelledError):
                self.runtime.update_state("error", str(exc))
                self.log.add("error", f"Bot runtime crashed: {exc}")
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:  # noqa: BLE001
                pass
            asyncio.set_event_loop(None)
            loop.close()
            self._stop_ack.set()
            self.runtime.update_state("stopped")
            self.log.add("info", "Discord bot thread terminated.")
            self.runtime.started_at = None
            self.runtime.actual_name = None

    async def _start_bot(self, token: str) -> None:
        assert self._client is not None
        try:
            await self._client.start(token)
        except discord.LoginFailure as exc:
            raise RuntimeError(f"Login failed: {exc}") from exc
        except discord.DiscordException as exc:
            raise RuntimeError(f"Discord error: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Unexpected error: {exc}") from exc

    async def _shutdown_client(self) -> None:
        client = self._client
        if not client:
            return
        if client.is_closed():
            return
        try:
            self.log.add("info", "Closing Discord client...")
            await client.close()
        except Exception as exc:  # noqa: BLE001
            self.log.add("error", f"Error while closing client: {exc}")

    def request_shutdown(self) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(lambda: asyncio.create_task(self._shutdown_client()))
        else:
            self._stop_ack.set()

    def wait_for_stop(self, timeout: float) -> bool:
        return self._stop_ack.wait(timeout)

    def _load_modules(self, bot: commands.Bot) -> None:  # type: ignore[valid-type]
        configured_modules = self.runtime.config.get("modules") or []
        if not configured_modules:
            configured_modules = list(DEFAULT_MODULE_IDS)

        for module_id in configured_modules:
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                self.log.add("warning", f"Module '{module_id}' not found; skipping.")
                continue
            try:
                module.setup(bot, self.log)
                self.log.add("info", f"Loaded module: {module.name}")
            except Exception as exc:  # noqa: BLE001
                self.log.add("error", f"Module '{module_id}' failed to load: {exc}")

    @staticmethod
    def _intents_to_list(intents: "discord.Intents") -> List[str]:  # type: ignore[valid-type]
        names = []
        # Iterating Intents yields tuples (name, value)
        for name, value in intents:
            if value:
                names.append(name)
        if getattr(intents, "message_content", False) and "message_content" not in names:
            names.append("message_content")
        return sorted(set(names))


__all__ = ["DiscordBotRunner"]

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .logging import BotLogBuffer
from .runtime import BotRuntime

_NODE_SCRIPT = Path(__file__).resolve().parent / "js_runner" / "discord_bot_runner.cjs"


def is_js_runtime_available() -> bool:
    return bool(shutil.which("node")) and _NODE_SCRIPT.exists()


class DiscordBotRunner:
    """Runs a discord.js process and bridges logs/state back into BotRuntime."""

    def __init__(self, runtime: BotRuntime):
        self.runtime = runtime
        self._process: Optional[subprocess.Popen] = None
        self._stop_ack = threading.Event()
        self._shutdown_requested = threading.Event()

    @property
    def log(self) -> BotLogBuffer:
        return self.runtime.log_buffer

    def run(self, stop_event: threading.Event) -> None:
        node_bin = shutil.which("node")
        if not node_bin:
            self.runtime.update_state("error", "Node.js is not installed.")
            self.log.add("error", "Node.js is required to run discord.js bot. Install Node.js and retry.")
            self._stop_ack.set()
            return
        if not _NODE_SCRIPT.exists():
            self.runtime.update_state("error", "discord.js runner script is missing.")
            self.log.add("error", f"Runner script not found: {_NODE_SCRIPT}")
            self._stop_ack.set()
            return

        cache_root = Path(__file__).resolve().parents[3] / "data_cache" / "discord-bot" / self.runtime.user_hash / self.runtime.bot_id
        config_payload = {
            "token": (self.runtime.config.get("token") or "").strip(),
            "bot_id": self.runtime.bot_id,
            "modules": list(self.runtime.config.get("modules") or []),
            "intents": list(self.runtime.config.get("intents") or []),
            "user_hash": self.runtime.user_hash,
            "cache_dir": str(cache_root),
            "runtime_api_base_url": self.runtime.config.get("runtime_api_base_url") or "http://127.0.0.1:5000/api/plugin/discord-bot/runtime",
            "runtime_secret": str(self.runtime.config.get("runtime_secret") or "").strip(),
            "chat_character_id": (self.runtime.config.get("chat_character_id") or "").strip(),
            "chat_character_name": (self.runtime.config.get("chat_character_name") or "").strip(),
            "chat_model": (self.runtime.config.get("chat_model") or "").strip(),
            "chat_bridge_url": (
                self.runtime.config.get("chat_bridge_url")
                or "http://127.0.0.1:5000/api/plugin/chat/generate/discord_bridge"
            ).strip(),
            "chat_bridge_key": (
                self.runtime.config.get("chat_bridge_key")
                or os.getenv("CHAT_BRIDGE_KEY", "")
            ).strip(),
            "chat_primary_language": (self.runtime.config.get("chat_primary_language") or "English").strip() or "English",
            "chat_secondary_language": (self.runtime.config.get("chat_secondary_language") or "Japanese").strip() or "Japanese",
            "chat_secondary_to_channel": bool(self.runtime.config.get("chat_secondary_to_channel", False)),
            "tts_engine": (self.runtime.config.get("tts_engine") or "aivisspeech").strip() or "aivisspeech",
            "tts_engine_base_url": (self.runtime.config.get("tts_engine_base_url") or "http://127.0.0.1:10101").strip() or "http://127.0.0.1:10101",
            "tts_speaker_id": str(self.runtime.config.get("tts_speaker_id") or "").strip(),
            "tts_speaker_name": str(self.runtime.config.get("tts_speaker_name") or "").strip(),
            "tts_speaker_avatar_url": (
                "" if str(self.runtime.config.get("tts_speaker_avatar_url") or "").strip().startswith("data:")
                else str(self.runtime.config.get("tts_speaker_avatar_url") or "").strip()
            ),
            "tts_text_source": str(self.runtime.config.get("tts_text_source") or "secondary").strip().lower() or "secondary",
            "tavily_api_key": str(self.runtime.config.get("tavily_api_key") or "").strip(),
            "tavily_max_results": self.runtime.config.get("tavily_max_results") or 5,
            "image_gen_character_hash": str(self.runtime.config.get("image_gen_character_hash") or "").strip(),
            "image_gen_character_name": str(self.runtime.config.get("image_gen_character_name") or "").strip(),
            "image_gen_server_address": str(self.runtime.config.get("image_gen_server_address") or "").strip(),
            "image_gen_ckpt_name": str(self.runtime.config.get("image_gen_ckpt_name") or "").strip(),
            "image_gen_lora_name": str(self.runtime.config.get("image_gen_lora_name") or "").strip(),
            "image_gen_sampler_name": str(self.runtime.config.get("image_gen_sampler_name") or "").strip(),
            "image_gen_scheduler": str(self.runtime.config.get("image_gen_scheduler") or "").strip(),
            "image_gen_quality": str(self.runtime.config.get("image_gen_quality") or "").strip(),
            "image_gen_negative": str(self.runtime.config.get("image_gen_negative") or "").strip(),
            "image_gen_outfits": str(self.runtime.config.get("image_gen_outfits") or "").strip(),
            "image_gen_expression": str(self.runtime.config.get("image_gen_expression") or "").strip(),
            "image_gen_action": str(self.runtime.config.get("image_gen_action") or "").strip(),
            "image_gen_context": str(self.runtime.config.get("image_gen_context") or "").strip(),
            "image_gen_width": self.runtime.config.get("image_gen_width"),
            "image_gen_height": self.runtime.config.get("image_gen_height"),
            "image_gen_steps": self.runtime.config.get("image_gen_steps"),
            "image_gen_cfg": self.runtime.config.get("image_gen_cfg"),
            "policies": self.runtime.config.get("policies") or {},
            "brain_tools": self.runtime.config.get("brain_tools") or {"toggles": {}},
        }
        if not config_payload["token"]:
            self.runtime.update_state("error", "Discord token is missing.")
            self.log.add("error", "Discord token is missing.")
            self._stop_ack.set()
            return

        cache_root.mkdir(parents=True, exist_ok=True)
        launch_config_path = cache_root / "launch_config.json"
        with launch_config_path.open("w", encoding="utf-8") as config_file:
            json.dump(config_payload, config_file, ensure_ascii=True)

        cmd = [
            node_bin,
            str(_NODE_SCRIPT),
            "--config-file",
            str(launch_config_path),
        ]

        try:
            self.runtime.update_state("starting")
            self.log.add("info", "Starting discord.js runner...")
            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except Exception as exc:  # noqa: BLE001
            self.runtime.update_state("error", str(exc))
            self.log.add("error", f"Failed to start discord.js runner: {exc}")
            self._stop_ack.set()
            return

        stdout_thread = threading.Thread(target=self._stream_stdout, daemon=True)
        stderr_thread = threading.Thread(target=self._stream_stderr, daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        try:
            while True:
                if stop_event.is_set():
                    self.request_shutdown()
                process = self._process
                if process is None:
                    break
                exit_code = process.poll()
                if exit_code is not None:
                    if exit_code != 0 and self.runtime.state != "error":
                        self.runtime.update_state("error", f"discord.js process exited with code {exit_code}.")
                        self.log.add("error", f"discord.js process exited with code {exit_code}.")
                    break
                stop_event.wait(0.35)
        finally:
            stdout_thread.join(timeout=1.0)
            stderr_thread.join(timeout=1.0)
            self._cleanup_process()
            # We keep started_at/actual_name/actual_id for the UI to show the last known state
            if self.runtime.state != "error":
                self.runtime.update_state("stopped")
            self.log.add("info", "discord.js runner terminated.")
            self._stop_ack.set()

    def _stream_stdout(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            self._handle_event_line(line)

    def _stream_stderr(self) -> None:
        process = self._process
        if not process or not process.stderr:
            return
        for raw_line in process.stderr:
            line = raw_line.strip()
            if line:
                self.log.add("warning", f"[discord.js stderr] {line}")

    def _handle_event_line(self, line: str) -> None:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            self.log.add("info", line)
            return

        event = payload.get("event")
        if event == "log":
            level = payload.get("level") or "info"
            message = payload.get("message") or ""
            self.log.add(level, str(message))
            return

        if event == "ready":
            intents = payload.get("intents") or []
            self.runtime.intents = [str(name) for name in intents]
            started_at = self._parse_iso_timestamp(payload.get("started_at"))
            self.runtime.started_at = started_at or datetime.now(timezone.utc)

            resolved_id = (payload.get("actual_id") or "").strip()
            self.runtime.actual_id = resolved_id or None

            resolved_name = (payload.get("actual_name") or "").strip()
            self.runtime.actual_name = resolved_name or None
            if resolved_name:
                self.runtime.config["name"] = resolved_name
                callback = self.runtime.persist_name_callback
                if callable(callback):
                    try:
                        callback(resolved_name)
                    except Exception as exc:  # noqa: BLE001
                        self.log.add("warning", f"Failed to persist bot name: {exc}")

            resolved_avatar = (payload.get("avatar_url") or "").strip()
            self.runtime.avatar_url = resolved_avatar or None
            if resolved_avatar:
                self.runtime.config["avatar_url"] = resolved_avatar

            self.runtime.update_state("running")
            return

        if event == "error":
            message = payload.get("message") or "Unknown discord.js error."
            self.runtime.update_state("error", str(message))
            self.log.add("error", str(message))
            return

        if event == "intents":
            intents = payload.get("intents") or []
            self.runtime.intents = [str(name) for name in intents]
            return

        if event == "stopped":
            self.runtime.update_state("stopped")
            return

        if event == "core_config_sync":
            patch = payload.get("patch")
            if isinstance(patch, dict) and patch:
                try:
                    self.runtime.config.update(patch)
                    callback = self.runtime.persist_config_callback
                    if callable(callback):
                        callback(patch)
                except Exception as exc:  # noqa: BLE001
                    self.log.add("warning", f"Failed to persist runtime config sync: {exc}")
            return

    @staticmethod
    def _parse_iso_timestamp(raw_value: object) -> Optional[datetime]:
        if not isinstance(raw_value, str) or not raw_value.strip():
            return None
        value = raw_value.strip()
        try:
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:  # noqa: BLE001
            return None

    def request_shutdown(self) -> None:
        if self._shutdown_requested.is_set():
            return
        self._shutdown_requested.set()

        process = self._process
        if not process:
            self._stop_ack.set()
            return

        try:
            if process.stdin and not process.stdin.closed:
                process.stdin.write("STOP\n")
                process.stdin.flush()
            self.log.add("info", "Shutdown signal sent to discord.js runner.")
        except Exception as exc:  # noqa: BLE001
            self.log.add("warning", f"Failed to send graceful stop signal: {exc}")
            self._terminate_process()

    def wait_for_stop(self, timeout: float) -> bool:
        return self._stop_ack.wait(timeout)

    def _terminate_process(self) -> None:
        process = self._process
        if not process:
            return
        if process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=3)
        except Exception:  # noqa: BLE001
            try:
                process.kill()
            except Exception:
                pass

    def _cleanup_process(self) -> None:
        process = self._process
        if not process:
            return
        if process.poll() is None:
            self._terminate_process()
        try:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
        except Exception:
            pass
        self._process = None


__all__ = ["DiscordBotRunner", "is_js_runtime_available"]

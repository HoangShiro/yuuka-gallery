from __future__ import annotations

import os
import sys
import threading
from typing import Dict, List, Optional, Tuple

from flask import Blueprint, abort, jsonify, request

PLUGIN_DIR = os.path.dirname(__file__)
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from bot_core import (
    BotRuntime,
    DiscordBotRunner,
    _format_datetime,
    _iso_now,
    discord,
    normalize_timestamp,
)
from modules import AVAILABLE_MODULES, DEFAULT_MODULE_IDS


class DiscordBotPlugin:
    CONFIG_FILENAME = "discord_bot.json"

    def __init__(self, core_api):
        self.core_api = core_api
        self.plugin_id = getattr(self, "plugin_id", "discord-bot")
        self.blueprint = Blueprint("discord_bot", __name__)
        self._runtimes: Dict[str, Dict[str, BotRuntime]] = {}
        self._lock = threading.RLock()

        self._register_routes()
        print("[Plugin:DiscordBot] Backend initialized.")

    # ------------------------------------------------------------------ #
    # Blueprint / routes
    # ------------------------------------------------------------------ #
    def get_blueprint(self) -> Tuple[Blueprint, str]:
        return self.blueprint, "/api/plugin/discord-bot"

    def _register_routes(self) -> None:
        @self.blueprint.route("/bots", methods=["GET"])
        def list_bots():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            configs = self._load_user_configs(user_hash)
            runtimes = self._runtimes.get(user_hash, {})
            tasks_state = self.core_api.get_background_task_status(self.plugin_id)
            task_entries = tasks_state.get(self.plugin_id, {})

            bots = []
            for bot_id, bot_cfg in configs.get("bots", {}).items():
                runtime = runtimes.get(bot_id)
                normalized_created = normalize_timestamp(bot_cfg.get("created_at"))
                normalized_updated = normalize_timestamp(bot_cfg.get("updated_at"))
                snapshot = runtime.snapshot() if runtime else {
                    "bot_id": bot_id,
                    "name": bot_cfg.get("name") or "Unnamed bot",
                    "actual_name": bot_cfg.get("name"),
                    "modules": bot_cfg.get("modules", list(DEFAULT_MODULE_IDS)),
                    "auto_start": bool(bot_cfg.get("auto_start", False)),
                    "intents": bot_cfg.get("intents", self._default_intents_list()),
                    "started_at": None,
                    "updated_at": normalized_updated,
                    "state": "stopped",
                    "last_error": None,
                }
                if not snapshot.get("intents"):
                    snapshot["intents"] = bot_cfg.get("intents", self._default_intents_list())
                if runtime and runtime.started_at and not snapshot.get("started_at"):
                    snapshot["started_at"] = _format_datetime(runtime.started_at)
                if runtime and runtime.actual_name and not snapshot.get("actual_name"):
                    snapshot["actual_name"] = runtime.actual_name
                if not snapshot.get("updated_at") and normalized_updated:
                    snapshot["updated_at"] = normalized_updated
                task_info = task_entries.get(self._task_name(user_hash, bot_id), {})
                bots.append({
                    **snapshot,
                    "created_at": normalized_created,
                    "updated_at": snapshot.get("updated_at") or normalized_updated,
                    "task": task_info,
                })

            return jsonify({
                "py_cord_available": discord is not None,
                "available_modules": self._available_modules_summary(),
                "bots": bots,
            })

        @self.blueprint.route("/bots", methods=["POST"])
        def create_or_update_bot():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            payload = request.json or {}
            bot_id = payload.get("bot_id") or "default"
            token = (payload.get("token") or "").strip()
            name = (payload.get("name") or "My Discord Bot").strip()
            modules = payload.get("modules") or []
            auto_start = bool(payload.get("auto_start", False))

            if not token:
                abort(400, description="Discord bot token is required.")
            sanitized_modules = []
            for module_id in modules:
                if module_id in AVAILABLE_MODULES and module_id not in sanitized_modules:
                    sanitized_modules.append(module_id)
            modules = sanitized_modules or list(DEFAULT_MODULE_IDS)

            config = self._load_user_configs(user_hash)
            bots = config.setdefault("bots", {})
            existing_entry = bots.get(bot_id, {})
            intents_list = list(existing_entry.get("intents") or self._default_intents_list())
            bots[bot_id] = {
                "token": token,
                "name": name,
                "modules": modules,
                "auto_start": auto_start,
                "intents": intents_list,
                "created_at": existing_entry.get("created_at") or _iso_now(),
                "updated_at": _iso_now(),
            }
            self._save_user_configs(user_hash, config)
            runtime = self._get_or_create_runtime(user_hash, bot_id, bots[bot_id])
            runtime.update_state("stopped")
            runtime.log_buffer.add("info", "Configuration updated.")

            return jsonify({"status": "ok", "bot_id": bot_id})

        @self.blueprint.route("/bots/<bot_id>/start", methods=["POST"])
        def start_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id)
            if runtime.state in {"starting", "running"}:
                abort(409, description="Bot is already running.")

            self._start_runtime(user_hash, runtime)
            return jsonify({"status": "starting"})

        @self.blueprint.route("/bots/<bot_id>/stop", methods=["POST"])
        def stop_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id)
            self._stop_runtime(runtime, timeout=10.0)
            return jsonify({"status": "stopping"})

        @self.blueprint.route("/bots/<bot_id>/restart", methods=["POST"])
        def restart_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id)
            self._stop_runtime(runtime, timeout=10.0)
            self._start_runtime(user_hash, runtime)
            return jsonify({"status": "restarting"})

        @self.blueprint.route("/bots/<bot_id>/kill", methods=["POST"])
        def kill_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id)
            self._stop_runtime(runtime, timeout=2.0, mark_killed=True)
            return jsonify({"status": "terminated"})

        @self.blueprint.route("/bots/<bot_id>/logs", methods=["GET"])
        def bot_logs(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id)
            after_seq = int(request.args.get("after", "0"))
            logs = runtime.log_buffer.get_since(after_seq)
            return jsonify({"status": "ok", "logs": logs})

        @self.blueprint.route("/modules", methods=["GET"])
        def list_modules():
            self.core_api.verify_token_and_get_user_hash()
            return jsonify({"modules": self._available_modules_summary()})

    # ------------------------------------------------------------------ #
    # Runtime helpers
    # ------------------------------------------------------------------ #
    def _task_name(self, user_hash: str, bot_id: str) -> str:
        return f"{user_hash}:{bot_id}"

    @staticmethod
    def _default_intents_list() -> List[str]:
        return ["guilds", "members", "message_content"]

    def _persist_bot_name(self, user_hash: str, bot_id: str, new_name: str) -> None:
        if not new_name:
            return
        try:
            configs = self._load_user_configs(user_hash)
            bots_cfg = configs.get("bots", {})
            bot_entry = bots_cfg.get(bot_id)
            if bot_entry is None:
                return
            if bot_entry.get("name") == new_name:
                return
            bot_entry["name"] = new_name
            bot_entry["updated_at"] = _iso_now()
            self._save_user_configs(user_hash, configs)
        except Exception as exc:  # noqa: BLE001
            print(f"[DiscordBotPlugin] Failed to persist name for {bot_id}: {exc}")

    def _available_modules_summary(self) -> List[dict]:
        return [
            {
                "id": module_id,
                "name": module.name,
                "description": module.description,
            }
            for module_id, module in AVAILABLE_MODULES.items()
        ]

    def _load_user_configs(self, user_hash: str) -> dict:
        configs = self.core_api.data_manager.load_user_data(
            self.CONFIG_FILENAME,
            user_hash,
            default_value={"bots": {}},
            obfuscated=True,
        )
        for bot_cfg in configs.get("bots", {}).values():
            if "intents" not in bot_cfg or not bot_cfg["intents"]:
                bot_cfg["intents"] = self._default_intents_list()
            normalized_created = normalize_timestamp(bot_cfg.get("created_at"))
            if normalized_created:
                bot_cfg["created_at"] = normalized_created
            normalized_updated = normalize_timestamp(bot_cfg.get("updated_at"))
            if normalized_updated:
                bot_cfg["updated_at"] = normalized_updated
        return configs

    def _save_user_configs(self, user_hash: str, config: dict) -> None:
        self.core_api.data_manager.save_user_data(
            config,
            self.CONFIG_FILENAME,
            user_hash,
            obfuscated=True,
        )

    def _get_or_create_runtime(self, user_hash: str, bot_id: str, config: dict) -> BotRuntime:
        with self._lock:
            user_runtimes = self._runtimes.setdefault(user_hash, {})
            runtime = user_runtimes.get(bot_id)
            if not runtime:
                runtime = BotRuntime(user_hash=user_hash, bot_id=bot_id, config=config)
                user_runtimes[bot_id] = runtime
            else:
                runtime.config = config
            intents_from_config = config.get("intents")
            runtime.intents = list(intents_from_config) if intents_from_config else self._default_intents_list()
            runtime.persist_name_callback = lambda new_name, uh=user_hash, bid=bot_id: self._persist_bot_name(uh, bid, new_name)
            return runtime

    def _ensure_runtime(self, user_hash: str, bot_id: str) -> BotRuntime:
        config = self._load_user_configs(user_hash)
        bot_config = config.get("bots", {}).get(bot_id)
        if not bot_config:
            abort(404, description=f"Bot '{bot_id}' not found for current user.")
        return self._get_or_create_runtime(user_hash, bot_id, bot_config)

    def _start_runtime(self, user_hash: str, runtime: BotRuntime) -> None:
        runtime.update_state("starting")
        runtime.log_buffer.add("info", "Bootstrapping bot thread...")

        if runtime.task is None:
            task = self.core_api.register_background_task(
                self.plugin_id,
                self._task_name(user_hash, runtime.bot_id),
                self._bot_thread_entry,
                args=(runtime.user_hash, runtime.bot_id),
                pass_stop_event=True,
                stop_callback=lambda stop_evt, rt=runtime: self._stop_callback(rt, stop_evt),
                auto_start=False,
                auto_restart=False,
                daemon=True,
            )
            runtime.task = task

        runtime.config["updated_at"] = _iso_now()
        runtime.started_at = None
        runtime.actual_name = None
        runtime.task.start()

    def _stop_runtime(self, runtime: BotRuntime, *, timeout: float, mark_killed: bool = False) -> None:
        if not runtime.task:
            runtime.update_state("stopped")
            runtime.log_buffer.add("warning", "Bot was never started.")
            runtime.started_at = None
            runtime.actual_name = None
            runtime.config["updated_at"] = _iso_now()
            return

        runtime.update_state("stopping")
        runtime.log_buffer.add("info", "Stop requested." if not mark_killed else "Kill requested.")
        runtime.task.stop(timeout=timeout)
        if mark_killed and runtime.runner:
            runtime.runner.request_shutdown()
            runtime.runner.wait_for_stop(timeout)
        if runtime.task.status == "stopping_timeout":
            runtime.update_state("error", "Thread did not stop within timeout.")
            runtime.log_buffer.add("error", "Stop timeout reached; thread may still be running.")
        else:
            runtime.update_state("stopped")
            runtime.started_at = None
            runtime.actual_name = None
            runtime.config["updated_at"] = _iso_now()

    def _stop_callback(self, runtime: BotRuntime, stop_event: threading.Event) -> None:
        runtime.log_buffer.add("info", "Stop signal received. Shutting down bot...")
        if runtime.runner:
            runtime.runner.request_shutdown()

    def _bot_thread_entry(self, stop_event: threading.Event, user_hash: str, bot_id: str) -> None:
        runtime = self._ensure_runtime(user_hash, bot_id)
        runner = DiscordBotRunner(runtime)
        runtime.runner = runner
        try:
            runner.run(stop_event)
        except Exception as exc:  # noqa: BLE001
            runtime.update_state("error", str(exc))
            runtime.log_buffer.add("error", f"Bot thread crashed: {exc}")
        finally:
            runtime.runner = None
            runtime.update_state("stopped")
            runtime.started_at = None
            runtime.actual_name = None
            runtime.config["updated_at"] = _iso_now()
import os
import sys

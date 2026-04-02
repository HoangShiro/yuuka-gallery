from __future__ import annotations

import os
import sys
import threading
from typing import Dict, List, Tuple

from flask import Blueprint, abort, jsonify, request

PLUGIN_DIR = os.path.dirname(__file__)
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from bot_core import (
    BotRuntime,
    DiscordBotRunner,
    _format_datetime,
    _iso_now,
    is_js_runtime_available,
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

    def register_background_tasks(self, task_service) -> None:
        """
        PluginManager calls this on load. We use it to start bots with auto_start=True.
        """
        print("[Plugin:DiscordBot] Checking for auto-start bots...")
        all_configs = self.core_api.data_manager.read_json(
            self.CONFIG_FILENAME,
            default_value={},
            obfuscated=True,
        )

        for user_hash, config in all_configs.items():
            if not isinstance(config, dict):
                continue
            for bot_id, bot_cfg in config.get("bots", {}).items():
                if bot_cfg.get("auto_start"):
                    print(f"[Plugin:DiscordBot] Auto-starting bot '{bot_id}' for user '{user_hash}'...")
                    try:
                        # We don't know if this is an admin request, assume normal modules sanitization
                        runtime = self._get_or_create_runtime(user_hash, bot_id, bot_cfg)
                        self._start_runtime(user_hash, runtime)
                    except Exception as e:
                        print(f"[Plugin:DiscordBot] Failed to auto-start bot '{bot_id}': {e}")

    def _register_routes(self) -> None:
        @self.blueprint.route("/bots", methods=["GET"])
        def list_bots():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            is_admin = self._is_request_admin()
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
                snapshot["modules"] = self._sanitize_module_ids(snapshot.get("modules") or [], include_admin=is_admin) or self._default_module_ids(include_admin=is_admin)
                task_info = task_entries.get(self._task_name(user_hash, bot_id), {})
                bots.append({
                    **snapshot,
                    "created_at": normalized_created,
                    "updated_at": snapshot.get("updated_at") or normalized_updated,
                    "task": task_info,
                })

            return jsonify({
                "js_runtime_available": is_js_runtime_available(),
                "available_modules": self._available_modules_summary(include_admin=is_admin),
                "bots": bots,
            })

        @self.blueprint.route("/bots", methods=["POST"])
        def create_or_update_bot():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            is_admin = self._is_request_admin()
            payload = request.json or {}
            
            config = self._load_user_configs(user_hash)
            bots = config.setdefault("bots", {})

            bot_id = payload.get("bot_id")
            if not bot_id:
                if "default" not in bots:
                    bot_id = "default"
                else:
                    import uuid
                    bot_id = f"bot_{uuid.uuid4().hex[:8]}"

            token = (payload.get("token") or "").strip()
            name = (payload.get("name") or "My Discord Bot").strip()
            modules = payload.get("modules") or []
            auto_start = bool(payload.get("auto_start", False))
            chat_character_id = (payload.get("chat_character_id") or "").strip()
            chat_model = (payload.get("chat_model") or "").strip()
            chat_bridge_url = (payload.get("chat_bridge_url") or "").strip()
            if not chat_bridge_url:
                 # Standard local bridge fallback
                 chat_bridge_url = "http://127.0.0.1:5000/api/plugin/chat/generate/discord_bridge"
            chat_bridge_key = (payload.get("chat_bridge_key") or "").strip()
            incoming_policy_state = payload.get("policies") or {}
            
            existing_entry = bots.get(bot_id, {})
            token = token or str(existing_entry.get("token") or "").strip()
            # Note: We allow empty tokens at config level; 
            # the bot_core will fail to start it, but that's handled at runtime.
            modules = self._sanitize_module_ids(modules, include_admin=is_admin) or self._default_module_ids(include_admin=is_admin)
            intents_list = list(existing_entry.get("intents") or self._default_intents_list())
            policy_state = self._merge_policy_state(
                existing_entry.get("policies") or {},
                incoming_policy_state,
                modules=modules,
                include_admin=is_admin,
            )
            bots[bot_id] = {
                "token": token,
                "name": name,
                "modules": modules,
                "auto_start": auto_start,
                "intents": intents_list,
                "chat_character_id": chat_character_id,
                "chat_model": chat_model,
                "chat_bridge_url": chat_bridge_url,
                "chat_bridge_key": chat_bridge_key,
                "policies": policy_state,
                "created_at": existing_entry.get("created_at") or _iso_now(),
                "updated_at": _iso_now(),
            }
            self._save_user_configs(user_hash, config)
            runtime = self._get_or_create_runtime(user_hash, bot_id, bots[bot_id])
            if runtime.state == "running":
                self._send_config_update(runtime, bots[bot_id])
            runtime.config = bots[bot_id]
            runtime.log_buffer.add("info", "Configuration updated.")

            return jsonify({"status": "ok", "bot_id": bot_id})

        @self.blueprint.route("/bots/<bot_id>/start", methods=["POST"])
        def start_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=self._is_request_admin())
            if runtime.state in {"starting", "running"}:
                abort(409, description="Bot is already running.")

            self._start_runtime(user_hash, runtime)
            return jsonify({"status": "starting"})

        @self.blueprint.route("/bots/<bot_id>/stop", methods=["POST"])
        def stop_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=self._is_request_admin())
            self._stop_runtime(runtime, timeout=10.0)
            return jsonify({"status": "stopping"})

        @self.blueprint.route("/bots/<bot_id>/restart", methods=["POST"])
        def restart_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=self._is_request_admin())
            self._stop_runtime(runtime, timeout=10.0)
            self._start_runtime(user_hash, runtime)
            return jsonify({"status": "restarting"})

        @self.blueprint.route("/bots/<bot_id>/kill", methods=["POST"])
        def kill_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=self._is_request_admin())
            self._stop_runtime(runtime, timeout=2.0, mark_killed=True)
            return jsonify({"status": "terminated"})

        @self.blueprint.route("/bots/<bot_id>/logs", methods=["GET"])
        def bot_logs(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=self._is_request_admin())
            after_seq = int(request.args.get("after", "0"))
            logs = runtime.log_buffer.get_since(after_seq)
            return jsonify({"status": "ok", "logs": logs})

        @self.blueprint.route("/bots/<bot_id>/policies", methods=["GET"])
        def get_bot_policies(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            include_admin = self._is_request_admin()
            config = self._load_user_configs(user_hash)
            bot_cfg = config.get("bots", {}).get(bot_id)
            if not bot_cfg:
                abort(404, description=f"Bot '{bot_id}' not found for current user.")
            modules = self._sanitize_module_ids(bot_cfg.get("modules") or [], include_admin=include_admin) or self._default_module_ids(include_admin=include_admin)
            policy_state = self._merge_policy_state(bot_cfg.get("policies") or {}, {}, modules=modules, include_admin=include_admin)
            return jsonify({
                "bot_id": bot_id,
                "groups": self._collect_policy_groups(modules, policy_state, include_admin=include_admin),
            })

        @self.blueprint.route("/bots/<bot_id>/policies", methods=["POST"])
        def save_bot_policies(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            include_admin = self._is_request_admin()
            payload = request.json or {}
            config = self._load_user_configs(user_hash)
            bots = config.setdefault("bots", {})
            bot_cfg = bots.get(bot_id)
            if not bot_cfg:
                abort(404, description=f"Bot '{bot_id}' not found for current user.")
            modules = self._sanitize_module_ids(bot_cfg.get("modules") or [], include_admin=include_admin) or self._default_module_ids(include_admin=include_admin)
            bot_cfg["policies"] = self._merge_policy_state(
                bot_cfg.get("policies") or {},
                payload,
                modules=modules,
                include_admin=include_admin,
            )
            if not bot_cfg.get("chat_bridge_url"):
                 bot_cfg["chat_bridge_url"] = "http://127.0.0.1:5000/api/plugin/chat/generate/discord_bridge"
            self._save_user_configs(user_hash, config)
            runtime = self._get_or_create_runtime(user_hash, bot_id, bot_cfg)
            if runtime.state == "running":
                self._send_config_update(runtime, bot_cfg)
            runtime.config = bot_cfg
            runtime.log_buffer.add("info", "Policy configuration updated.")
            return jsonify({
                "status": "ok",
                "bot_id": bot_id,
                "groups": self._collect_policy_groups(modules, bot_cfg.get("policies") or {}, include_admin=include_admin),
            })

        @self.blueprint.route("/bots/<bot_id>", methods=["DELETE"])
        def delete_bot(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            config = self._load_user_configs(user_hash)
            bots = config.get("bots", {})
            if bot_id not in bots:
                abort(404, description=f"Bot '{bot_id}' not found for current user.")

            # Stop runtime if exists
            with self._lock:
                user_runtimes = self._runtimes.get(user_hash, {})
                runtime = user_runtimes.get(bot_id)
                if runtime:
                    self._stop_runtime(runtime, timeout=5.0)
                    user_runtimes.pop(bot_id, None)

            # Remove from config
            bots.pop(bot_id)
            self._save_user_configs(user_hash, config)
            return jsonify({"status": "deleted", "bot_id": bot_id})

        @self.blueprint.route("/modules", methods=["GET"])
        def list_modules():
            self.core_api.verify_token_and_get_user_hash()
            return jsonify({"modules": self._available_modules_summary(include_admin=self._is_request_admin())})

        @self.blueprint.route("/modules/<module_id>/ui", methods=["GET"])
        def get_module_ui(module_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                abort(404, description=f"Module '{module_id}' not found.")
            if self._module_is_admin(module) and not self._is_request_admin():
                abort(403, description="Admin permission required for this module.")
            bot_id = (request.args.get("bot_id") or "").strip()
            bot_cfg = {}
            if bot_id:
                bot_cfg = self._load_user_configs(user_hash).get("bots", {}).get(bot_id, {})
            return jsonify({
                "module_id": module_id,
                "ui": self._module_dashboard_ui(module, bot_id=bot_id, bot_config=bot_cfg),
            })

    # ------------------------------------------------------------------ #
    # Runtime helpers
    # ------------------------------------------------------------------ #
    def _send_config_update(self, runtime: BotRuntime, config_data: dict) -> bool:
        if runtime.state != "running" or not runtime.runner or not runtime.runner._process:
            return False
        try:
            import json
            payload = {
                "event": "CONFIG_UPDATE",
                "config": config_data
            }
            line = json.dumps(payload, ensure_ascii=True)
            runtime.runner._process.stdin.write(line + "\n")
            runtime.runner._process.stdin.flush()
            return True
        except Exception as exc:
            print(f"[DiscordBotPlugin] Failed to send config update: {exc}")
            return False

    def _task_name(self, user_hash: str, bot_id: str) -> str:
        return f"{user_hash}:{bot_id}"

    @staticmethod
    def _default_intents_list() -> List[str]:
        return ["guilds", "members", "guild_messages", "message_content", "guild_voice_states"]

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

    def _available_modules_summary(self, *, include_admin: bool) -> List[dict]:
        return [
            {
                "id": module_id,
                "name": module.name,
                "description": module.description,
                "admin": self._module_is_admin(module),
                "type": self._module_type(module),
                "required": self._module_type(module) == "core",
                "ui": self._module_dashboard_ui(module),
            }
            for module_id, module in AVAILABLE_MODULES.items()
            if include_admin or not self._module_is_admin(module)
        ]

    def _module_is_admin(self, module) -> bool:
        return bool(getattr(module, "admin", False))

    def _module_type(self, module) -> str:
        module_type = str(getattr(module, "module_type", "normal") or "normal").strip().lower()
        if module_type == "core":
            return "core"
        if self._module_is_admin(module):
            return "admin"
        return "normal"

    def _module_dashboard_ui(self, module, *, bot_id: str = "", bot_config: dict | None = None) -> dict:
        getter = getattr(module, "get_dashboard_ui", None)
        if not callable(getter):
            return {}
        try:
            data = getter() or {}
            if not isinstance(data, dict):
                return {}
            ui = dict(data)
            if ui.get("renderer") == "policy-manager":
                ui["bot_id"] = bot_id
                ui["supports_live_edit"] = True
                if bot_config:
                    include_admin = self._module_is_admin(module) or False
                    modules = bot_config.get("modules") or []
                    ui["groups"] = self._collect_policy_groups(modules, bot_config.get("policies") or {}, include_admin=include_admin)
            elif ui.get("renderer") == "character-picker":
                ui["bot_id"] = bot_id
                if bot_config:
                    ui["chat_character_id"] = bot_config.get("chat_character_id") or ""
                    ui["chat_bridge_url"] = bot_config.get("chat_bridge_url") or ""
                    ui["chat_bridge_key"] = bot_config.get("chat_bridge_key") or ""
            return ui
        except Exception:
            return {}

    def _collect_policy_groups(self, modules: List[str], policy_state: dict, *, include_admin: bool) -> List[dict]:
        grouped: Dict[str, dict] = {}
        normalized_state = self._merge_policy_state({}, policy_state, modules=modules, include_admin=include_admin)
        toggles = normalized_state.get("toggles", {})
        settings = normalized_state.get("settings", {})
        for module_id in self._sanitize_module_ids(modules, include_admin=include_admin):
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                continue
            definitions = getattr(module, "get_policy_definitions", None)
            policy_defs = definitions() if callable(definitions) else []
            for entry in policy_defs:
                policy_id = str(entry.get("policy_id") or "").strip()
                if not policy_id:
                    continue
                group_id = str(entry.get("group_id") or "general").strip() or "general"
                group_name = str(entry.get("group_name") or group_id.title()).strip() or group_id.title()
                group = grouped.setdefault(group_id, {
                    "group_id": group_id,
                    "group_name": group_name,
                    "policies": [],
                })
                group["policies"].append({
                    "policy_id": policy_id,
                    "module_id": module_id,
                    "module_name": getattr(module, "name", module_id),
                    "title": str(entry.get("title") or policy_id),
                    "description": str(entry.get("description") or ""),
                    "default_enabled": bool(entry.get("default_enabled", False)),
                    "enabled": bool(toggles.get(policy_id, entry.get("default_enabled", False))),
                    "settings": settings.get(policy_id, entry.get("settings") or {}),
                    "setting_schema": entry.get("settings") or {},
                })
        return sorted(
            [
                {
                    **group,
                    "policies": sorted(group["policies"], key=lambda item: (str(item.get("module_name") or ""), str(item.get("title") or ""))),
                }
                for group in grouped.values()
            ],
            key=lambda item: str(item.get("group_name") or item.get("group_id") or ""),
        )

    def _merge_policy_state(self, base_state: dict, incoming_state: dict, *, modules: List[str], include_admin: bool) -> dict:
        merged_toggles = dict((base_state or {}).get("toggles") or {})
        merged_settings = dict((base_state or {}).get("settings") or {})
        incoming_toggles = dict((incoming_state or {}).get("toggles") or {})
        incoming_settings = dict((incoming_state or {}).get("settings") or {})
        policy_ids: set[str] = set()
        definition_defaults: Dict[str, dict] = {}
        for module_id in self._sanitize_module_ids(modules, include_admin=include_admin):
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                continue
            getter = getattr(module, "get_policy_definitions", None)
            definitions = getter() if callable(getter) else []
            for definition in definitions:
                policy_id = str(definition.get("policy_id") or "").strip()
                if not policy_id:
                    continue
                policy_ids.add(policy_id)
                definition_defaults[policy_id] = definition
        for policy_id, enabled in incoming_toggles.items():
            if policy_id in policy_ids:
                merged_toggles[policy_id] = bool(enabled)
        for policy_id in policy_ids:
            if policy_id not in merged_toggles:
                merged_toggles[policy_id] = bool(definition_defaults.get(policy_id, {}).get("default_enabled", False))
        cleaned_settings: Dict[str, dict] = {}
        for policy_id in policy_ids:
            defaults = definition_defaults.get(policy_id, {}).get("settings") or {}
            current_settings = dict(merged_settings.get(policy_id) or {})
            incoming_policy_settings = incoming_settings.get(policy_id)
            if isinstance(incoming_policy_settings, dict):
                current_settings.update(incoming_policy_settings)
            if defaults:
                normalized = {key: current_settings.get(key, value) for key, value in defaults.items()}
                cleaned_settings[policy_id] = normalized
            elif current_settings:
                cleaned_settings[policy_id] = current_settings
        return {
            "toggles": {policy_id: bool(merged_toggles.get(policy_id, False)) for policy_id in sorted(policy_ids)},
            "settings": cleaned_settings,
        }

    def _sanitize_module_ids(self, modules: List[str], *, include_admin: bool) -> List[str]:
        sanitized: List[str] = []
        for module_id in modules:
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                continue
            if self._module_is_admin(module) and not include_admin:
                continue
            if module_id not in sanitized:
                sanitized.append(module_id)
        for module_id, module in AVAILABLE_MODULES.items():
            if self._module_type(module) != "core":
                continue
            if self._module_is_admin(module) and not include_admin:
                continue
            if module_id not in sanitized:
                sanitized.append(module_id)
        return sanitized

    def _default_module_ids(self, *, include_admin: bool) -> List[str]:
        defaults = self._sanitize_module_ids([
            module_id
            for module_id, module in AVAILABLE_MODULES.items()
            if self._module_type(module) in {"core", "normal"}
        ], include_admin=include_admin)
        if defaults:
            return defaults
        return [
            module_id
            for module_id, module in AVAILABLE_MODULES.items()
            if (include_admin or not self._module_is_admin(module)) and self._module_type(module) != "admin"
        ]

    def _get_request_token(self) -> str:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return ""
        return auth_header.replace("Bearer ", "").strip()

    def _is_request_admin(self) -> bool:
        token = self._get_request_token()
        return bool(token and token in self.core_api._whitelist_users)

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
            if "policies" not in bot_cfg or not isinstance(bot_cfg.get("policies"), dict):
                bot_cfg["policies"] = {"toggles": {}, "settings": {}}
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

    def _ensure_runtime(self, user_hash: str, bot_id: str, *, include_admin: bool) -> BotRuntime:
        config = self._load_user_configs(user_hash)
        bot_config = config.get("bots", {}).get(bot_id)
        if not bot_config:
            abort(404, description=f"Bot '{bot_id}' not found for current user.")
        runtime_config = dict(bot_config)
        runtime_config["modules"] = self._sanitize_module_ids(runtime_config.get("modules") or [], include_admin=include_admin) or self._default_module_ids(include_admin=include_admin)
        return self._get_or_create_runtime(user_hash, bot_id, runtime_config)

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
        with self._lock:
            runtime = self._runtimes.get(user_hash, {}).get(bot_id)
        if runtime is None:
            runtime = self._ensure_runtime(user_hash, bot_id, include_admin=False)
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

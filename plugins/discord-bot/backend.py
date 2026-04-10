from __future__ import annotations

import json
import os
import hashlib
import mimetypes
import secrets
import sys
import threading
import base64
import binascii
import urllib.parse
import urllib.request
from typing import Dict, List, Tuple

from flask import Blueprint, Response, abort, jsonify, request

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
from integrations.workflow_builder_service import (
    DEFAULT_CONFIG as IMAGE_GEN_DEFAULT_CONFIG,
    build_full_prompt_from_cfg,
    normalize_tag_list,
)


class DiscordBotPlugin:
    CONFIG_FILENAME = "discord_bot.json"
    RUNTIME_API_BASE_URL = "http://127.0.0.1:5000/api/plugin/discord-bot/runtime"
    IMAGE_GEN_SIZE_OPTIONS = [
        {"name": "832x1216 Portrait", "value": "832x1216"},
        {"name": "1216x832 Landscape", "value": "1216x832"},
        {"name": "1024x1024 Square", "value": "1024x1024"},
        {"name": "1344x768 Wide", "value": "1344x768"},
    ]

    def __init__(self, core_api):
        self.core_api = core_api
        self.plugin_id = getattr(self, "plugin_id", "discord-bot")
        self.blueprint = Blueprint("discord_bot", __name__)
        self._runtimes: Dict[str, Dict[str, BotRuntime]] = {}
        self._lock = threading.RLock()
        self._tts_avatar_cache: Dict[str, str] = {}

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

            existing_entry = bots.get(bot_id, {})

            def _payload_string(key: str, default: str = "") -> str:
                if key in payload:
                    return str(payload.get(key) or "").strip()
                return str(existing_entry.get(key) or default).strip()

            def _payload_bool(key: str, default: bool = False) -> bool:
                if key in payload:
                    return bool(payload.get(key, default))
                return bool(existing_entry.get(key, default))

            def _payload_int(key: str, default: int = 0, minimum: int | None = None, maximum: int | None = None) -> int:
                if key in payload:
                    raw_value = payload.get(key, default)
                else:
                    raw_value = existing_entry.get(key, default)
                try:
                    value = int(raw_value)
                except (TypeError, ValueError):
                    value = int(default)
                if minimum is not None:
                    value = max(minimum, value)
                if maximum is not None:
                    value = min(maximum, value)
                return value

            def _payload_float(key: str, default: float = 0.0, minimum: float | None = None, maximum: float | None = None) -> float:
                if key in payload:
                    raw_value = payload.get(key, default)
                else:
                    raw_value = existing_entry.get(key, default)
                try:
                    value = float(raw_value)
                except (TypeError, ValueError):
                    value = float(default)
                if minimum is not None:
                    value = max(minimum, value)
                if maximum is not None:
                    value = min(maximum, value)
                return value

            token = (payload.get("token") or "").strip()
            name = (payload.get("name") or "My Discord Bot").strip()
            modules = payload.get("modules") or []
            auto_start = bool(payload.get("auto_start", False))
            chat_character_id = _payload_string("chat_character_id")
            chat_character_name = _payload_string("chat_character_name")
            chat_model = _payload_string("chat_model")
            chat_bridge_url = _payload_string("chat_bridge_url")
            if not chat_bridge_url:
                 # Standard local bridge fallback
                 chat_bridge_url = "http://127.0.0.1:5000/api/plugin/chat/generate/discord_bridge"
            chat_bridge_key = _payload_string("chat_bridge_key")
            chat_primary_language = _payload_string("chat_primary_language", "English")
            chat_secondary_language = _payload_string("chat_secondary_language", "Japanese")
            chat_secondary_to_channel = _payload_bool("chat_secondary_to_channel", False)
            tts_engine = _payload_string("tts_engine", "aivisspeech") or "aivisspeech"
            tts_engine_base_url = _payload_string("tts_engine_base_url", "http://127.0.0.1:10101") or "http://127.0.0.1:10101"
            tts_speaker_id = _payload_string("tts_speaker_id")
            tts_speaker_name = _payload_string("tts_speaker_name")
            tts_speaker_avatar_url = _payload_string("tts_speaker_avatar_url")
            if tts_speaker_avatar_url.startswith("data:"):
                # Do not persist embedded avatars in bot config; they can exceed Windows command-line limits.
                tts_speaker_avatar_url = ""
            tts_text_source = (_payload_string("tts_text_source", "secondary") or "secondary").lower()
            tavily_api_key = _payload_string("tavily_api_key")
            tavily_max_results = _payload_int("tavily_max_results", 5, minimum=1, maximum=10)
            image_gen_character_hash = _payload_string("image_gen_character_hash")
            image_gen_character_name = _payload_string("image_gen_character_name")
            image_gen_server_address = _payload_string("image_gen_server_address", IMAGE_GEN_DEFAULT_CONFIG.get("server_address", "127.0.0.1:8888")) or IMAGE_GEN_DEFAULT_CONFIG.get("server_address", "127.0.0.1:8888")
            image_gen_ckpt_name = _payload_string("image_gen_ckpt_name", IMAGE_GEN_DEFAULT_CONFIG.get("ckpt_name", "")) or IMAGE_GEN_DEFAULT_CONFIG.get("ckpt_name", "")
            image_gen_lora_name = _payload_string("image_gen_lora_name", IMAGE_GEN_DEFAULT_CONFIG.get("lora_name", "None")) or "None"
            image_gen_sampler_name = _payload_string("image_gen_sampler_name", IMAGE_GEN_DEFAULT_CONFIG.get("sampler_name", "dpmpp_sde")) or IMAGE_GEN_DEFAULT_CONFIG.get("sampler_name", "dpmpp_sde")
            image_gen_scheduler = _payload_string("image_gen_scheduler", IMAGE_GEN_DEFAULT_CONFIG.get("scheduler", "beta")) or IMAGE_GEN_DEFAULT_CONFIG.get("scheduler", "beta")
            image_gen_quality = _payload_string("image_gen_quality", IMAGE_GEN_DEFAULT_CONFIG.get("quality", ""))
            image_gen_negative = _payload_string("image_gen_negative", IMAGE_GEN_DEFAULT_CONFIG.get("negative", ""))
            image_gen_outfits = _payload_string("image_gen_outfits")
            image_gen_expression = _payload_string("image_gen_expression")
            image_gen_action = _payload_string("image_gen_action")
            image_gen_context = _payload_string("image_gen_context")
            image_gen_width = _payload_int("image_gen_width", IMAGE_GEN_DEFAULT_CONFIG.get("width", 832), minimum=64, maximum=4096)
            image_gen_height = _payload_int("image_gen_height", IMAGE_GEN_DEFAULT_CONFIG.get("height", 1216), minimum=64, maximum=4096)
            image_gen_steps = _payload_int("image_gen_steps", IMAGE_GEN_DEFAULT_CONFIG.get("steps", 12), minimum=1, maximum=60)
            image_gen_cfg = _payload_float("image_gen_cfg", IMAGE_GEN_DEFAULT_CONFIG.get("cfg", 2.2), minimum=0.0, maximum=30.0)
            incoming_policy_state = payload.get("policies") or {}
            incoming_brain_tool_state = payload.get("brain_tools") or {}
            runtime_secret = str(existing_entry.get("runtime_secret") or "").strip() or secrets.token_urlsafe(24)

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
            brain_tool_state = self._merge_brain_tool_state(
                existing_entry.get("brain_tools") or {},
                incoming_brain_tool_state,
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
                "chat_character_name": chat_character_name,
                "chat_model": chat_model,
                "chat_bridge_url": chat_bridge_url,
                "chat_bridge_key": chat_bridge_key,
                "chat_primary_language": chat_primary_language,
                "chat_secondary_language": chat_secondary_language,
                "chat_secondary_to_channel": chat_secondary_to_channel,
                "tts_engine": tts_engine,
                "tts_engine_base_url": tts_engine_base_url,
                "tts_speaker_id": tts_speaker_id,
                "tts_speaker_name": tts_speaker_name,
                "tts_speaker_avatar_url": tts_speaker_avatar_url,
                "tts_text_source": tts_text_source,
                "tavily_api_key": tavily_api_key,
                "tavily_max_results": tavily_max_results,
                "image_gen_character_hash": image_gen_character_hash,
                "image_gen_character_name": image_gen_character_name,
                "image_gen_server_address": image_gen_server_address,
                "image_gen_ckpt_name": image_gen_ckpt_name,
                "image_gen_lora_name": image_gen_lora_name,
                "image_gen_sampler_name": image_gen_sampler_name,
                "image_gen_scheduler": image_gen_scheduler,
                "image_gen_quality": image_gen_quality,
                "image_gen_negative": image_gen_negative,
                "image_gen_outfits": image_gen_outfits,
                "image_gen_expression": image_gen_expression,
                "image_gen_action": image_gen_action,
                "image_gen_context": image_gen_context,
                "image_gen_width": image_gen_width,
                "image_gen_height": image_gen_height,
                "image_gen_steps": image_gen_steps,
                "image_gen_cfg": image_gen_cfg,
                "runtime_secret": runtime_secret,
                "policies": policy_state,
                "brain_tools": brain_tool_state,
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

        @self.blueprint.route("/bots/<bot_id>/image-gen/options", methods=["GET"])
        def get_image_gen_options(bot_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            bot_cfg = self._load_user_configs(user_hash).get("bots", {}).get(bot_id)
            if not bot_cfg:
                abort(404, description=f"Bot '{bot_id}' not found for current user.")
            image_cfg = self._build_image_gen_defaults(bot_cfg)
            server_address = str(request.args.get("server_address") or image_cfg.get("server_address") or "").strip() or image_cfg.get("server_address")
            comfy_choices = self.core_api.comfy_api_client.get_full_object_info(server_address)
            characters = self.core_api.get_all_characters_list() or []
            return jsonify({
                "bot_id": bot_id,
                "config": image_cfg,
                "characters": characters,
                "choices": {
                    "checkpoints": comfy_choices.get("checkpoints", []),
                    "samplers": comfy_choices.get("samplers", []),
                    "schedulers": comfy_choices.get("schedulers", []),
                    "loras": comfy_choices.get("loras", []),
                    "sizes": list(self.IMAGE_GEN_SIZE_OPTIONS),
                },
            })

        @self.blueprint.route("/runtime/<user_hash>/<bot_id>/image-gen/generate", methods=["POST"])
        def runtime_image_gen_generate(user_hash, bot_id):
            _, bot_cfg = self._verify_runtime_request(user_hash, bot_id)
            payload = request.json or {}
            options = payload.get("options") or {}
            if not isinstance(options, dict):
                abort(400, description="Invalid image generation options payload.")
            try:
                generation_config, character_hash, character_name = self._prepare_image_gen_request(bot_cfg, options)
            except ValueError as exc:
                abort(400, description=str(exc))
            task_context = {
                "source": "discord-bot.image-gen",
                "module_id": "core.image-gen",
                "bot_id": bot_id,
                "guild_id": str(payload.get("guild_id") or "").strip(),
                "channel_id": str(payload.get("channel_id") or "").strip(),
                "actor_id": str(payload.get("actor_id") or "").strip(),
                "actor_name": str(payload.get("actor_name") or "").strip(),
                "command": "img",
            }
            task_id, message = self.core_api.generation_service.start_generation_task(
                user_hash,
                character_hash,
                generation_config,
                task_context,
            )
            if not task_id:
                return jsonify({"error": message}), 429
            return jsonify({
                "status": "started",
                "task_id": task_id,
                "message": message,
                "character_hash": character_hash,
                "character_name": character_name,
                "request": {
                    "seed": generation_config.get("seed", 0),
                    "user_facing_config": generation_config,
                },
            })

        @self.blueprint.route("/runtime/<user_hash>/<bot_id>/image-gen/status/<task_id>", methods=["GET"])
        def runtime_image_gen_status(user_hash, bot_id, task_id):
            _, bot_cfg = self._verify_runtime_request(user_hash, bot_id)
            snapshot = self.core_api.generation_service.peek_user_status(user_hash)
            task = snapshot.get("tasks", {}).get(task_id)
            if task and not self._is_image_gen_task_for_bot(task, bot_id):
                task = None
            events = [
                event for event in snapshot.get("events", [])
                if str((event.get("data") or {}).get("task_id") or "") == str(task_id)
            ]
            terminal_event = events[-1] if events else None
            state = self._build_image_gen_status_payload(
                user_hash,
                bot_id,
                task_id,
                task=task,
                terminal_event=terminal_event,
                bot_config=bot_cfg,
            )
            consume = str(request.args.get("consume") or "").strip().lower() in {"1", "true", "yes"}
            if consume and state.get("status") in {"completed", "error", "cancelled"}:
                self.core_api.generation_service.dismiss_task(user_hash, task_id)
            return jsonify(state)

        @self.blueprint.route("/runtime/<user_hash>/<bot_id>/image-gen/autocomplete", methods=["GET"])
        def runtime_image_gen_autocomplete(user_hash, bot_id):
            _, bot_cfg = self._verify_runtime_request(user_hash, bot_id)
            field = str(request.args.get("field") or "").strip().lower()
            value = str(request.args.get("value") or "")
            server_address = str(request.args.get("server_address") or "").strip()
            try:
                limit = max(1, min(25, int(request.args.get("limit") or 25)))
            except (TypeError, ValueError):
                limit = 25
            return jsonify({
                "field": field,
                "choices": self._build_image_gen_autocomplete_choices(
                    bot_cfg,
                    field,
                    value,
                    limit=limit,
                    server_address=server_address,
                ),
            })

        @self.blueprint.route("/runtime/<user_hash>/<bot_id>/image-gen/cancel", methods=["POST"])
        def runtime_image_gen_cancel(user_hash, bot_id):
            self._verify_runtime_request(user_hash, bot_id)
            payload = request.json or {}
            task_id = str(payload.get("task_id") or "").strip()
            if not task_id:
                abort(400, description="task_id is required.")
            snapshot = self.core_api.generation_service.peek_user_status(user_hash)
            task = snapshot.get("tasks", {}).get(task_id)
            if not task or not self._is_image_gen_task_for_bot(task, bot_id):
                abort(404, description="Image generation task not found for this bot.")
            success = self.core_api.generation_service.request_cancellation(user_hash, task_id)
            if not success:
                return jsonify({"error": "Unable to cancel task."}), 409
            return jsonify({"status": "cancelling", "task_id": task_id})

        @self.blueprint.route("/runtime/<user_hash>/<bot_id>/image-gen/media/<image_id>", methods=["GET"])
        def runtime_image_gen_media(user_hash, bot_id, image_id):
            self._verify_runtime_request(user_hash, bot_id)
            image_entry = self._find_user_image_entry(user_hash, image_id)
            if not image_entry:
                abort(404, description="Generated media not found.")
            media_url = str(image_entry.get("url") or "").strip()
            filename = os.path.basename(media_url)
            if not filename:
                abort(404, description="Generated media file is missing.")
            binary, mimetype = self.core_api.get_user_image_data("imgs", filename)
            if not binary:
                abort(404, description="Generated media bytes could not be loaded.")
            guessed_type = mimetype or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            response = Response(binary, mimetype=guessed_type)
            response.headers["Content-Disposition"] = f'inline; filename="{filename}"'
            return response

        @self.blueprint.route("/tts/speakers", methods=["GET"])
        def get_tts_speakers():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            engine = str(request.args.get("engine") or "aivisspeech").strip().lower() or "aivisspeech"
            base_url = str(request.args.get("base_url") or "http://127.0.0.1:10101").strip() or "http://127.0.0.1:10101"
            bot_id = str(request.args.get("bot_id") or "").strip()
            if bot_id:
                bot_cfg = self._load_user_configs(user_hash).get("bots", {}).get(bot_id, {})
                if not request.args.get("base_url"):
                    base_url = str(bot_cfg.get("tts_engine_base_url") or base_url).strip() or base_url
                if not request.args.get("engine"):
                    engine = str(bot_cfg.get("tts_engine") or engine).strip().lower() or engine
            if engine != "aivisspeech":
                abort(400, description=f"Unsupported TTS engine '{engine}'.")
            try:
                payload = self._fetch_aivisspeech_speakers(base_url)
                return jsonify({
                    "engine": engine,
                    "base_url": base_url,
                    "speakers": payload.get("speakers", []),
                    "avatars": payload.get("avatars", {}),
                })
            except Exception as exc:  # noqa: BLE001
                abort(502, description=f"Failed to fetch speakers from TTS engine: {exc}")

        @self.blueprint.route("/tts/sample", methods=["GET"])
        def get_tts_sample():
            self.core_api.verify_token_and_get_user_hash()
            speaker_id = str(request.args.get("speaker_id") or "").strip()
            engine = str(request.args.get("engine") or "aivisspeech").strip().lower()
            base_url = str(request.args.get("base_url") or "http://127.0.0.1:10101").strip()
            if not speaker_id:
                abort(400, description="speaker_id is required.")
            
            jp_samples = [
                "こんにちは！私の声はどうですか？",
                "今日はとてもいい天気ですね。",
                "よろしくお願いします！",
                "あなたの冒険のお手伝いをします。",
                "準備はいいですか？さあ、行きましょう！",
            ]
            en_samples = [
                "Hello! How does my voice sound?",
                "It's a beautiful day today.",
                "I am ready to help you.",
                "Let's have a great time together!",
                "Welcome back! I missed you.",
            ]
            
            import random
            text = random.choice(jp_samples + en_samples)
            
            try:
                if engine == "aivisspeech":
                    audio_data = self._synthesize_aivisspeech_sample(base_url, speaker_id, text)
                    if not audio_data:
                        abort(502, description="Received empty audio data from engine")
                    return Response(audio_data, mimetype="audio/wav")
                else:
                    abort(400, description=f"Unsupported engine for samples: {engine}")
            except Exception as exc:
                abort(502, description=f"TTS synthesis failed: {exc}")

    def _synthesize_aivisspeech_sample(self, base_url: str, speaker_id: str, text: str) -> bytes:
        normalized_base = str(base_url or "").strip().rstrip("/")
        # 1. Create Audio Query
        query_url = f"{normalized_base}/audio_query?text={urllib.parse.quote(text)}&speaker={speaker_id}"
        req_query = urllib.request.Request(query_url, method="POST")
        with urllib.request.urlopen(req_query, timeout=10) as resp:
            query_json = json.loads(resp.read().decode("utf-8"))
        
        # 2. Synthesis
        synth_url = f"{normalized_base}/synthesis?speaker={speaker_id}"
        req_synth = urllib.request.Request(
            synth_url, 
            data=json.dumps(query_json).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req_synth, timeout=20) as resp:
            return resp.read()

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

    def _persist_runtime_config_patch(self, user_hash: str, bot_id: str, patch: dict) -> None:
        if not isinstance(patch, dict) or not patch:
            return
        try:
            configs = self._load_user_configs(user_hash)
            bots_cfg = configs.get("bots", {})
            bot_entry = bots_cfg.get(bot_id)
            if bot_entry is None:
                return
            bot_entry.update(patch)
            bot_entry["updated_at"] = _iso_now()
            self._save_user_configs(user_hash, configs)
        except Exception as exc:  # noqa: BLE001
            print(f"[DiscordBotPlugin] Failed to persist runtime config patch for {bot_id}: {exc}")

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
                    ui["chat_character_name"] = bot_config.get("chat_character_name") or ""
                    ui["chat_bridge_url"] = bot_config.get("chat_bridge_url") or ""
                    ui["chat_bridge_key"] = bot_config.get("chat_bridge_key") or ""
                    ui["chat_primary_language"] = bot_config.get("chat_primary_language") or "English"
                    ui["chat_secondary_language"] = bot_config.get("chat_secondary_language") or "Japanese"
                    ui["chat_secondary_to_channel"] = bool(bot_config.get("chat_secondary_to_channel", False))
            elif ui.get("renderer") == "brain-abilities":
                ui["bot_id"] = bot_id
                ui["supports_live_edit"] = True
                include_admin = self._module_is_admin(module) or False
                modules = (bot_config or {}).get("modules") or []
                brain_state = self._merge_brain_tool_state(
                    (bot_config or {}).get("brain_tools") or {},
                    {},
                    modules=modules,
                    include_admin=include_admin,
                )
                ui["ability_groups"] = self._collect_brain_tool_groups(modules, brain_state, include_admin=include_admin)
            elif ui.get("renderer") == "tts-engine-picker":
                ui["bot_id"] = bot_id
                if bot_config:
                    ui["tts_engine"] = bot_config.get("tts_engine") or "aivisspeech"
                    ui["tts_engine_base_url"] = bot_config.get("tts_engine_base_url") or "http://127.0.0.1:10101"
                    ui["tts_speaker_id"] = str(bot_config.get("tts_speaker_id") or "")
                    ui["tts_speaker_name"] = bot_config.get("tts_speaker_name") or ""
                    ui["tts_speaker_avatar_url"] = bot_config.get("tts_speaker_avatar_url") or ""
                    ui["tts_text_source"] = bot_config.get("tts_text_source") or "secondary"
                    ui["chat_primary_language"] = bot_config.get("chat_primary_language") or "English"
                    ui["chat_secondary_language"] = bot_config.get("chat_secondary_language") or "Japanese"
            elif ui.get("renderer") == "image-gen-config":
                ui["bot_id"] = bot_id
                defaults = self._build_image_gen_defaults(bot_config or {})
                ui.update({
                    "image_gen_character_hash": defaults["character_hash"],
                    "image_gen_character_name": defaults["character_name"],
                    "image_gen_server_address": defaults["server_address"],
                    "image_gen_ckpt_name": defaults["ckpt_name"],
                    "image_gen_lora_name": defaults["lora_name"],
                    "image_gen_sampler_name": defaults["sampler_name"],
                    "image_gen_scheduler": defaults["scheduler"],
                    "image_gen_quality": defaults["quality"],
                    "image_gen_negative": defaults["negative"],
                    "image_gen_outfits": defaults["outfits"],
                    "image_gen_expression": defaults["expression"],
                    "image_gen_action": defaults["action"],
                    "image_gen_context": defaults["context"],
                    "image_gen_width": defaults["width"],
                    "image_gen_height": defaults["height"],
                    "image_gen_steps": defaults["steps"],
                    "image_gen_cfg": defaults["cfg"],
                })
            elif ui.get("renderer") == "rag-search-config":
                ui["bot_id"] = bot_id
                if bot_config:
                    ui["tavily_api_key"] = bot_config.get("tavily_api_key") or ""
                    try:
                        ui["tavily_max_results"] = int(bot_config.get("tavily_max_results") or 5)
                    except (TypeError, ValueError):
                        ui["tavily_max_results"] = 5
            return ui
        except Exception:
            return {}

    def _verify_runtime_request(self, user_hash: str, bot_id: str) -> Tuple[str, dict]:
        secret = str(request.headers.get("X-Discord-Bot-Secret") or "").strip()
        if not secret:
            abort(401, description="Missing runtime secret.")
        bot_cfg = self._load_user_configs(user_hash).get("bots", {}).get(bot_id)
        if not bot_cfg:
            abort(404, description=f"Bot '{bot_id}' not found for runtime request.")
        expected_secret = str(bot_cfg.get("runtime_secret") or "").strip()
        if not expected_secret or not secrets.compare_digest(secret, expected_secret):
            abort(403, description="Invalid runtime secret.")
        return user_hash, bot_cfg

    def _build_image_gen_defaults(self, bot_config: dict | None = None) -> dict:
        bot_cfg = bot_config or {}
        return {
            "character_hash": str(bot_cfg.get("image_gen_character_hash") or bot_cfg.get("chat_character_id") or "").strip(),
            "character_name": str(bot_cfg.get("image_gen_character_name") or bot_cfg.get("chat_character_name") or "").strip(),
            "server_address": str(bot_cfg.get("image_gen_server_address") or IMAGE_GEN_DEFAULT_CONFIG.get("server_address") or "127.0.0.1:8888").strip() or "127.0.0.1:8888",
            "ckpt_name": str(bot_cfg.get("image_gen_ckpt_name") or IMAGE_GEN_DEFAULT_CONFIG.get("ckpt_name") or "").strip(),
            "lora_name": str(bot_cfg.get("image_gen_lora_name") or IMAGE_GEN_DEFAULT_CONFIG.get("lora_name") or "None").strip() or "None",
            "sampler_name": str(bot_cfg.get("image_gen_sampler_name") or IMAGE_GEN_DEFAULT_CONFIG.get("sampler_name") or "dpmpp_sde").strip() or "dpmpp_sde",
            "scheduler": str(bot_cfg.get("image_gen_scheduler") or IMAGE_GEN_DEFAULT_CONFIG.get("scheduler") or "beta").strip() or "beta",
            "quality": str(bot_cfg.get("image_gen_quality") or IMAGE_GEN_DEFAULT_CONFIG.get("quality") or "").strip(),
            "negative": str(bot_cfg.get("image_gen_negative") or IMAGE_GEN_DEFAULT_CONFIG.get("negative") or "").strip(),
            "outfits": str(bot_cfg.get("image_gen_outfits") or "").strip(),
            "expression": str(bot_cfg.get("image_gen_expression") or "").strip(),
            "action": str(bot_cfg.get("image_gen_action") or "").strip(),
            "context": str(bot_cfg.get("image_gen_context") or "").strip(),
            "width": self._safe_image_gen_int(
                bot_cfg.get("image_gen_width"),
                IMAGE_GEN_DEFAULT_CONFIG.get("width") or 832,
                minimum=64,
                maximum=4096,
            ),
            "height": self._safe_image_gen_int(
                bot_cfg.get("image_gen_height"),
                IMAGE_GEN_DEFAULT_CONFIG.get("height") or 1216,
                minimum=64,
                maximum=4096,
            ),
            "steps": self._safe_image_gen_int(
                bot_cfg.get("image_gen_steps"),
                IMAGE_GEN_DEFAULT_CONFIG.get("steps") or 12,
                minimum=1,
                maximum=60,
            ),
            "cfg": self._safe_image_gen_float(
                bot_cfg.get("image_gen_cfg"),
                IMAGE_GEN_DEFAULT_CONFIG.get("cfg") or 2.2,
                minimum=0.0,
                maximum=30.0,
            ),
        }

    @staticmethod
    def _normalize_image_gen_tags(value: object) -> str:
        return ", ".join(normalize_tag_list(str(value or "")))

    @staticmethod
    def _safe_image_gen_int(value: object, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
        try:
            result = int(value)
        except (TypeError, ValueError):
            result = int(default)
        if minimum is not None:
            result = max(minimum, result)
        if maximum is not None:
            result = min(maximum, result)
        return result

    @staticmethod
    def _safe_image_gen_float(value: object, default: float, *, minimum: float | None = None, maximum: float | None = None) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError):
            result = float(default)
        if minimum is not None:
            result = max(minimum, result)
        if maximum is not None:
            result = min(maximum, result)
        return result

    @staticmethod
    def _normalize_image_gen_search_term(value: object) -> str:
        return " ".join(str(value or "").replace("_", " ").lower().split())

    @classmethod
    def _build_image_gen_tag_autocomplete_choices(cls, values: list[object], raw_value: object, *, limit: int = 25) -> list[dict]:
        raw = str(raw_value or "")
        last_comma_index = raw.rfind(",")
        prefix_for_value = raw[:last_comma_index + 1].strip() if last_comma_index != -1 else ""
        current_term = raw[last_comma_index + 1:].strip() if last_comma_index != -1 else raw.strip()
        if prefix_for_value and not prefix_for_value.endswith(" "):
            prefix_for_value += " "

        completed_values = raw[:last_comma_index + 1] if last_comma_index != -1 else ""
        completed_terms = {
            cls._normalize_image_gen_search_term(part)
            for part in str(completed_values or "").split(",")
            if cls._normalize_image_gen_search_term(part)
        }
        normalized_current_term = cls._normalize_image_gen_search_term(current_term)
        seen_terms: set[str] = set()
        choices: list[dict] = []

        for item in values or []:
            display = " ".join(str(item or "").replace("_", " ").split()).strip()
            normalized_display = cls._normalize_image_gen_search_term(display)
            if not normalized_display or normalized_display in seen_terms or normalized_display in completed_terms:
                continue
            if normalized_current_term and normalized_current_term not in normalized_display:
                continue
            seen_terms.add(normalized_display)
            choice_value = f"{prefix_for_value}{display}" if prefix_for_value else display
            choice_value = choice_value[:100]
            choices.append({
                "name": choice_value,
                "value": choice_value,
            })
            if len(choices) >= limit:
                break
        return choices

    @classmethod
    def _build_image_gen_simple_autocomplete_choices(cls, values: list[object], raw_value: object, *, limit: int = 25) -> list[dict]:
        search_text = str(raw_value or "").strip()
        normalized_search = cls._normalize_image_gen_search_term(search_text)
        choices: list[dict] = []
        seen_terms: set[str] = set()

        for item in values or []:
            display = str(item or "").strip()
            normalized_display = cls._normalize_image_gen_search_term(display)
            if not normalized_display or normalized_display in seen_terms:
                continue
            if normalized_search and normalized_search not in normalized_display and search_text.lower() not in display.lower():
                continue
            seen_terms.add(normalized_display)
            choice_value = display[:100]
            choices.append({
                "name": choice_value,
                "value": choice_value,
            })
            if len(choices) >= limit:
                break
        return choices

    @staticmethod
    def _parse_image_gen_size(value: object) -> tuple[int, int] | None:
        raw = str(value or "").strip().lower()
        if not raw or "x" not in raw:
            return None
        try:
            width_str, height_str = raw.split("x", 1)
            width = max(64, min(4096, int(width_str)))
            height = max(64, min(4096, int(height_str)))
            return width, height
        except (TypeError, ValueError):
            return None

    def _resolve_image_gen_character(self, bot_config: dict, explicit_character: object = None) -> tuple[str, str]:
        raw_value = str(explicit_character or "").strip()
        if raw_value:
            target_key = self._character_lookup_key(raw_value)
            for item in self.core_api.get_all_characters_list() or []:
                name = str(item.get("name") or "").strip()
                if name and self._character_lookup_key(name) == target_key:
                    return str(item.get("hash") or "").strip(), name
            return f"custom-{hashlib.md5(raw_value.lower().encode('utf-8')).hexdigest()}", raw_value

        defaults = self._build_image_gen_defaults(bot_config)
        if defaults["character_hash"] and defaults["character_name"]:
            return defaults["character_hash"], defaults["character_name"]
        if defaults["character_hash"]:
            char_info = self.core_api.get_character_by_hash(defaults["character_hash"]) or {}
            return defaults["character_hash"], str(char_info.get("name") or defaults["character_name"] or defaults["character_hash"]).strip()
        return "", ""

    @staticmethod
    def _character_lookup_key(value: str) -> str:
        return str(value or "").strip().lower().replace(":", "").replace("  ", " ")

    def _prepare_image_gen_request(self, bot_config: dict, options: dict) -> tuple[dict, str, str]:
        defaults = self._build_image_gen_defaults(bot_config)
        character_hash, character_name = self._resolve_image_gen_character(bot_config, options.get("character"))
        prompt_override = self._normalize_image_gen_tags(options.get("prompt"))
        if not character_hash:
            if prompt_override:
                character_hash = f"custom-{hashlib.md5(prompt_override.lower().encode('utf-8')).hexdigest()}"
                character_name = prompt_override
            else:
                raise ValueError("Image generation requires a configured default character or an explicit character/prompt.")

        generation_config = dict(IMAGE_GEN_DEFAULT_CONFIG)
        generation_config.update({
            "server_address": defaults["server_address"],
            "ckpt_name": defaults["ckpt_name"],
            "lora_name": defaults["lora_name"],
            "sampler_name": defaults["sampler_name"],
            "scheduler": defaults["scheduler"],
            "quality": defaults["quality"],
            "negative": defaults["negative"],
            "outfits": defaults["outfits"],
            "expression": defaults["expression"],
            "action": defaults["action"],
            "context": defaults["context"],
            "width": defaults["width"],
            "height": defaults["height"],
            "steps": defaults["steps"],
            "cfg": defaults["cfg"],
            "batch_size": 1,
            "character": self._normalize_image_gen_tags(character_name),
        })

        if prompt_override:
            generation_config["character_prompt"] = prompt_override

        for key in ["outfits", "expression", "action", "context", "quality", "negative"]:
            if options.get(key) is not None:
                generation_config[key] = self._normalize_image_gen_tags(options.get(key))
        for key in ["server_address", "ckpt_name", "lora_name", "sampler_name", "scheduler"]:
            if options.get(key) is not None:
                generation_config[key] = str(options.get(key) or "").strip()

        size_value = self._parse_image_gen_size(options.get("size"))
        if size_value:
            generation_config["width"], generation_config["height"] = size_value

        try:
            generation_config["steps"] = max(1, min(60, int(options.get("steps") if options.get("steps") is not None else generation_config["steps"])))
        except (TypeError, ValueError):
            generation_config["steps"] = defaults["steps"]
        try:
            generation_config["cfg"] = max(0.0, min(30.0, float(options.get("cfg") if options.get("cfg") is not None else generation_config["cfg"])))
        except (TypeError, ValueError):
            generation_config["cfg"] = defaults["cfg"]
        try:
            seed_value = int(options.get("seed") if options.get("seed") is not None else 0)
        except (TypeError, ValueError):
            seed_value = 0
        generation_config["seed"] = seed_value
        generation_config["combined_text_prompt"] = build_full_prompt_from_cfg(generation_config)
        return generation_config, character_hash, character_name

    def _build_image_gen_autocomplete_choices(
        self,
        bot_config: dict,
        field: str,
        value: object,
        *,
        limit: int = 25,
        server_address: str = "",
    ) -> list[dict]:
        normalized_field = str(field or "").strip().lower()
        if normalized_field in {"prompt", "outfits", "expression", "action", "context", "quality", "negative"}:
            return self._build_image_gen_tag_autocomplete_choices(
                self.core_api.get_tag_predictions() or [],
                value,
                limit=limit,
            )

        if normalized_field == "character":
            characters = [
                str((item or {}).get("name") or "").strip()
                for item in (self.core_api.get_all_characters_list() or [])
            ]
            return self._build_image_gen_simple_autocomplete_choices(characters, value, limit=limit)

        if normalized_field in {"lora", "ckpt", "sampler", "scheduler"}:
            defaults = self._build_image_gen_defaults(bot_config)
            comfy_choices = self.core_api.comfy_api_client.get_full_object_info(
                server_address or defaults.get("server_address") or "127.0.0.1:8888"
            )
            source_map = {
                "lora": ["None"] + list(comfy_choices.get("loras", [])),
                "ckpt": comfy_choices.get("checkpoints", []),
                "sampler": comfy_choices.get("samplers", []),
                "scheduler": comfy_choices.get("schedulers", []),
            }
            return self._build_image_gen_simple_autocomplete_choices(source_map.get(normalized_field, []), value, limit=limit)

        return []

    @staticmethod
    def _is_image_gen_task_for_bot(task: dict | None, bot_id: str) -> bool:
        context = (task or {}).get("context") or {}
        return (
            str(context.get("source") or "").strip() == "discord-bot.image-gen"
            and str(context.get("bot_id") or "").strip() == str(bot_id)
        )

    def _build_image_gen_status_payload(
        self,
        user_hash: str,
        bot_id: str,
        task_id: str,
        *,
        task: dict | None,
        terminal_event: dict | None,
        bot_config: dict | None = None,
    ) -> dict:
        request_cfg = dict(((task or {}).get("generation_config") or {}))
        result = {}
        status = "unknown"
        error_message = ""
        event_type = str((terminal_event or {}).get("type") or "").strip()
        event_data = (terminal_event or {}).get("data") or {}

        if event_type in {"IMAGE_SAVED", "VIDEO_SAVED"} and isinstance(event_data.get("image_data"), dict):
            status = "completed"
            image_data = event_data["image_data"]
            request_cfg = dict(image_data.get("generationConfig") or request_cfg)
            result = {
                "event_type": event_type,
                "image_id": str(image_data.get("id") or "").strip(),
                "is_video": bool(image_data.get("is_video", False)),
                "filename": os.path.basename(str(image_data.get("url") or "").strip()),
                "media_endpoint": f"{self.RUNTIME_API_BASE_URL}/{user_hash}/{bot_id}/image-gen/media/{str(image_data.get('id') or '').strip()}",
                "image_data": image_data,
            }
        elif task:
            if task.get("is_running"):
                status = "running"
            elif task.get("error_message"):
                status = "error"
                error_message = str(task.get("error_message") or "").strip()
            elif task.get("cancel_requested"):
                status = "cancelled"
            else:
                status = "completed"
        elif event_type:
            status = "completed" if event_type in {"IMAGE_SAVED", "VIDEO_SAVED"} else "unknown"

        if not error_message and isinstance(event_data, dict):
            error_message = str(event_data.get("error_message") or "").strip()

        if request_cfg and "combined_text_prompt" not in request_cfg:
            request_cfg["combined_text_prompt"] = build_full_prompt_from_cfg(request_cfg)

        active_defaults = self._build_image_gen_defaults(bot_config or {})
        return {
            "task_id": task_id,
            "status": status,
            "error": error_message,
            "request": {
                "seed": int((request_cfg or {}).get("seed") or 0),
                "user_facing_config": request_cfg or active_defaults,
            },
            "task": task or None,
            "result": result,
            "event": terminal_event or None,
            "prompt_id": str((task or {}).get("prompt_id") or "").strip(),
            "progress_message": str((task or {}).get("progress_message") or "").strip(),
            "progress_percent": int((task or {}).get("progress_percent") or 0),
            "queue_position": int((task or {}).get("queue_position") or 0),
            "current_node_label": str((task or {}).get("current_node_label") or "").strip(),
            "comfy_event_type": str((task or {}).get("comfy_event_type") or "").strip(),
        }

    def _find_user_image_entry(self, user_hash: str, image_id: str) -> dict | None:
        for item in self.core_api.image_service.get_all_user_images(user_hash):
            if str(item.get("id") or "").strip() == str(image_id):
                return item
        return None

    @staticmethod
    def _guess_image_mimetype(image_bytes: bytes) -> str:
        if image_bytes.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if image_bytes.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
            return "image/webp"
        return "application/octet-stream"

    def _normalize_tts_avatar_reference(self, avatar_value: str, normalized_base: str) -> str:
        value = str(avatar_value or "").strip()
        if not value:
            return ""
        if value.startswith(("http://", "https://", "data:")):
            return value

        compact = "".join(value.split())
        try:
            decoded = base64.b64decode(compact, validate=True)
        except (ValueError, binascii.Error):
            decoded = b""
        if decoded:
            mime = self._guess_image_mimetype(decoded)
            if mime.startswith("image/"):
                return f"data:{mime};base64,{compact}"

        return f"{normalized_base}/{value.lstrip('/')}"

    def _fetch_aivisspeech_speaker_avatar(self, base_url: str, speaker_uuid: str) -> str:
        normalized_base = str(base_url or "http://127.0.0.1:10101").strip().rstrip("/") or "http://127.0.0.1:10101"
        normalized_uuid = str(speaker_uuid or "").strip()
        if not normalized_uuid:
            return ""

        cache_key = f"{normalized_base}|{normalized_uuid}"
        cached = self._tts_avatar_cache.get(cache_key)
        if cached is not None:
            return cached

        endpoint = f"{normalized_base}/speaker_info?speaker_uuid={urllib.parse.quote(normalized_uuid)}"
        req = urllib.request.Request(endpoint, headers={"Accept": "application/json"}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                body = response.read().decode("utf-8")
        except Exception:
            self._tts_avatar_cache[cache_key] = ""
            return ""

        try:
            payload = json.loads(body or "{}")
        except json.JSONDecodeError:
            self._tts_avatar_cache[cache_key] = ""
            return ""

        avatar_value = ""
        if isinstance(payload, dict):
            candidate_fields = [
                payload.get("portrait"),
                payload.get("icon"),
                payload.get("avatar_url"),
                payload.get("avatar"),
            ]
            for field in candidate_fields:
                if isinstance(field, str) and field.strip():
                    avatar_value = field.strip()
                    break

        normalized_avatar = self._normalize_tts_avatar_reference(avatar_value, normalized_base) if avatar_value else ""
        self._tts_avatar_cache[cache_key] = normalized_avatar
        return normalized_avatar

    def _fetch_aivisspeech_speakers(self, base_url: str) -> Dict[str, object]:
        normalized_base = str(base_url or "http://127.0.0.1:10101").strip().rstrip("/") or "http://127.0.0.1:10101"
        endpoint = f"{normalized_base}/speakers"
        req = urllib.request.Request(endpoint, headers={"Accept": "application/json"}, method="GET")
        with urllib.request.urlopen(req, timeout=8) as response:
            body = response.read().decode("utf-8")

        payload = json.loads(body or "[]")
        speakers: List[dict] = []
        avatars: Dict[str, str] = {}
        if not isinstance(payload, list):
            return {"speakers": speakers, "avatars": avatars}

        for speaker in payload:
            if not isinstance(speaker, dict):
                continue

            speaker_name = str(speaker.get("name") or speaker.get("speakerName") or "").strip()
            speaker_uuid = str(speaker.get("speaker_uuid") or speaker.get("speakerUuid") or "").strip()

            # Try multiple common fields for avatars in Aivis/VOICEVOX extensions
            avatar_url = ""
            # Aivis Speech / AIVM often puts icon in speaker root, policy, or extra
            candidate_fields = [
                speaker.get("portrait"),
                speaker.get("icon"),
                speaker.get("avatar_url"),
                speaker.get("avatar"),
                speaker.get("policy", {}).get("icon") if isinstance(speaker.get("policy"), dict) else None,
                speaker.get("policy", {}).get("portrait") if isinstance(speaker.get("policy"), dict) else None,
                speaker.get("extra", {}).get("icon") if isinstance(speaker.get("extra"), dict) else None,
                speaker.get("extra", {}).get("portrait") if isinstance(speaker.get("extra"), dict) else None,
            ]

            for field in candidate_fields:
                if isinstance(field, str) and field.strip():
                    avatar_url = self._normalize_tts_avatar_reference(field.strip(), normalized_base)
                    break

            avatar_key = speaker_uuid

            # If still empty, check styles as some engines put it there
            if not avatar_url:
                for style in (speaker.get("styles") or []):
                    if not isinstance(style, dict):
                        continue
                    style_avatar = str(style.get("icon") or style.get("portrait") or "").strip()
                    if style_avatar:
                        avatar_url = self._normalize_tts_avatar_reference(style_avatar, normalized_base)
                        break

            if not avatar_url and speaker_uuid:
                avatar_url = self._fetch_aivisspeech_speaker_avatar(normalized_base, speaker_uuid)

            if avatar_url and avatar_key:
                avatars[avatar_key] = avatar_url

            styles = speaker.get("styles") or []
            if isinstance(styles, list) and styles:
                for style in styles:
                    if not isinstance(style, dict):
                        continue
                    style_id = style.get("id")
                    if style_id is None:
                        continue
                    style_name = str(style.get("name") or style.get("styleName") or speaker_name or f"Speaker {style_id}").strip()
                    speakers.append({
                        "id": str(style_id),
                        "speaker_id": str(style_id),
                        "speaker_uuid": speaker_uuid,
                        "name": speaker_name or style_name,
                        "style_name": style_name,
                        "avatar_url": avatar_url,
                        "avatar_key": avatar_key if avatar_url and avatar_key else "",
                        "engine": "aivisspeech",
                        "base_url": normalized_base,
                    })
                continue

            speaker_id = speaker.get("id")
            if speaker_id is None:
                continue
            speakers.append({
                "id": str(speaker_id),
                "speaker_id": str(speaker_id),
                "speaker_uuid": speaker_uuid,
                "name": speaker_name or f"Speaker {speaker_id}",
                "style_name": "",
                "avatar_url": avatar_url,
                "avatar_key": avatar_key if avatar_url and avatar_key else "",
                "engine": "aivisspeech",
                "base_url": normalized_base,
            })

        return {
            "speakers": speakers,
            "avatars": avatars,
        }

    def _collect_brain_tool_groups(self, modules: List[str], brain_tool_state: dict, *, include_admin: bool) -> List[dict]:
        normalized_state = self._merge_brain_tool_state({}, brain_tool_state, modules=modules, include_admin=include_admin)
        toggles = dict(normalized_state.get("toggles") or {})
        groups: List[dict] = []
        for module_id in self._sanitize_module_ids(modules, include_admin=include_admin):
            if module_id == "core.brain":
                continue
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                continue
            getter = getattr(module, "get_brain_capabilities", None)
            data = getter() if callable(getter) else {}
            if not isinstance(data, dict):
                continue
            tools = data.get("tools") or []
            instructions = data.get("instructions") or []
            normalized_tools = []
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                tool_id = str(tool.get("tool_id") or "").strip()
                if not tool_id:
                    continue
                key = f"{module_id}:{tool_id}"
                default_enabled = bool(tool.get("default_enabled", True))
                normalized_tools.append({
                    "key": key,
                    "tool_id": tool_id,
                    "title": str(tool.get("title") or tool_id),
                    "description": str(tool.get("description") or ""),
                    "default_enabled": default_enabled,
                    "enabled": bool(toggles.get(key, default_enabled)),
                })
            groups.append({
                "module_id": module_id,
                "module_name": getattr(module, "name", module_id),
                "instructions": [str(item) for item in instructions if str(item).strip()],
                "tools": sorted(normalized_tools, key=lambda item: str(item.get("title") or item.get("tool_id") or "")),
            })
        return sorted(groups, key=lambda item: str(item.get("module_name") or item.get("module_id") or ""))

    def _merge_brain_tool_state(self, base_state: dict, incoming_state: dict, *, modules: List[str], include_admin: bool) -> dict:
        merged_toggles = dict((base_state or {}).get("toggles") or {})
        incoming_toggles = dict((incoming_state or {}).get("toggles") or {})
        known_keys: set[str] = set()
        defaults: Dict[str, bool] = {}
        for module_id in self._sanitize_module_ids(modules, include_admin=include_admin):
            if module_id == "core.brain":
                continue
            module = AVAILABLE_MODULES.get(module_id)
            if not module:
                continue
            getter = getattr(module, "get_brain_capabilities", None)
            data = getter() if callable(getter) else {}
            if not isinstance(data, dict):
                continue
            for tool in data.get("tools") or []:
                if not isinstance(tool, dict):
                    continue
                tool_id = str(tool.get("tool_id") or "").strip()
                if not tool_id:
                    continue
                key = f"{module_id}:{tool_id}"
                known_keys.add(key)
                defaults[key] = bool(tool.get("default_enabled", True))
        for key, value in incoming_toggles.items():
            if key in known_keys:
                merged_toggles[key] = bool(value)
        for key in known_keys:
            if key not in merged_toggles:
                merged_toggles[key] = defaults.get(key, True)
        return {
            "toggles": {key: bool(merged_toggles.get(key, defaults.get(key, True))) for key in sorted(known_keys)},
        }

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
            if "brain_tools" not in bot_cfg or not isinstance(bot_cfg.get("brain_tools"), dict):
                bot_cfg["brain_tools"] = {"toggles": {}}
            bot_cfg["runtime_secret"] = str(bot_cfg.get("runtime_secret") or "").strip() or secrets.token_urlsafe(24)
            bot_cfg["tts_engine"] = str(bot_cfg.get("tts_engine") or "aivisspeech").strip() or "aivisspeech"
            bot_cfg["tts_engine_base_url"] = str(bot_cfg.get("tts_engine_base_url") or "http://127.0.0.1:10101").strip() or "http://127.0.0.1:10101"
            bot_cfg["tts_speaker_id"] = str(bot_cfg.get("tts_speaker_id") or "").strip()
            bot_cfg["tts_speaker_name"] = str(bot_cfg.get("tts_speaker_name") or "").strip()
            bot_cfg["tts_speaker_avatar_url"] = str(bot_cfg.get("tts_speaker_avatar_url") or "").strip()
            if bot_cfg["tts_speaker_avatar_url"].startswith("data:"):
                bot_cfg["tts_speaker_avatar_url"] = ""
            bot_cfg["tts_text_source"] = str(bot_cfg.get("tts_text_source") or "secondary").strip().lower() or "secondary"
            defaults = self._build_image_gen_defaults(bot_cfg)
            bot_cfg["image_gen_character_hash"] = defaults["character_hash"]
            bot_cfg["image_gen_character_name"] = defaults["character_name"]
            bot_cfg["image_gen_server_address"] = defaults["server_address"]
            bot_cfg["image_gen_ckpt_name"] = defaults["ckpt_name"]
            bot_cfg["image_gen_lora_name"] = defaults["lora_name"]
            bot_cfg["image_gen_sampler_name"] = defaults["sampler_name"]
            bot_cfg["image_gen_scheduler"] = defaults["scheduler"]
            bot_cfg["image_gen_quality"] = defaults["quality"]
            bot_cfg["image_gen_negative"] = defaults["negative"]
            bot_cfg["image_gen_outfits"] = defaults["outfits"]
            bot_cfg["image_gen_expression"] = defaults["expression"]
            bot_cfg["image_gen_action"] = defaults["action"]
            bot_cfg["image_gen_context"] = defaults["context"]
            bot_cfg["image_gen_width"] = defaults["width"]
            bot_cfg["image_gen_height"] = defaults["height"]
            bot_cfg["image_gen_steps"] = defaults["steps"]
            bot_cfg["image_gen_cfg"] = defaults["cfg"]
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
            runtime.persist_config_callback = lambda patch, uh=user_hash, bid=bot_id: self._persist_runtime_config_patch(uh, bid, patch)
            return runtime

    def _ensure_runtime(self, user_hash: str, bot_id: str, *, include_admin: bool) -> BotRuntime:
        config = self._load_user_configs(user_hash)
        bot_config = config.get("bots", {}).get(bot_id)
        if not bot_config:
            abort(404, description=f"Bot '{bot_id}' not found for current user.")
        runtime_config = dict(bot_config)
        runtime_config["modules"] = self._sanitize_module_ids(runtime_config.get("modules") or [], include_admin=include_admin) or self._default_module_ids(include_admin=include_admin)
        runtime_config["brain_tools"] = self._merge_brain_tool_state(
            runtime_config.get("brain_tools") or {},
            {},
            modules=runtime_config["modules"],
            include_admin=include_admin,
        )
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

import json
import threading
import time
import uuid
from typing import Dict, Optional

from flask import Blueprint, jsonify, request
import websocket


class LoraDownloaderPlugin:
    """
    Backend service for the LoRA Downloader plugin.

    It proxies download requests to the custom ComfyUI node, keeps track of
    progress via websocket updates, and persists the retrieved model metadata.
    """

    DATA_FILENAME = "lora_data.json"

    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint("lora_downloader", __name__)
        self._tasks: Dict[str, dict] = {}
        self._task_lock = threading.Lock()
        self._data_lock = threading.Lock()

        self._register_routes()
        print("[Plugin:LoraDownloader] Backend initialized.")

    # ------------------------------------------------------------------ #
    # Flask blueprint registration
    # ------------------------------------------------------------------ #

    def _register_routes(self):
        @self.blueprint.route("/download", methods=["POST"])
        def request_download():
            try:
                user_hash = self.core_api.verify_token_and_get_user_hash()
            except Exception as exc:  # noqa: BLE001
                return jsonify({"error": str(exc)}), 401

            payload = request.json or {}
            civitai_url = (payload.get("civitai_url") or "").strip()
            api_key = (payload.get("api_key") or "").strip()
            server_address = (payload.get("server_address") or "").strip()
            if not server_address:
                server_address = self._get_default_server_address()

            if not civitai_url:
                return jsonify({"error": "Missing civitai_url"}), 400
            if not server_address:
                return jsonify({"error": "Server address is required."}), 400

            task_id = self._start_download_task(
                user_hash=user_hash,
                civitai_url=civitai_url,
                server_address=server_address,
                api_key=api_key,
            )
            return jsonify({"task_id": task_id})

        @self.blueprint.route("/tasks", methods=["GET"])
        def list_tasks():
            try:
                user_hash = self.core_api.verify_token_and_get_user_hash()
            except Exception as exc:  # noqa: BLE001
                return jsonify({"error": str(exc)}), 401

            tasks = self._get_tasks_for_user(user_hash)
            default_address = self._get_default_server_address()
            return jsonify({"tasks": tasks, "default_server_address": default_address})

        @self.blueprint.route("/lora-data", methods=["GET"])
        def get_lora_data():
            try:
                self.core_api.verify_token_and_get_user_hash()
            except Exception as exc:  # noqa: BLE001
                return jsonify({"error": str(exc)}), 401

            data = self.core_api.read_data(self.DATA_FILENAME, default_value={})
            return jsonify({"models": data})

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/lora-downloader"

    def register_services(self):
        """No cross-plugin services required for now."""
        return None

    # ------------------------------------------------------------------ #
    # Task bookkeeping helpers
    # ------------------------------------------------------------------ #

    def _start_download_task(self, user_hash: str, civitai_url: str, server_address: str, api_key: str):
        task_id = str(uuid.uuid4())
        task_state = {
            "task_id": task_id,
            "user_hash": user_hash,
            "status": "queued",
            "message": "Đang xếp hàng để tải...",
            "progress_percent": 0,
            "filename": None,
            "prompt_id": None,
            "server_address": server_address,
            "civitai_url": civitai_url,
            "api_key_present": bool(api_key),
            "created_at": time.time(),
            "updated_at": time.time(),
        }

        with self._task_lock:
            self._tasks[task_id] = task_state

        thread = threading.Thread(
            target=self._run_download_task,
            args=(task_id, civitai_url, server_address, api_key),
            daemon=True,
        )
        thread.start()

        return task_id

    def _get_tasks_for_user(self, user_hash: str):
        with self._task_lock:
            user_tasks = [
                task.copy()
                for task in self._tasks.values()
                if task["user_hash"] == user_hash
            ]
        user_tasks.sort(key=lambda item: item.get("created_at", 0), reverse=True)
        return user_tasks

    def _update_task(self, task_id: str, **updates):
        with self._task_lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task.update(updates)
            task["updated_at"] = time.time()

    # ------------------------------------------------------------------ #
    # Worker logic
    # ------------------------------------------------------------------ #

    def _run_download_task(self, task_id: str, civitai_url: str, server_address: str, api_key: str):
        client_id = str(uuid.uuid4())
        prompt = {
            "1": {
                "inputs": {
                    "civitai_url": civitai_url,
                    "tracking_id": task_id,
                },
                "class_type": "Yuuka_Lora_Downloader",
            }
        }
        if api_key:
            prompt["1"]["inputs"]["api_key"] = api_key

        prompt_id = None
        ws = None
        model_payload = None
        filename = None
        was_cached = False

        try:
            self._update_task(task_id, status="queued", message="Đang gửi yêu cầu tới ComfyUI...")
            queue_response = self.core_api.comfy_api_client.queue_prompt(prompt, client_id, server_address)
            prompt_id = queue_response.get("prompt_id")
            self._update_task(task_id, prompt_id=prompt_id, status="queued", message="Đang chờ ComfyUI bắt đầu tải...")

            ws = websocket.WebSocket()
            ws.connect(f"ws://{server_address}/ws?clientId={client_id}", timeout=10)
            ws.settimeout(1.0)

            is_running = False
            done = False
            last_queue_check = 0.0

            while not done:
                now = time.time()
                if not is_running and now - last_queue_check > 2.0:
                    last_queue_check = now
                    try:
                        queue_details = self.core_api.comfy_api_client.get_queue_details_sync(server_address)
                        queue_running = queue_details.get("queue_running", [])
                        queue_pending = queue_details.get("queue_pending", [])
                        if any(item[1] == prompt_id for item in queue_running):
                            self._update_task(task_id, status="running", message="Đang chuẩn bị tải từ Civitai...")
                            is_running = True
                        elif any(item[1] == prompt_id for item in queue_pending):
                            position = next(
                                (idx for idx, item in enumerate(queue_pending) if item[1] == prompt_id),
                                None,
                            )
                            if position is not None:
                                self._update_task(
                                    task_id,
                                    message=f"Đang chờ trong hàng ({position + 1} trước).",
                                )
                    except Exception:
                        pass

                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                except websocket.WebSocketConnectionClosedException:
                    break

                if not raw:
                    continue
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="ignore")
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = message.get("type")
                msg_data = message.get("data", {})
                msg_prompt_id = msg_data.get("prompt_id")

                if msg_type == "execution_start" and msg_prompt_id == prompt_id:
                    is_running = True
                    self._update_task(task_id, status="running", message="Đang tải LoRA từ Civitai...")
                    continue

                if msg_type == "progress" and msg_prompt_id == prompt_id:
                    value = msg_data.get("value", 0)
                    maximum = msg_data.get("max", 1)
                    percent = int(value / maximum * 100) if maximum else 0
                    self._update_task(task_id, progress_percent=percent)
                    continue

                if msg_type == "execution_error" and msg_prompt_id == prompt_id:
                    error_message = msg_data.get("exception_message", "ComfyUI execution error.")
                    self._update_task(task_id, status="error", message=error_message)
                    return

                if msg_type == "executing" and msg_prompt_id == prompt_id and msg_data.get("node") is None:
                    done = True
                    continue

                if msg_type == "yuuka.lora_downloader":
                    if msg_data.get("tracking_id") != task_id:
                        continue
                    status_flag = msg_data.get("status")
                    status_message = msg_data.get("message", "")
                    update_payload = {"message": status_message}

                    if status_flag == "downloading":
                        update_payload["status"] = "running"
                        if "progress_percent" in msg_data:
                            update_payload["progress_percent"] = msg_data.get("progress_percent") or 0
                        if msg_data.get("filename"):
                            update_payload["filename"] = msg_data["filename"]
                    elif status_flag == "info":
                        update_payload.setdefault("status", "queued")
                        if msg_data.get("filename"):
                            update_payload["filename"] = msg_data["filename"]
                    elif status_flag == "completed":
                        update_payload["status"] = "completed"
                        update_payload["progress_percent"] = 100
                        filename = msg_data.get("filename") or filename
                        model_payload = msg_data.get("model_data") or model_payload
                        was_cached = bool(msg_data.get("was_cached"))
                        done = True
                    elif status_flag == "error":
                        update_payload["status"] = "error"
                        done = True

                    self._update_task(task_id, **update_payload)

        except Exception as exc:  # noqa: BLE001
            self._update_task(task_id, status="error", message=f"Lỗi: {exc}")
            return
        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass

        if self._tasks.get(task_id, {}).get("status") == "error":
            return

        if model_payload:
            stored = self._store_model_data(model_payload, civitai_url, filename, was_cached)
            if stored and filename:
                self._update_task(
                    task_id,
                    status="completed",
                    filename=filename,
                    stored=True,
                    was_cached=was_cached,
                    message="Đã lưu metadata LoRA.",
                )
        else:
            # As a fallback, mark task as completed even if metadata is missing.
            self._update_task(task_id, status="completed", message="Hoàn tất, nhưng thiếu metadata từ node.")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _store_model_data(self, model_data: dict, civitai_url: str, filename: Optional[str], was_cached: bool):
        primary_key = str(model_data.get("id") or filename or model_data.get("name") or uuid.uuid4())
        record = {
            "id": model_data.get("id"),
            "name": model_data.get("name"),
            "filename": filename,
            "civitai_url": civitai_url,
            "was_cached": was_cached,
            "updated_at": time.time(),
            "model_data": model_data,
        }

        with self._data_lock:
            data = self.core_api.read_data(self.DATA_FILENAME, default_value={})
            data[primary_key] = record
            success = self.core_api.save_data(data, self.DATA_FILENAME)
        return success

    def _get_default_server_address(self) -> Optional[str]:
        comfy_cfg = self.core_api.read_data("comfyui_config.json", default_value={})
        return comfy_cfg.get("server_address")

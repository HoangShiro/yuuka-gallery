import base64
import json
import os
import threading
import time
import uuid
import urllib.parse

from flask import Blueprint, jsonify, request
import websocket


class LiveGenPlugin:
    CONFIG_FILENAME = "live_gen_config.json"

    DEFAULT_CONFIG = {
        "server_address": "127.0.0.1:8888",
        "ckpt_name": "waiNSFWIllustrious_v170.safetensors",
        "quality": "masterpiece, best quality, highres, amazing quality",
        "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
        "batch_size": 1,
        "height": 1216,
        "width": 832,
        "cfg": 3,
        "sampler_name": "euler_ancestral",
        "scheduler": "beta",
        "steps": 12,
        "seed": 123456789,
        "lora_name": "None",
        "lora_strength_model": 0.9,
        "lora_strength_clip": 1.0,
        "hires_enabled": False,
        "lora_prompt_tags": [],
        "i2i_keep_denoise": 0.45,
        "i2i_refine_denoise": 0.25,
    }

    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint("live_gen", __name__)
        self._sessions = set()
        self._sessions_lock = threading.Lock()
        self.register_routes()
        print("[Plugin:LiveGen] Backend initialized.")

    def register_routes(self):
        @self.blueprint.route("/config", methods=["GET"])
        def get_config():
            self.core_api.verify_token_and_get_user_hash()
            return jsonify(self._get_config())

        @self.blueprint.route("/config", methods=["POST"])
        def save_config():
            self.core_api.verify_token_and_get_user_hash()
            data = request.get_json(silent=True) or {}
            config = self._get_config()
            config.update(self._sanitize_config(data))
            self.core_api.save_data(config, self.CONFIG_FILENAME)
            return jsonify({"status": "success", "config": config})

        @self.blueprint.route("/comfy-info", methods=["GET"])
        def get_comfy_info():
            self.core_api.verify_token_and_get_user_hash()
            config = self._get_config()
            server_address = config.get("server_address", "127.0.0.1:8888")
            try:
                info = self.core_api.comfy_api_client.get_full_object_info(server_address)
                return jsonify(info)
            except Exception as err:
                return jsonify({"error": str(err)}), 500

        @self.blueprint.route("/history", methods=["GET"])
        def get_history_images():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            self._ensure_live_gen_albums(user_hash)
            images = self.core_api.image_service.get_images_by_character(user_hash, "live-gen-history")
            return jsonify({"status": "success", "images": images})

        @self.blueprint.route("/favorites", methods=["GET"])
        def get_favorites_images():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            self._ensure_live_gen_albums(user_hash)
            images = self.core_api.image_service.get_images_by_character(user_hash, "live-gen-favorite")
            return jsonify({"status": "success", "images": images})

        @self.blueprint.route("/favorite", methods=["POST"])
        def add_favorite():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.get_json(silent=True) or {}
            image_url = data.get("imageUrl")
            if not image_url:
                return jsonify({"error": "Thiếu imageUrl"}), 400
                
            all_images = self.core_api.image_service.data_manager.read_json(
                self.core_api.image_service.IMAGE_DATA_FILENAME, obfuscated=True
            )
            user_images = all_images.setdefault(user_hash, {})
            
            from urllib.parse import urlparse
            req_path = urlparse(image_url).path
            
            # Tìm ảnh trong cơ sở dữ liệu
            matching_img = None
            for char_hash, imgs in user_images.items():
                for img in imgs:
                    db_url = img.get("url") or ""
                    db_pv_url = img.get("pv_url") or ""
                    db_path = urlparse(db_url).path
                    db_pv_path = urlparse(db_pv_url).path
                    
                    if db_path == req_path or db_pv_path == req_path:
                        matching_img = img
                        break
                if matching_img:
                    break
                    
            if not matching_img:
                return jsonify({"error": "Không tìm thấy ảnh", "requested_url": image_url, "resolved_path": req_path}), 404
                
            favorite_images = user_images.setdefault("live-gen-favorite", [])
            
            # Robust duplicate checking
            is_duplicate = False
            for img in favorite_images:
                if img.get("original_image_id") == matching_img.get("id"):
                    is_duplicate = True
                    break
                match_snap = matching_img.get("generationConfig", {}).get("snapshot_id")
                img_snap = img.get("generationConfig", {}).get("snapshot_id")
                if match_snap and img_snap and match_snap == img_snap:
                    # Match hires_enabled exactly
                    match_hires = matching_img.get("generationConfig", {}).get("hires_enabled", False)
                    img_hires = img.get("generationConfig", {}).get("hires_enabled", False)
                    if match_hires == img_hires:
                        is_duplicate = True
                        break
            
            if is_duplicate:
                return jsonify({"status": "exists", "message": "Ảnh đã nằm trong danh sách Yêu thích."})
                
            import copy
            import shutil
            
            new_id = str(uuid.uuid4())
            fav_entry = copy.deepcopy(matching_img)
            fav_entry["id"] = new_id
            fav_entry["original_image_id"] = matching_img.get("id")
            fav_entry["character_hash"] = "live-gen-favorite"
            fav_entry["createdAt"] = int(time.time())
            
            # 1. Duplicate Main Image physically
            old_url = matching_img.get("url")
            if old_url:
                try:
                    old_filename = os.path.basename(old_url)
                    ext = os.path.splitext(old_filename)[1]
                    new_filename = f"fav_{new_id}{ext}"
                    
                    old_filepath = self.core_api.image_service.data_manager.get_path(os.path.join('user_images', 'imgs', old_filename))
                    new_filepath = self.core_api.image_service.data_manager.get_path(os.path.join('user_images', 'imgs', new_filename))
                    
                    if os.path.exists(old_filepath):
                        os.makedirs(os.path.dirname(new_filepath), exist_ok=True)
                        shutil.copy2(old_filepath, new_filepath)
                        fav_entry["url"] = f"/user_image/imgs/{new_filename}"
                except Exception as e:
                    print(f"⚠️ [LiveGen Favorite] Lỗi sao chép file ảnh gốc: {e}")

            # 2. Duplicate Preview Image physically
            old_pv_url = matching_img.get("pv_url")
            if old_pv_url:
                try:
                    old_pv_filename = os.path.basename(old_pv_url)
                    ext = os.path.splitext(old_pv_filename)[1]
                    new_pv_filename = f"fav_{new_id}_pv{ext}"
                    
                    old_pv_filepath = self.core_api.image_service.data_manager.get_path(os.path.join('user_images', 'pv_imgs', old_pv_filename))
                    new_pv_filepath = self.core_api.image_service.data_manager.get_path(os.path.join('user_images', 'pv_imgs', new_pv_filename))
                    
                    if os.path.exists(old_pv_filepath):
                        os.makedirs(os.path.dirname(new_pv_filepath), exist_ok=True)
                        shutil.copy2(old_pv_filepath, new_pv_filepath)
                        fav_entry["pv_url"] = f"/user_image/pv_imgs/{new_pv_filename}"
                except Exception as e:
                    print(f"⚠️ [LiveGen Favorite] Lỗi sao chép file ảnh preview: {e}")
            
            favorite_images.append(fav_entry)
            self.core_api.image_service.data_manager.save_json(
                all_images, self.core_api.image_service.IMAGE_DATA_FILENAME, obfuscated=True
            )
            self._ensure_live_gen_albums(user_hash)
            return jsonify({"status": "success", "message": "Đã thêm vào album Yêu thích!"})

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/live-gen"

    def shutdown(self):
        with self._sessions_lock:
            sessions = list(self._sessions)
        for session in sessions:
            session.close()

    def handle_websocket(self, ws):
        token = self._extract_token(ws)
        try:
            user_hash = self.core_api.verify_token_and_get_user_hash(token_override=token)
        except Exception as err:
            self._safe_send(ws, {"type": "error", "message": f"Auth failed: {err}"})
            try:
                ws.close()
            except Exception:
                pass
            return

        session = _LiveGenSession(self, ws, user_hash)
        with self._sessions_lock:
            self._sessions.add(session)

        try:
            session.send({"type": "ready", "config": self._get_config()})
            while not session.closed:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    message = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    session.send({"type": "error", "message": "Invalid websocket message."})
                    continue

                msg_type = message.get("type")
                if msg_type == "generate":
                    session.start_generation(
                        prompt=message.get("prompt", ""),
                        seed=message.get("seed"),
                        config_overrides=message.get("config") or {},
                        seq=message.get("seq"),
                        input_image_base64=message.get("input_image_base64"),
                    )
                elif msg_type == "cancel":
                    session.cancel_current()
                elif msg_type == "update_config":
                    current = self._get_config()
                    current.update(self._sanitize_config(message.get("config") or {}))
                    self.core_api.save_data(current, self.CONFIG_FILENAME)
                    session.send({"type": "config", "config": current})
                elif msg_type == "ping":
                    session.send({"type": "pong", "time": time.time()})
                else:
                    session.send({"type": "error", "message": f"Unknown message type: {msg_type}"})
        finally:
            session.close()
            with self._sessions_lock:
                self._sessions.discard(session)

    def _get_config(self):
        global_comfy = self.core_api.read_data("comfyui_config.json", default_value={})
        saved = self.core_api.read_data(self.CONFIG_FILENAME, default_value={})
        config = {
            **self.DEFAULT_CONFIG,
            **self._sanitize_config(global_comfy),
            **self._sanitize_config(saved),
        }
        return config

    def _sanitize_config(self, config):
        if not isinstance(config, dict):
            return {}
        allowed = set(self.DEFAULT_CONFIG.keys()) | {
            "_workflow_type",
            "workflow_type",
            "workflow_template",
            "lora_chain",
            "lora_names",
            "multi_lora_prompt_groups",
            "multi_lora_prompt_tags",
            "hires_base_width",
            "hires_base_height",
            "hires_stage1_denoise",
            "hires_stage2_steps",
            "hires_stage2_cfg",
            "hires_stage2_sampler_name",
            "hires_stage2_scheduler",
            "hires_stage2_denoise",
            "hires_upscale_model",
            "hires_upscale_method",
            "preview_mode",
            "_input_image_name",
            "denoise",
        }
        result = {key: value for key, value in config.items() if key in allowed}

        int_keys = ("seed", "steps", "width", "height", "batch_size", "hires_base_width", "hires_base_height", "hires_stage2_steps")
        for key in int_keys:
            if key in result:
                try:
                    value = int(result[key])
                    if key != "seed" and value <= 0:
                        continue
                    result[key] = value
                except (TypeError, ValueError):
                    result.pop(key, None)

        float_keys = ("cfg", "lora_strength_model", "lora_strength_clip", "hires_stage1_denoise", "hires_stage2_cfg", "hires_stage2_denoise", "denoise", "i2i_keep_denoise", "i2i_refine_denoise")
        for key in float_keys:
            if key in result:
                try:
                    result[key] = float(result[key])
                except (TypeError, ValueError):
                    result.pop(key, None)

        if "hires_enabled" in result:
            value = result["hires_enabled"]
            if isinstance(value, str):
                result["hires_enabled"] = value.strip().lower() in ("1", "true", "yes", "on")
            else:
                result["hires_enabled"] = bool(value)

        return result

    def _extract_token(self, ws):
        environ = getattr(ws, "environ", {}) or {}
        query = environ.get("QUERY_STRING", "")
        params = urllib.parse.parse_qs(query)
        token = (params.get("token") or [""])[0]
        return token.strip()

    def _safe_send(self, ws, payload):
        try:
            ws.send(json.dumps(payload))
            return True
        except Exception:
            return False

    def _ensure_live_gen_albums(self, user_hash):
        """Đảm bảo các album 'Live Gen History' và 'Live Gen Favorite' được đăng ký trong danh sách custom albums."""
        try:
            filename = "album_custom_list.json"
            current_albums = self.core_api.data_manager.load_user_data(
                filename, user_hash, default_value=[], obfuscated=True
            )
            if not isinstance(current_albums, list):
                current_albums = []
            
            modified = False
            hashes = {entry.get("hash") for entry in current_albums if isinstance(entry, dict)}
            
            defs = [
                {"hash": "live-gen-history", "name": "Live Gen History"},
                {"hash": "live-gen-favorite", "name": "Live Gen Favorite"}
            ]
            for d in defs:
                if d["hash"] not in hashes:
                    timestamp = int(time.time())
                    current_albums.append({
                        "hash": d["hash"],
                        "name": d["name"],
                        "created_at": timestamp,
                        "updated_at": timestamp
                    })
                    modified = True
            
            if modified:
                self.core_api.data_manager.save_user_data(
                    current_albums, filename, user_hash, obfuscated=True
                )
        except Exception as e:
            print(f"⚠️ [LiveGen] Không thể đảm bảo đăng ký album: {e}")

    def _compute_snapshot_id(self, prompt, config):
        """Tạo MD5 ID ngắn (12 ký tự) cực kỳ deterministic dựa trên Prompt và Settings cấu hình."""
        relevant_keys = [
            "ckpt_name", "sampler_name", "scheduler", "steps", "cfg", 
            "width", "height", "lora_name", "lora_strength_model", 
            "lora_strength_clip", "lora_chain", "denoise"
        ]
        
        standardized_prompt = str(prompt or "").strip().lower()
        seed = config.get("seed")
        try:
            seed = int(seed) if seed is not None else 0
        except (ValueError, TypeError):
            seed = 0
            
        normalized = {
            "prompt": standardized_prompt,
            "seed": seed
        }
        for key in relevant_keys:
            if key in config:
                val = config[key]
                if isinstance(val, str):
                    val = val.strip().lower()
                elif isinstance(val, bool):
                    val = str(val).lower()
                normalized[key] = val
                
        serialized = json.dumps(normalized, sort_keys=True)
        import hashlib
        return hashlib.md5(serialized.encode('utf-8')).hexdigest()[:12]


class _LiveGenSession:
    def __init__(self, plugin, ws, user_hash):
        self.plugin = plugin
        self.core_api = plugin.core_api
        self.ws = ws
        self.user_hash = user_hash
        self.send_lock = threading.Lock()
        self.current_lock = threading.Lock()
        self.current = None
        self.closed = False

    def send(self, payload):
        if self.closed:
            return False
        with self.send_lock:
            return self.plugin._safe_send(self.ws, payload)

    def start_generation(self, prompt, seed=None, config_overrides=None, seq=None, input_image_base64=None):
        prompt = str(prompt or "").strip()
        if not prompt:
            self.cancel_current()
            self.send({"type": "idle", "seq": seq})
            return

        self.cancel_current()
        stop_event = threading.Event()
        generation_id = uuid.uuid4().hex
        thread = threading.Thread(
            target=self._run_generation,
            args=(generation_id, prompt, seed, config_overrides or {}, seq, stop_event, input_image_base64),
            daemon=True,
        )
        with self.current_lock:
            self.current = {
                "id": generation_id,
                "thread": thread,
                "stop_event": stop_event,
                "prompt_id": None,
                "server_address": None,
            }
        thread.start()

    def cancel_current(self):
        with self.current_lock:
            current = self.current
            self.current = None
        if not current:
            return
        current["stop_event"].set()
        prompt_id = current.get("prompt_id")
        server_address = current.get("server_address")
        if prompt_id and server_address:
            try:
                queue_details = self.core_api.comfy_api_client.get_queue_details_sync(server_address)
                running = any(item[1] == prompt_id for item in queue_details.get("queue_running", []))
                pending = any(item[1] == prompt_id for item in queue_details.get("queue_pending", []))
                if pending:
                    self.core_api.comfy_api_client.delete_queued_item(prompt_id, server_address)
                if running:
                    self.core_api.comfy_api_client.interrupt_execution(server_address)
            except Exception as err:
                self.send({"type": "warning", "message": f"Cancel failed: {err}"})

    def close(self):
        self.closed = True
        self.cancel_current()
        try:
            self.ws.close()
        except Exception:
            pass

    def _run_generation(self, generation_id, prompt, seed, overrides, seq, stop_event, input_image_base64=None):
        comfy_ws = None
        prompt_id = None
        server_address = None
        try:
            config = self._build_config(prompt, seed, overrides)
            server_address = str(config.get("server_address") or "127.0.0.1:8888").strip()
            
            # --- Smart Cache Snapshot Check ---
            snapshot_id = self.plugin._compute_snapshot_id(prompt, config)
            history_images = self.core_api.image_service.get_images_by_character(self.user_hash, "live-gen-history")
            cached_entry = None
            
            current_hires = config.get("hires_enabled", False)
            if isinstance(current_hires, str):
                current_hires = current_hires.strip().lower() in ("1", "true", "yes", "on")
            else:
                current_hires = bool(current_hires)
                
            # Allow cache check if no input image is provided, OR if it is a pure Hires upgrade request
            allow_cache = not input_image_base64 or current_hires
            
            if history_images and allow_cache:
                for img in history_images:
                    cfg = img.get("generationConfig") or {}
                    if cfg.get("snapshot_id") == snapshot_id:
                        # Match hires_enabled exactly
                        cached_hires = cfg.get("hires_enabled", False)
                        if isinstance(cached_hires, str):
                            cached_hires = cached_hires.strip().lower() in ("1", "true", "yes", "on")
                        else:
                            cached_hires = bool(cached_hires)
                            
                        if cached_hires == current_hires:
                            cached_entry = img
                            break
            
            if cached_entry:
                try:
                    filename = os.path.basename(cached_entry["url"])
                    img_bytes, mime = self.core_api.get_user_image_data('imgs', filename)
                    if not img_bytes:
                        raise FileNotFoundError(f"Source image file not found: {filename}")
                    b64_img = f"data:{mime};base64,{base64.b64encode(img_bytes).decode('ascii')}"
                    
                    seed_value = int(config.get("seed") or 0)
                    self.send({
                        "type": "starting",
                        "seq": seq,
                        "seed": seed_value,
                        "prompt": prompt,
                        "message": "Đang khôi phục từ Cache...",
                    })
                    time.sleep(0.15)
                    self.send({
                        "type": "final",
                        "seq": seq,
                        "prompt_id": "cached_" + snapshot_id,
                        "image": b64_img,
                        "seed": seed_value,
                        "snapshot_id": snapshot_id,
                        "config": config,
                        "message": "Đã khôi phục từ Cache.",
                    })
                    return # Thoát sớm
                except Exception as e:
                    print(f"⚠️ [LiveGen Cache] Lỗi đọc file cache, tiến hành tạo mới: {e}")

            if input_image_base64:
                config["_input_image_base64"] = input_image_base64
                config["_workflow_type"] = "image2image"
            else:
                config.pop("_input_image_base64", None)
                if config.get("_workflow_type") in ("image2image", "hires_input_image"):
                    config.pop("_workflow_type", None)

            seed_value = int(config.get("seed") or 0)
            if seed_value <= 0:
                seed_value = uuid.uuid4().int % (10**15)

            # Build workflow directly - no node injection required!
            workflow, output_node_id = self.core_api.workflow_builder.build_workflow(config, seed_value)
            client_id = str(uuid.uuid4())

            self.send({
                "type": "starting",
                "seq": seq,
                "seed": seed_value,
                "prompt": prompt,
                "message": "Connecting to ComfyUI...",
            })

            comfy_ws = websocket.WebSocket()
            comfy_ws.connect(f"ws://{server_address}/ws?clientId={client_id}", timeout=10)
            comfy_ws.settimeout(1.0)

            prompt_info = self.core_api.comfy_api_client.queue_prompt(workflow, client_id, server_address)
            prompt_id = prompt_info["prompt_id"]

            with self.current_lock:
                if self.current and self.current.get("id") == generation_id:
                    self.current["prompt_id"] = prompt_id
                    self.current["server_address"] = server_address

            self.send({
                "type": "queued",
                "seq": seq,
                "prompt_id": prompt_id,
                "seed": seed_value,
                "message": "Queued.",
            })

            finished = False
            while not stop_event.is_set():
                try:
                    raw = comfy_ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                except websocket.WebSocketConnectionClosedException:
                    break

                if isinstance(raw, (bytes, bytearray)):
                    # Native ComfyUI auto-preview sends binary packets over WebSocket!
                    image_payload, mime = self._extract_preview_payload(bytes(raw))
                    if image_payload:
                        self.send({
                            "type": "preview",
                            "seq": seq,
                            "prompt_id": prompt_id,
                            "image": f"data:{mime};base64,{base64.b64encode(image_payload).decode('ascii')}",
                        })
                    continue

                if not isinstance(raw, str):
                    continue

                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = message.get("type")
                data = message.get("data") or {}
                if data.get("prompt_id") and data.get("prompt_id") != prompt_id:
                    continue

                if msg_type == "execution_start":
                    self.send({"type": "progress", "seq": seq, "prompt_id": prompt_id, "percent": 0, "message": "Started."})
                elif msg_type == "executing" and data.get("node") is not None:
                    self.send({
                        "type": "node",
                        "seq": seq,
                        "prompt_id": prompt_id,
                        "node": data.get("node"),
                        "message": "Processing node...",
                    })
                elif msg_type == "progress":
                    value = int(data.get("value") or 0)
                    maximum = int(data.get("max") or 1)
                    percent = int(value / maximum * 100) if maximum > 0 else 0
                    self.send({
                        "type": "progress",
                        "seq": seq,
                        "prompt_id": prompt_id,
                        "value": value,
                        "max": maximum,
                        "percent": percent,
                        "message": f"Step {value}/{maximum}",
                    })
                elif msg_type == "execution_error":
                    raise RuntimeError(data.get("exception_message") or "ComfyUI execution error.")
                elif msg_type in ("executing", "execution_done", "execution_end") and data.get("node") is None:
                    finished = True
                    break

            if stop_event.is_set():
                self.send({"type": "cancelled", "seq": seq, "prompt_id": prompt_id})
                return

            if not finished:
                raise RuntimeError("ComfyUI websocket closed before execution finished.")

            final_image = self._fetch_final_image(prompt_id, output_node_id, server_address, stop_event)
            if final_image:
                # --- Save Snapshot to Live Gen History ---
                raw_b64 = final_image
                if "," in raw_b64:
                    raw_b64 = raw_b64.split(",", 1)[1]
                
                config["snapshot_id"] = snapshot_id
                
                # Check and delete any existing duplicate snapshot with the same snapshot_id and same hires state
                try:
                    current_hires = config.get("hires_enabled", False)
                    if isinstance(current_hires, str):
                        current_hires = current_hires.strip().lower() in ("1", "true", "yes", "on")
                    else:
                        current_hires = bool(current_hires)

                    history_images = self.core_api.image_service.get_images_by_character(self.user_hash, "live-gen-history")
                    if history_images:
                        for img in history_images:
                            cfg = img.get("generationConfig") or {}
                            if cfg.get("snapshot_id") == snapshot_id:
                                cached_hires = cfg.get("hires_enabled", False)
                                if isinstance(cached_hires, str):
                                    cached_hires = cached_hires.strip().lower() in ("1", "true", "yes", "on")
                                else:
                                    cached_hires = bool(cached_hires)
                                    
                                if cached_hires == current_hires:
                                    old_image_id = img.get("id")
                                    if old_image_id:
                                        print(f"[LiveGen History] Deleting old duplicate {old_image_id} with same hires state {current_hires}")
                                        self.core_api.image_service.delete_image_by_id(self.user_hash, old_image_id)
                except Exception as e:
                    print(f"⚠️ [LiveGen History] Failed to clean up duplicate snapshot: {e}")
                
                creation_duration = 0.0 # dummy creation time
                self.core_api.image_service.save_image_metadata(
                    self.user_hash,
                    "live-gen-history",
                    raw_b64,
                    config,
                    creation_duration
                )
                self.plugin._ensure_live_gen_albums(self.user_hash)
                
                self.send({
                    "type": "final",
                    "seq": seq,
                    "prompt_id": prompt_id,
                    "image": final_image,
                    "seed": seed_value,
                    "snapshot_id": snapshot_id,
                    "config": config,
                    "message": "Done.",
                })
            else:
                raise RuntimeError("No final image returned from ComfyUI history.")
        except Exception as err:
            if not stop_event.is_set():
                self.send({"type": "error", "seq": seq, "message": str(err)})
        finally:
            if comfy_ws:
                try:
                    comfy_ws.close()
                except Exception:
                    pass
            with self.current_lock:
                if self.current and self.current.get("id") == generation_id:
                    self.current = None

    def _build_config(self, prompt, seed, overrides):
        base = self.plugin._get_config()
        base.update(self.plugin._sanitize_config(overrides))

        quality = str(base.get("quality") or "").strip()
        positive_prompt = prompt

        # Append LoRA prompt tags with multi-LoRA awareness
        lora_tags_str = ""
        multi_tags = base.get("multi_lora_prompt_tags")
        if isinstance(multi_tags, str) and multi_tags.strip():
            lora_tags_str = multi_tags.strip()
        else:
            single_tags = base.get("lora_prompt_tags", [])
            if isinstance(single_tags, list) and single_tags:
                lora_tags_str = ", ".join([str(t).strip() for t in single_tags if str(t).strip()])

        if lora_tags_str:
            positive_prompt = f"{positive_prompt}, {lora_tags_str}"

        if quality:
            positive_prompt = f"{positive_prompt}, {quality}"

        base["seed"] = seed if seed is not None else base.get("seed", 0)
        base["prompt"] = prompt
        base["combined_text_prompt"] = positive_prompt
        base["character"] = ""
        base["outfits"] = ""
        base["expression"] = ""
        base["action"] = ""
        base["context"] = ""
        base["batch_size"] = 1
        return base

    def _fetch_final_image(self, prompt_id, output_node_id, server_address, stop_event):
        for _ in range(90):
            if stop_event.is_set():
                return None
            history = self.core_api.comfy_api_client.get_history(prompt_id, server_address)
            outputs = history.get(prompt_id, {}).get("outputs", {})
            node_output = outputs.get(output_node_id, {}) if isinstance(outputs, dict) else {}
            if isinstance(node_output, dict):
                images_base64 = node_output.get("images_base64") or []
                if images_base64:
                    image = images_base64[0]
                    if isinstance(image, str) and image.startswith("data:"):
                        return image
                    return f"data:image/png;base64,{image}"
            time.sleep(0.5)
        return None

    def _extract_preview_payload(self, raw):
        candidates = []
        if len(raw) > 8:
            candidates.append(raw[8:])
        if len(raw) > 4:
            candidates.append(raw[4:])
        candidates.append(raw)

        for offset in range(0, min(len(raw), 48)):
            candidate = raw[offset:]
            if self._guess_mime(candidate):
                candidates.append(candidate)

        for candidate in candidates:
            mime = self._guess_mime(candidate)
            if mime:
                return candidate, mime

        return None, None

    def _guess_mime(self, data):
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"RIFF") and len(data) > 12 and data[8:12] == b"WEBP":
            return "image/webp"
        return None

import base64
import json
import os
import time
import uuid
import websocket
from ..utils.snapshot import compute_snapshot_id, normalize_prompt

class GenerationService:
    def __init__(self, core_api, config_service, history_service):
        self.core_api = core_api
        self.config_service = config_service
        self.history_service = history_service

    def run_generation(self, session, generation_id, prompt, seed, overrides, seq, stop_event, input_image_base64=None):
        comfy_ws = None
        prompt_id = None
        server_address = None
        try:
            config = self._build_config(prompt, seed, overrides)
            server_address = str(config.get("server_address") or "127.0.0.1:8888").strip()
            
            # --- Smart Cache Snapshot Check ---
            snapshot_id = compute_snapshot_id(prompt, config)
            history_images = self.history_service.get_history_images(session.user_hash)
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
                    img_snap_id = cfg.get("snapshot_id")
                    if img_snap_id == snapshot_id:
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
                    session.send({
                        "type": "starting",
                        "seq": seq,
                        "seed": seed_value,
                        "prompt": prompt,
                        "message": "Đang khôi phục từ Cache...",
                    })
                    time.sleep(0.15)
                    session.send({
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

            # Build workflow directly
            workflow, output_node_id = self.core_api.workflow_builder.build_workflow(config, seed_value)
            client_id = str(uuid.uuid4())

            session.send({
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

            with session.current_lock:
                if session.current and session.current.get("id") == generation_id:
                    session.current["prompt_id"] = prompt_id
                    session.current["server_address"] = server_address

            session.send({
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
                        session.send({
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
                    session.send({"type": "progress", "seq": seq, "prompt_id": prompt_id, "percent": 0, "message": "Started."})
                elif msg_type == "executing" and data.get("node") is not None:
                    session.send({
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
                    session.send({
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
                session.send({"type": "cancelled", "seq": seq, "prompt_id": prompt_id})
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
                self.history_service.clean_duplicate_snapshot(session.user_hash, snapshot_id, current_hires)
                
                self.history_service.save_generation_metadata(session.user_hash, raw_b64, config)
                
                session.send({
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
                session.send({"type": "error", "seq": seq, "message": str(err)})
        finally:
            if comfy_ws:
                try:
                    comfy_ws.close()
                except Exception:
                    pass
            with session.current_lock:
                if session.current and session.current.get("id") == generation_id:
                    session.current = None

    def _build_config(self, prompt, seed, overrides):
        base = self.config_service.get_config()
        base.update(self.config_service.sanitize_config(overrides))

        quality = str(base.get("quality") or "").strip()
        positive_prompt = normalize_prompt(prompt)

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

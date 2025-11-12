# --- MODIFIED FILE: plugins/album/backend.py ---
import time
import threading
import websocket
import json
import os
from copy import deepcopy

from flask import Blueprint, jsonify, request, abort

class AlbumPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('album', __name__)
        
        # Yuuka: Các file config vẫn do plugin quản lý
        self.COMFYUI_CONFIG_FILENAME = "comfyui_config.json"
        self.ALBUM_CHAR_CONFIG_FILENAME = "album_character_configs.json"
        self.ALBUM_CUSTOM_LIST_FILENAME = "album_custom_list.json"
        
        self.DEFAULT_CONFIG = {
            "server_address": "127.0.0.1:8888", "ckpt_name": "waiNSFWIllustrious_v150.safetensors",
            "character": "", "expression": "smile", "action": "sitting", "outfits": "school uniform",
            "context": "1girl, classroom", "quality": "masterpiece, best quality, highres, amazing quality",
            "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
            "batch_size": 1, "height": 1216, "width": 832, "cfg": 2.2, "sampler_name": "dpmpp_sde",
            "scheduler": "beta", "steps": 12, "lora_name": "None", "lora_strength_model": 0.9,
            "lora_strength_clip": 1.0,
            "hires_enabled": False,
            "hires_stage1_denoise": 1.0,
            "hires_stage2_steps": 14,
            "hires_stage2_cfg": 2.4,
            "hires_stage2_sampler_name": "euler_ancestral",
            "hires_stage2_scheduler": "karras",
            "hires_stage2_denoise": 0.5,
            "hires_upscale_model": "4x-UltraSharp.pth",
            "hires_upscale_method": "bilinear",
            "hires_base_width": 0,
            "hires_base_height": 0,
            "lora_prompt_tags": [],
        }
        
        self.register_routes()

    def _sanitize_config(self, config_data):
        if not isinstance(config_data, dict): return config_data
        sanitized = {}
        for key, value in config_data.items():
            if isinstance(value, str):
                sanitized[key] = value.strip()
            else:
                sanitized[key] = value
        return sanitized

    # --- Multi-LoRA helpers ---
    def _parse_lora_names_to_list(self, names_val):
        """Accepts list[str] or CSV string and returns list[str] filtered (not None/empty)."""
        result = []
        if isinstance(names_val, list):
            result = [str(s).strip() for s in names_val if str(s).strip()]
        elif isinstance(names_val, str):
            parts = [p.strip() for p in names_val.split(',') if p.strip()]
            result = parts
        return [s for s in result if s.lower() != "none"]

    def _normalize_lora_chain(self, cfg: dict):
        """Build a normalized LoRA chain from config fields.
        Priorities: lora_chain > lora_names > lora_name (single).
        Returns list of dicts: {lora_name, strength_model, strength_clip}.
        """
        if not isinstance(cfg, dict):
            return []
        def_sm = cfg.get('lora_strength_model', self.DEFAULT_CONFIG.get('lora_strength_model', 0.9))
        def_sc = cfg.get('lora_strength_clip', self.DEFAULT_CONFIG.get('lora_strength_clip', 1.0))

        chain = cfg.get('lora_chain')
        normalized = []
        if isinstance(chain, list) and chain:
            for item in chain:
                if isinstance(item, dict):
                    name = item.get('name') or item.get('lora_name') or ''
                    name = str(name).strip()
                    if name and name.lower() != 'none':
                        sm = item.get('strength_model', item.get('lora_strength_model', def_sm))
                        sc = item.get('strength_clip', item.get('lora_strength_clip', def_sc))
                        try:
                            sm = float(sm)
                        except (TypeError, ValueError):
                            sm = def_sm
                        try:
                            sc = float(sc)
                        except (TypeError, ValueError):
                            sc = def_sc
                        normalized.append({
                            'lora_name': name,
                            'strength_model': sm,
                            'strength_clip': sc,
                        })
                elif isinstance(item, str):
                    name = item.strip()
                    if name and name.lower() != 'none':
                        normalized.append({
                            'lora_name': name,
                            'strength_model': def_sm,
                            'strength_clip': def_sc,
                        })
        if normalized:
            return normalized

        names = self._parse_lora_names_to_list(cfg.get('lora_names'))
        if names:
            return [{
                'lora_name': n,
                'strength_model': def_sm,
                'strength_clip': def_sc,
            } for n in names]

        single = cfg.get('lora_name')
        if isinstance(single, str):
            s = single.strip()
            if s and s.lower() != 'none':
                return [{
                    'lora_name': s,
                    'strength_model': def_sm,
                    'strength_clip': def_sc,
                }]
        return []

    def _load_custom_albums(self, user_hash):
        albums = self.core_api.data_manager.load_user_data(
            self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, default_value=[], obfuscated=True
        )
        return albums if isinstance(albums, list) else []

    def _save_custom_albums(self, user_hash, albums):
        self.core_api.data_manager.save_user_data(
            albums, self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, obfuscated=True
        )

    def _delete_custom_album_entry(self, user_hash, character_hash):
        current_albums = self._load_custom_albums(user_hash)
        if not current_albums:
            return False
        filtered = [entry for entry in current_albums if entry.get("hash") != character_hash]
        if len(filtered) != len(current_albums):
            self._save_custom_albums(user_hash, filtered)
            return True
        return False

    def _delete_character_config_entry(self, character_hash):
        configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
        if character_hash in configs:
            del configs[character_hash]
            self.core_api.save_data(configs, self.ALBUM_CHAR_CONFIG_FILENAME)
            return True
        return False

    def _delete_character_images(self, user_hash, character_hash):
        """Remove all images and files associated with a character album."""
        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME,
            default_value={},
            obfuscated=True
        )
        user_images = images_data.get(user_hash, {})
        character_images = user_images.get(character_hash, [])
        if not character_images:
            return 0

        image_ids = [img.get("id") for img in character_images if img.get("id")]
        deleted_count = 0
        for image_id in image_ids:
            try:
                if self.core_api.image_service.delete_image_by_id(user_hash, image_id):
                    deleted_count += 1
            except Exception as err:  # noqa: BLE001
                print(f"[AlbumPlugin] Failed to delete image '{image_id}': {err}")
        return deleted_count

    def _delete_character_album(self, user_hash, character_hash):
        if not character_hash:
            return {"images_removed": 0, "config_removed": False, "custom_removed": False}
        images_removed = self._delete_character_images(user_hash, character_hash)
        config_removed = self._delete_character_config_entry(character_hash)
        custom_removed = self._delete_custom_album_entry(user_hash, character_hash)
        return {
            "images_removed": images_removed,
            "config_removed": config_removed,
            "custom_removed": custom_removed,
        }


    def _find_user_image(self, user_hash, image_id):
        """Locate an image metadata entry by id for the given user."""
        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME,
            default_value={},
            obfuscated=True
        )
        user_images = images_data.get(user_hash, {})
        for character_hash, items in user_images.items():
            for entry in items:
                if entry.get("id") == image_id:
                    return character_hash, entry
        return None, None

    def _safe_int(self, value, fallback):
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    def _safe_float(self, value, fallback):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    def _normalize_lora_tags(self, tags):
        if isinstance(tags, list):
            return [str(tag).strip() for tag in tags if str(tag).strip()]
        if tags is None:
            return []
        text = str(tags).strip()
        return [text] if text else []

    def _update_custom_album_entry(self, user_hash, character_hash, display_name):
        """Thêm hoặc xóa entry album tùy thuộc vào việc tên có hợp lệ không."""
        current_albums = self._load_custom_albums(user_hash)
        trimmed_name = (display_name or "").strip()

        # Loại bỏ mọi entry trùng hash trước khi thêm lại (nếu cần)
        filtered = [entry for entry in current_albums if entry.get("hash") != character_hash]

        if trimmed_name:
            timestamp = int(time.time())
            existing = next((entry for entry in current_albums if entry.get("hash") == character_hash), None)
            if existing:
                existing["name"] = trimmed_name
                existing["updated_at"] = timestamp
                filtered.append(existing)
            else:
                filtered.append({
                    "hash": character_hash,
                    "name": trimmed_name,
                    "created_at": timestamp
                })

        if filtered != current_albums:
            self._save_custom_albums(user_hash, filtered)

    def _build_album_list_response(self, user_hash):
        """Kết hợp dữ liệu ảnh và cấu hình để trả về danh sách album đầy đủ."""
        custom_albums = self._load_custom_albums(user_hash)
        custom_map = {entry.get("hash"): entry for entry in custom_albums if entry.get("name")}

        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME, default_value={}, obfuscated=True
        )
        user_images_by_char = images_data.get(user_hash, {})
        char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)

        album_items = []

        for char_hash, images in user_images_by_char.items():
            if not images:
                continue

            # Ảnh đầu tiên (theo thứ tự lưu) sẽ được dùng làm cover
            first_image = images[0]
            cover_url = first_image.get("pv_url") or first_image.get("url")
            image_count = len(images)

            # Xác định tên hiển thị
            character_info = self.core_api.get_character_by_hash(char_hash)
            if character_info:
                display_name = character_info.get("name", char_hash)
                is_custom = False
            else:
                config_entry = char_configs.get(char_hash, {})
                display_name = str(config_entry.get("character", "")).strip()
                if not display_name:
                    custom_entry = custom_map.get(char_hash)
                    if custom_entry:
                        display_name = custom_entry.get("name", "").strip()
                    if not display_name:
                        gen_config = first_image.get("generationConfig", {}) or {}
                        display_name = str(gen_config.get("character", "")).strip()
                if not display_name:
                    display_name = char_hash
                is_custom = True

            album_items.append({
                "hash": char_hash,
                "name": display_name,
                "cover_url": cover_url,
                "image_count": image_count,
                "is_custom": is_custom
            })

        existing_hashes = {item["hash"] for item in album_items}

        # Thêm các custom album chưa có ảnh nhưng đã lưu cấu hình
        for entry in custom_albums:
            char_hash = entry.get("hash")
            display_name = (entry.get("name") or "").strip()
            if not char_hash or not display_name or char_hash in existing_hashes:
                continue
            album_items.append({
                "hash": char_hash,
                "name": display_name,
                "cover_url": None,
                "image_count": 0,
                "is_custom": True
            })

        album_items.sort(key=lambda item: item["name"].lower())
        return album_items

    def register_routes(self):
        @self.blueprint.route('/characters_with_albums', methods=['GET'])
        def get_album_characters():
            """
            Yuuka: API này giờ chỉ trả về danh sách các character hash có ít nhất 1 ảnh.
            """
            user_hash = self.core_api.verify_token_and_get_user_hash()
            all_user_images = self.core_api.read_data("img_data.json", obfuscated=True)
            user_albums = all_user_images.get(user_hash, {})
            # Trả về danh sách các key (character_hash) nếu chúng có chứa ảnh
            return jsonify([char_hash for char_hash, images in user_albums.items() if images])

        @self.blueprint.route('/albums', methods=['GET'])
        def list_albums():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            albums = self._build_album_list_response(user_hash)
            return jsonify(albums)

        @self.blueprint.route('/comfyui/info', methods=['GET'])
        def comfyui_info():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            character_hash = request.args.get('character_hash')
            server_address = request.args.get('server_address')
            
            global_comfy_config = self.core_api.read_data(self.COMFYUI_CONFIG_FILENAME)
            char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            char_specific_config = char_configs.get(character_hash, {})
            
            latest_image_config = {}
            if character_hash:
                # Yuuka: Lấy ảnh từ service lõi
                images = self.core_api.image_service.get_images_by_character(user_hash, character_hash)
                if images:
                    latest_image_config = images[0]['generationConfig'] # Dữ liệu đã được sắp xếp
            
            final_config = { 
                **self.DEFAULT_CONFIG, 
                **self._sanitize_config(latest_image_config), 
                **self._sanitize_config(global_comfy_config), 
                **self._sanitize_config(char_specific_config) 
            }

            if not final_config.get('hires_base_width'):
                final_config['hires_base_width'] = final_config.get('width', 0)
            if not final_config.get('hires_base_height'):
                final_config['hires_base_height'] = final_config.get('height', 0)
            if final_config.get('hires_enabled'):
                try:
                    base_w = int(final_config.get('hires_base_width') or 0)
                    base_h = int(final_config.get('hires_base_height') or 0)
                except (TypeError, ValueError):
                    base_w = base_h = 0
                if not base_w or not base_h:
                    try:
                        base_w = max(1, int(int(final_config.get('width', 0)) / 2))
                        base_h = max(1, int(int(final_config.get('height', 0)) / 2))
                    except (TypeError, ValueError):
                        base_w, base_h = 0, 0
                final_config['hires_base_width'] = base_w
                final_config['hires_base_height'] = base_h

            target_address = (server_address or final_config.get('server_address', '127.0.0.1:8888')).strip()

            # Yuuka: comfyui fetch optimization v1.0
            if request.args.get('no_choices', 'false').lower() == 'true':
                # Provide a normalized LoRA chain view to help multi-select UIs
                norm_chain = self._normalize_lora_chain(final_config)
                lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
                return jsonify({
                    "last_config": final_config,
                    "normalized_lora_chain": norm_chain,
                    "lora_names": lora_names_simple,
                })

            try:
                all_choices = self.core_api.comfy_api_client.get_full_object_info(target_address)

                base_size_options = [
                    {"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"},
                    {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"},
                    {"name": "IL 1344x768", "value": "1344x768"},
                    {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}
                ]
                size_variants = []
                for option in base_size_options:
                    raw_value = option.get("value", "")
                    try:
                        base_width, base_height = map(int, raw_value.split("x"))
                    except (ValueError, AttributeError):
                        continue

                    base_entry = {
                        "name": option.get("name", f"{base_width}x{base_height}"),
                        "value": f"{base_width}x{base_height}",
                        "dataAttrs": {
                            "mode": "standard",
                            "baseWidth": str(base_width),
                            "baseHeight": str(base_height)
                        }
                    }
                    size_variants.append(base_entry)

                    hires_width = base_width * 2
                    hires_height = base_height * 2
                    hires_entry = {
                        "name": f"{option.get('name', f'{base_width}x{base_height}')} x2 ({hires_width}x{hires_height})",
                        "value": f"{hires_width}x{hires_height}",
                        "dataAttrs": {
                            "mode": "hires",
                            "baseWidth": str(base_width),
                            "baseHeight": str(base_height)
                        }
                    }
                    size_variants.append(hires_entry)

                all_choices["sizes"] = size_variants
                all_choices["checkpoints"] = [{"name": c, "value": c} for c in all_choices.get("checkpoints", [])]
                all_choices["samplers"] = [{"name": s, "value": s} for s in all_choices.get("samplers", [])]
                all_choices["schedulers"] = [{"name": s, "value": s} for s in all_choices.get("schedulers", [])]
                all_choices["hires_upscale_models"] = [{"name": m, "value": m} for m in all_choices.get("upscale_models", [])]
                hires_methods = all_choices.get("upscale_methods") or ["bilinear", "nearest", "nearest-exact", "bicubic", "lanczos", "area"]
                all_choices["hires_upscale_methods"] = [{"name": method, "value": method} for method in hires_methods]
                lora_names = all_choices.get("loras", [])
                lora_options = [{"name": "None", "value": "None"}]
                seen_loras = {"None"}
                for name in lora_names:
                    if not name or name in seen_loras:
                        continue
                    lora_options.append({"name": name, "value": name})
                    seen_loras.add(name)
                all_choices["loras"] = lora_options
                # Multi-LoRA capability hints for frontend
                all_choices["multi_lora_supported"] = True
                all_choices["lora_defaults"] = {
                    "lora_strength_model": self.DEFAULT_CONFIG.get("lora_strength_model", 0.9),
                    "lora_strength_clip": self.DEFAULT_CONFIG.get("lora_strength_clip", 1.0),
                }
                norm_chain = self._normalize_lora_chain(final_config)
                lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
                return jsonify({
                    "global_choices": all_choices,
                    "last_config": final_config,
                    "normalized_lora_chain": norm_chain,
                    "lora_names": lora_names_simple,
                })
            except Exception as e:
                abort(500, description=f"Failed to get info from ComfyUI: {e}")

        @self.blueprint.route('/images/<image_id>/hires', methods=['POST'])
        def start_image_hires(image_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            try:
                character_hash, image_entry = self._find_user_image(user_hash, image_id)
                if not image_entry:
                    abort(404, description="Image not found.")
                if not character_hash:
                    abort(400, description="Unable to resolve character for image.")

                generation_config = image_entry.get("generationConfig") or {}
                if not isinstance(generation_config, dict):
                    generation_config = {}
                generation_config = deepcopy(generation_config)

                hires_flag = generation_config.get("hires_enabled", False)
                if isinstance(hires_flag, str):
                    hires_flag = hires_flag.strip().lower() in ("1", "true", "yes")
                if hires_flag:
                    abort(400, description="Image is already a hires result.")

                original_width = self._safe_int(generation_config.get("width"), self.DEFAULT_CONFIG["width"])
                original_height = self._safe_int(generation_config.get("height"), self.DEFAULT_CONFIG["height"])
                if original_width <= 0 or original_height <= 0:
                    abort(400, description="Invalid base dimensions for source image.")

                server_address = generation_config.get("server_address") or self.DEFAULT_CONFIG["server_address"]
                image_url = image_entry.get("url", "")
                filename = os.path.basename(image_url) if image_url else ""
                if not filename:
                    abort(400, description="Missing source image file reference.")

                image_bytes, _ = self.core_api.get_user_image_data('imgs', filename)
                if not image_bytes:
                    abort(404, description="Source image file could not be loaded.")

                upload_basename = f"album_hires_{image_id.replace('-', '')}.png"
                try:
                    stored_name = self.core_api.comfy_api_client.upload_image_bytes(
                        image_bytes,
                        upload_basename,
                        server_address
                    )
                except ConnectionError as err:
                    abort(503, description=str(err))

                target_width = max(original_width * 2, original_width)
                target_height = max(original_height * 2, original_height)

                generation_config["_workflow_type"] = "hires_input_image"
                generation_config["_input_image_name"] = stored_name
                generation_config["_input_image_width"] = original_width
                generation_config["_input_image_height"] = original_height
                generation_config["hires_base_width"] = original_width
                generation_config["hires_base_height"] = original_height
                generation_config["hires_enabled"] = False
                generation_config["width"] = target_width
                generation_config["height"] = target_height
                generation_config["server_address"] = server_address
                generation_config["lora_prompt_tags"] = self._normalize_lora_tags(
                    generation_config.get("lora_prompt_tags")
                )
                generation_config["seed"] = self._safe_int(generation_config.get("seed"), 0)

                context = {"origin": "album.hires", "source_image_id": image_id}
                task_id, message = self.core_api.generation_service.start_generation_task(
                    user_hash,
                    character_hash,
                    generation_config,
                    context
                )
                if task_id:
                    return jsonify({"status": "started", "task_id": task_id, "message": message})
                return jsonify({"error": message}), 429

            except ConnectionError as err:
                abort(503, description=str(err))
            except Exception as e:
                abort(500, description=f"Failed to start hires generation: {e}")

        @self.blueprint.route('/comfyui/config', methods=['POST'])
        def save_comfyui_config():
            self.core_api.verify_token_and_get_user_hash()
            config_data = request.json
            if not config_data: abort(400, "Missing config data.")
            self.core_api.save_data(self._sanitize_config(config_data), self.COMFYUI_CONFIG_FILENAME)
            return jsonify({"status": "success"})

        @self.blueprint.route('/<character_hash>/config', methods=['POST'])
        def save_character_config(character_hash):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            config_data = request.json
            if not config_data:
                abort(400, "Missing config data.")

            all_char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            sanitized_config = self._sanitize_config(config_data)
            all_char_configs[character_hash] = sanitized_config
            self.core_api.save_data(all_char_configs, self.ALBUM_CHAR_CONFIG_FILENAME)

            # Nếu đây là một nhân vật tùy chỉnh (không có trong database gốc) thì cập nhật danh sách album tùy chỉnh
            if not self.core_api.get_character_by_hash(character_hash):
                self._update_custom_album_entry(
                    user_hash,
                    character_hash,
                    sanitized_config.get("character", "")
                )

            return jsonify({"status": "success", "message": "Character-specific config saved."})
        

        @self.blueprint.route('/<character_hash>', methods=['DELETE'])
        def delete_character_album(character_hash):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            if not character_hash:
                abort(400, "Missing character hash.")

            result = self._delete_character_album(user_hash, character_hash)
            status = "success"
            if (
                not result["images_removed"]
                and not result["config_removed"]
                and not result["custom_removed"]
            ):
                status = "not_found"
            return jsonify({
                "status": status,
                "images_removed": result["images_removed"],
                "config_removed": result["config_removed"],
                "custom_entry_removed": result["custom_removed"],
            })


        # --- Yuuka: TOÀN BỘ CÁC ROUTE VỀ GENERATE VÀ QUẢN LÝ ẢNH ĐÃ ĐƯỢC CHUYỂN SANG LÕI ---

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/album"

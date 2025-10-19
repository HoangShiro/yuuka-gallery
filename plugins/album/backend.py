# --- MODIFIED FILE: plugins/album/backend.py ---
import time
import threading
import websocket
import json

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
            "batch_size": 1, "height": 1216, "width": 832, "cfg": 2.5, "sampler_name": "euler_ancestral", 
            "scheduler": "karras", "steps": 25, "lora_name": "None", "lora_strength_model": 1.0, 
            "lora_strength_clip": 1.0,
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

    def _load_custom_albums(self, user_hash):
        albums = self.core_api.data_manager.load_user_data(
            self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, default_value=[], obfuscated=True
        )
        return albums if isinstance(albums, list) else []

    def _save_custom_albums(self, user_hash, albums):
        self.core_api.data_manager.save_user_data(
            albums, self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, obfuscated=True
        )

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
            target_address = (server_address or final_config.get('server_address', '127.0.0.1:8888')).strip()

            # Yuuka: comfyui fetch optimization v1.0
            if request.args.get('no_choices', 'false').lower() == 'true':
                return jsonify({"last_config": final_config})

            try:
                all_choices = self.core_api.comfy_api_client.get_full_object_info(target_address)
                all_choices['sizes'] = [{"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"}, {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"}, {"name": "IL 1344x768", "value": "1344x768"}, {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}]
                all_choices['checkpoints'] = [{"name": c, "value": c} for c in all_choices.get('checkpoints', [])]
                all_choices['samplers'] = [{"name": s, "value": s} for s in all_choices.get('samplers', [])]
                all_choices['schedulers'] = [{"name": s, "value": s} for s in all_choices.get('schedulers', [])]
                lora_names = all_choices.get('loras', [])
                lora_options = [{"name": "None", "value": "None"}]
                seen_loras = {"None"}
                for name in lora_names:
                    if not name or name in seen_loras:
                        continue
                    lora_options.append({"name": name, "value": name})
                    seen_loras.add(name)
                all_choices['loras'] = lora_options
                return jsonify({"global_choices": all_choices, "last_config": final_config})
            except Exception as e:
                abort(500, description=f"Failed to get info from ComfyUI: {e}")

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
        
        # --- Yuuka: TOÀN BỘ CÁC ROUTE VỀ GENERATE VÀ QUẢN LÝ ẢNH ĐÃ ĐƯỢC CHUYỂN SANG LÕI ---

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/album"

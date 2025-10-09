# --- MODIFIED FILE: plugins/album/backend.py ---
import uuid
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

            try:
                all_choices = self.core_api.comfy_api_client.get_full_object_info(target_address)
                all_choices['sizes'] = [{"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"}, {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"}, {"name": "IL 1344x768", "value": "1344x768"}, {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}]
                all_choices['checkpoints'] = [{"name": c, "value": c} for c in all_choices.get('checkpoints', [])]
                all_choices['samplers'] = [{"name": s, "value": s} for s in all_choices.get('samplers', [])]
                all_choices['schedulers'] = [{"name": s, "value": s} for s in all_choices.get('schedulers', [])]
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
            self.core_api.verify_token_and_get_user_hash()
            config_data = request.json
            if not config_data: abort(400, "Missing config data.")
            all_char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            all_char_configs[character_hash] = self._sanitize_config(config_data)
            self.core_api.save_data(all_char_configs, self.ALBUM_CHAR_CONFIG_FILENAME)
            return jsonify({"status": "success", "message": "Character-specific config saved."})
        
        # --- Yuuka: TOÀN BỘ CÁC ROUTE VỀ GENERATE VÀ QUẢN LÝ ẢNH ĐÃ ĐƯỢC CHUYỂN SANG LÕI ---

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/album"
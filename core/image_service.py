# --- NEW FILE: core/image_service.py ---
import os
import uuid
import time
import base64
import io
import random
from PIL import Image
from copy import deepcopy

class ImageService:
    """Yuuka: Service mới để quản lý tập trung dữ liệu ảnh."""
    def __init__(self, core_api):
        self.core_api = core_api
        self.data_manager = core_api.data_manager
        self.IMAGE_DATA_FILENAME = "img_data.json"
        self.PREVIEW_MAX_DIMENSION = 350 # Yuuka: new image paths v1.0

    def _sanitize_config(self, config_data):
        if not isinstance(config_data, dict):
            return config_data
        sanitized = {}
        for key, value in config_data.items():
            if isinstance(key, str) and key.startswith('_'):
                continue
            sanitized[key] = value.strip() if isinstance(value, str) else value
        return sanitized

    def save_image_metadata(self, user_hash, character_hash, image_base64, generation_config, creation_time=None, alpha: bool = False):
        """Lưu metadata ảnh, tự tạo preview và trả về object metadata mới."""
        all_images = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        user_images = all_images.setdefault(user_hash, {})
        char_images = user_images.setdefault(character_hash, [])

        def _to_bool(value):
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.strip().lower() in ("1", "true", "yes", "on")
            if isinstance(value, (int, float)):
                return value != 0
            return False
        
        try:
            # Yuuka: new image paths v1.0 - Chuyển logic lưu file vào đây
            image_data = base64.b64decode(image_base64)
            filename = f"{uuid.uuid4()}.png"

            # 1. Lưu ảnh gốc
            obfuscated_main_data = self.data_manager.obfuscate_binary(image_data)
            main_filepath = os.path.join('user_images', 'imgs', filename)
            self.data_manager.save_binary(obfuscated_main_data, main_filepath)

            # 2. Tạo và lưu ảnh preview
            img = Image.open(io.BytesIO(image_data))
            img.thumbnail((self.PREVIEW_MAX_DIMENSION, self.PREVIEW_MAX_DIMENSION))
            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            preview_data = buffer.getvalue()
            obfuscated_preview_data = self.data_manager.obfuscate_binary(preview_data)
            preview_filepath = os.path.join('user_images', 'pv_imgs', filename)
            self.data_manager.save_binary(obfuscated_preview_data, preview_filepath)

            config_to_save = generation_config
            if isinstance(generation_config, dict):
                config_to_save = deepcopy(generation_config)
                workflow_template = config_to_save.get("_workflow_template")
                if workflow_template is not None:
                    workflow_template = str(workflow_template).strip()
                # Detect LoRA usage (single or multi) for correct workflow_type classification
                raw_lora_name = config_to_save.get("lora_name")
                has_single_lora = isinstance(raw_lora_name, str) and raw_lora_name.strip() and raw_lora_name.strip().lower() != "none"

                def _has_multi_lora_from_chain(chain_val):
                    if isinstance(chain_val, list) and len(chain_val) > 0:
                        for item in chain_val:
                            if isinstance(item, dict):
                                name = item.get("name") or item.get("lora_name")
                                if isinstance(name, str) and name.strip() and name.strip().lower() != "none":
                                    return True
                            elif isinstance(item, str):
                                if item.strip() and item.strip().lower() != "none":
                                    return True
                    return False

                def _has_multi_lora_from_names(names_val):
                    if isinstance(names_val, list):
                        return any(isinstance(s, str) and s.strip() and s.strip().lower() != "none" for s in names_val)
                    if isinstance(names_val, str):
                        parts = [p.strip() for p in names_val.split(',') if p.strip()]
                        return any(p.lower() != "none" for p in parts)
                    return False

                has_lora = (
                    has_single_lora
                    or _has_multi_lora_from_chain(config_to_save.get("lora_chain"))
                    or _has_multi_lora_from_names(config_to_save.get("lora_names"))
                )

                if config_to_save.get("_workflow_type") == "hires_input_image":
                    config_to_save["hires_enabled"] = True

                template_lower = (workflow_template or "").lower()
                is_hires = _to_bool(config_to_save.get("hires_enabled"))
                if not is_hires and "hiresfix" in template_lower:
                    config_to_save["hires_enabled"] = True
                    is_hires = True

                workflow_type_value = config_to_save.get("workflow_type")
                workflow_type = workflow_type_value.strip().lower() if isinstance(workflow_type_value, str) else ""

                if not workflow_type:
                    if template_lower:
                        if "hiresfix" in template_lower and "input_image" in template_lower:
                            workflow_type = "hires_input_image_lora" if ("lora" in template_lower or has_lora) else "hires_input_image"
                        elif "hiresfix" in template_lower:
                            workflow_type = "hires_lora" if ("lora" in template_lower or has_lora) else "hires"
                        elif "lora" in template_lower:
                            workflow_type = "sdxl_lora"
                        else:
                            workflow_type = "standard"
                    else:
                        if is_hires:
                            workflow_type = "hires_lora" if has_lora else "hires"
                        elif has_lora:
                            workflow_type = "sdxl_lora"
                        else:
                            workflow_type = "standard"

                if workflow_template:
                    config_to_save["workflow_template"] = workflow_template
                if workflow_type:
                    config_to_save["workflow_type"] = workflow_type

            sanitized_config = self._sanitize_config(config_to_save)

            new_metadata = {
                "id": str(uuid.uuid4()),
                "url": f"/user_image/imgs/{filename}",
                "pv_url": f"/user_image/pv_imgs/{filename}", # Yuuka: new image paths v1.0
                "generationConfig": sanitized_config,
                "createdAt": int(time.time()),
                "character_hash": character_hash,
                "Alpha": _to_bool(alpha),
            }
            if creation_time is not None:
                new_metadata["creationTime"] = round(creation_time, 2)
                
            char_images.append(new_metadata)
            self.data_manager.save_json(all_images, self.IMAGE_DATA_FILENAME, obfuscated=True)
            return new_metadata
        except Exception as e:
            print(f"💥 [ImageService] Failed to save image metadata: {e}")
            return None

    def save_video_metadata(self, user_hash, character_hash, video_base64, generation_config, creation_time=None):
        """Lưu metadata video (webm), tạo preview thumbnail từ frame giả và trả về object metadata mới."""
        all_images = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        user_images = all_images.setdefault(user_hash, {})
        char_images = user_images.setdefault(character_hash, [])

        try:
            video_data = base64.b64decode(video_base64)
            filename = f"{uuid.uuid4()}.webm"

            # 1. Lưu video gốc
            obfuscated_video_data = self.data_manager.obfuscate_binary(video_data)
            video_filepath = os.path.join('user_images', 'imgs', filename)
            self.data_manager.save_binary(obfuscated_video_data, video_filepath)

            # 2. Tạo preview thumbnail (placeholder PNG vì video không dễ thumbnail)
            # Dùng PIL tạo ảnh placeholder xám với text "VIDEO"
            preview_filename = f"{uuid.uuid4()}.png"
            try:
                from PIL import ImageDraw, ImageFont
                img = Image.new('RGB', (self.PREVIEW_MAX_DIMENSION, self.PREVIEW_MAX_DIMENSION), (40, 40, 50))
                draw = ImageDraw.Draw(img)
                # Vẽ icon play-like triangle
                cx, cy = self.PREVIEW_MAX_DIMENSION // 2, self.PREVIEW_MAX_DIMENSION // 2
                size = 40
                triangle = [(cx - size//2, cy - size), (cx - size//2, cy + size), (cx + size, cy)]
                draw.polygon(triangle, fill=(100, 200, 255))
                draw.text((cx - 30, cy + size + 10), "VIDEO", fill=(200, 200, 200))
            except Exception:
                img = Image.new('RGB', (self.PREVIEW_MAX_DIMENSION, self.PREVIEW_MAX_DIMENSION), (40, 40, 50))

            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            preview_data = buffer.getvalue()
            obfuscated_preview_data = self.data_manager.obfuscate_binary(preview_data)
            preview_filepath = os.path.join('user_images', 'pv_imgs', preview_filename)
            self.data_manager.save_binary(obfuscated_preview_data, preview_filepath)

            config_to_save = generation_config
            if isinstance(generation_config, dict):
                config_to_save = deepcopy(generation_config)
                workflow_template = config_to_save.get("_workflow_template")
                if workflow_template is not None:
                    config_to_save["workflow_template"] = str(workflow_template).strip()
                config_to_save["workflow_type"] = "dasiwa_wan2_i2v"

            sanitized_config = self._sanitize_config(config_to_save)

            new_metadata = {
                "id": str(uuid.uuid4()),
                "url": f"/user_image/imgs/{filename}",
                "pv_url": f"/user_image/pv_imgs/{preview_filename}",
                "generationConfig": sanitized_config,
                "createdAt": int(time.time()),
                "character_hash": character_hash,
                "Alpha": False,
                "is_video": True,
                "video_format": "video/webm",
            }
            if creation_time is not None:
                new_metadata["creationTime"] = round(creation_time, 2)

            char_images.append(new_metadata)
            self.data_manager.save_json(all_images, self.IMAGE_DATA_FILENAME, obfuscated=True)
            return new_metadata
        except Exception as e:
            print(f"💥 [ImageService] Failed to save video metadata: {e}")
            return None

    def get_all_user_images(self, user_hash):
        """Lấy tất cả ảnh của một user, gộp lại và sắp xếp."""
        all_images_data = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        user_images_by_char = all_images_data.get(user_hash, {})
        
        data_was_modified = False
        for char_hash, images in user_images_by_char.items():
            for img in images:
                if 'creationTime' not in img:
                    img['creationTime'] = round(random.uniform(16, 22), 2)
                    data_was_modified = True
                # Yuuka: new image paths v1.0 - Thêm pv_url fallback cho ảnh cũ
                if 'pv_url' not in img:
                    img['pv_url'] = img['url']
                    data_was_modified = True
                # Yuuka: Alpha images v1.0 - Ảnh cũ không có key này mặc định False
                if 'Alpha' not in img:
                    img['Alpha'] = False
                    data_was_modified = True
        
        if data_was_modified:
            self.data_manager.save_json(all_images_data, self.IMAGE_DATA_FILENAME, obfuscated=True)

        flat_list = [img for images in user_images_by_char.values() for img in images]
        return sorted(flat_list, key=lambda x: x.get('createdAt', 0), reverse=True)
        
    def get_images_by_character(self, user_hash, character_hash):
        """Lấy ảnh của một nhân vật cụ thể."""
        all_images_data = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        user_images_by_char = all_images_data.get(user_hash, {})
        
        data_was_modified = False
        if character_hash in user_images_by_char:
            for img in user_images_by_char[character_hash]:
                if 'creationTime' not in img:
                    img['creationTime'] = round(random.uniform(16, 22), 2)
                    data_was_modified = True
                # Yuuka: new image paths v1.0 - Thêm pv_url fallback cho ảnh cũ
                if 'pv_url' not in img:
                    img['pv_url'] = img['url']
                    data_was_modified = True
                # Yuuka: Alpha images v1.0 - Ảnh cũ không có key này mặc định False
                if 'Alpha' not in img:
                    img['Alpha'] = False
                    data_was_modified = True

        if data_was_modified:
             self.data_manager.save_json(all_images_data, self.IMAGE_DATA_FILENAME, obfuscated=True)

        char_images = user_images_by_char.get(character_hash, [])
        return sorted(char_images, key=lambda x: x.get('createdAt', 0), reverse=True)

    def delete_image_by_id(self, user_hash, image_id):
        """Xóa metadata và file ảnh (gốc + preview) tương ứng."""
        all_images = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        if user_hash not in all_images: return False
        
        found_and_deleted = False
        image_to_delete_url = None
        preview_to_delete_url = None # Yuuka: new image paths v1.0

        for char_hash, images in all_images[user_hash].items():
            image_to_delete_idx = -1
            for i, img in enumerate(images):
                if img.get('id') == image_id:
                    image_to_delete_idx = i
                    image_to_delete_url = img.get('url')
                    preview_to_delete_url = img.get('pv_url') # Yuuka: new image paths v1.0
                    break
            
            if image_to_delete_idx != -1:
                del all_images[user_hash][char_hash][image_to_delete_idx]
                if not all_images[user_hash][char_hash]:
                    del all_images[user_hash][char_hash]
                
                found_and_deleted = True
                break
        
        if found_and_deleted:
            self.data_manager.save_json(all_images, self.IMAGE_DATA_FILENAME, obfuscated=True)
            # Yuuka: new image paths v1.0 - Xóa cả ảnh gốc và preview
            if image_to_delete_url:
                try:
                    filename = os.path.basename(image_to_delete_url)
                    filepath = self.data_manager.get_path(os.path.join('user_images', 'imgs', filename))
                    if os.path.exists(filepath): os.remove(filepath)
                except Exception as e:
                    print(f"⚠️ [ImageService] Could not delete main image file for {image_id}: {e}")
            if preview_to_delete_url and preview_to_delete_url != image_to_delete_url:
                try:
                    filename = os.path.basename(preview_to_delete_url)
                    filepath = self.data_manager.get_path(os.path.join('user_images', 'pv_imgs', filename))
                    if os.path.exists(filepath): os.remove(filepath)
                except Exception as e:
                    print(f"⚠️ [ImageService] Could not delete preview image file for {image_id}: {e}")
                    
        return found_and_deleted

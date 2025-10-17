# --- NEW FILE: core/image_service.py ---
import os
import uuid
import time
import base64
import io
import random
from PIL import Image

class ImageService:
    """Yuuka: Service mới để quản lý tập trung dữ liệu ảnh."""
    def __init__(self, core_api):
        self.core_api = core_api
        self.data_manager = core_api.data_manager
        self.IMAGE_DATA_FILENAME = "img_data.json"
        self.PREVIEW_MAX_DIMENSION = 350 # Yuuka: new image paths v1.0

    def _sanitize_config(self, config_data):
        if not isinstance(config_data, dict): return config_data
        return {k: v.strip() if isinstance(v, str) else v for k, v in config_data.items()}

    def save_image_metadata(self, user_hash, character_hash, image_base64, generation_config, creation_time=None):
        """Lưu metadata ảnh, tự tạo preview và trả về object metadata mới."""
        all_images = self.data_manager.read_json(self.IMAGE_DATA_FILENAME, obfuscated=True)
        user_images = all_images.setdefault(user_hash, {})
        char_images = user_images.setdefault(character_hash, [])
        
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

            new_metadata = {
                "id": str(uuid.uuid4()),
                "url": f"/user_image/imgs/{filename}",
                "pv_url": f"/user_image/pv_imgs/{filename}", # Yuuka: new image paths v1.0
                "generationConfig": self._sanitize_config(generation_config),
                "createdAt": int(time.time()),
                "character_hash": character_hash
            }
            if creation_time is not None:
                new_metadata["creationTime"] = round(creation_time, 2)
                
            char_images.append(new_metadata)
            self.data_manager.save_json(all_images, self.IMAGE_DATA_FILENAME, obfuscated=True)
            return new_metadata
        except Exception as e:
            print(f"💥 [ImageService] Failed to save image metadata: {e}")
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
import os
import uuid
import time
import copy
import shutil
from urllib.parse import urlparse

class HistoryService:
    def __init__(self, core_api):
        self.core_api = core_api
        self.llm_service = None

    def ensure_live_gen_albums(self, user_hash):
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

    def get_history_images(self, user_hash):
        self.ensure_live_gen_albums(user_hash)
        return self.core_api.image_service.get_images_by_character(user_hash, "live-gen-history")

    def get_favorites_images(self, user_hash):
        self.ensure_live_gen_albums(user_hash)
        return self.core_api.image_service.get_images_by_character(user_hash, "live-gen-favorite")

    def add_favorite(self, user_hash, image_url):
        all_images = self.core_api.image_service.data_manager.read_json(
            self.core_api.image_service.IMAGE_DATA_FILENAME, obfuscated=True
        )
        user_images = all_images.setdefault(user_hash, {})
        
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
            return {"status": "error", "message": "Không tìm thấy ảnh", "code": 404}
            
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
            return {"status": "exists", "message": "Ảnh đã nằm trong danh sách Yêu thích."}
            
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
        self.ensure_live_gen_albums(user_hash)
        return {"status": "success", "message": "Đã thêm vào album Yêu thích!"}

    def clean_duplicate_snapshot(self, user_hash, snapshot_id, is_hires):
        """Dọn dẹp snapshot cũ có cùng ID và cùng trạng thái hires."""
        try:
            history_images = self.core_api.image_service.get_images_by_character(user_hash, "live-gen-history")
            if history_images:
                for img in history_images:
                    cfg = img.get("generationConfig") or {}
                    if cfg.get("snapshot_id") == snapshot_id:
                        cached_hires = cfg.get("hires_enabled", False)
                        if isinstance(cached_hires, str):
                            cached_hires = cached_hires.strip().lower() in ("1", "true", "yes", "on")
                        else:
                            cached_hires = bool(cached_hires)
                            
                        if cached_hires == is_hires:
                            old_image_id = img.get("id")
                            if old_image_id:
                                print(f"[LiveGen History] Deleting old duplicate {old_image_id} with same hires state {is_hires}")
                                self.core_api.image_service.delete_image_by_id(user_hash, old_image_id)
        except Exception as e:
            print(f"⚠️ [LiveGen History] Failed to clean up duplicate snapshot: {e}")

    def save_generation_metadata(self, user_hash, raw_b64, config):
        """Lưu metadata và file ảnh tạo thành công."""
        self.core_api.image_service.save_image_metadata(
            user_hash,
            "live-gen-history",
            raw_b64,
            config,
            0.0 # creation duration
        )
        self.ensure_live_gen_albums(user_hash)

        # Kích hoạt tự động phân tích sở thích định kỳ nếu có cấu hình
        if self.llm_service:
            try:
                # Sẽ import ConfigService hoặc gọi qua core_api hoặc dùng tham chiếu trực tiếp
                if hasattr(self.llm_service, "config_service"):
                    cfg = self.llm_service.config_service.get_config()
                    interval = cfg.get("llm_pref_trigger_interval", 10)
                    if interval > 0:
                        history_images = self.get_history_images(user_hash) or []
                        if len(history_images) > 0 and len(history_images) % interval == 0:
                            self.llm_service.trigger_user_preferences_analysis(user_hash)
            except Exception as e:
                print(f"⚠️ [LiveGen History] Lỗi khi kiểm tra kích hoạt phân tích LLM: {e}")

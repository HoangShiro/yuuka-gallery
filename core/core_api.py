# --- MODIFIED FILE: core/core_api.py ---
import os
import json
import hashlib
import uuid
import time
import base64
import gzip
import requests
import io
import csv
from PIL import Image
from flask import request, jsonify

# Yuuka: Import các thư viện tích hợp và service
from integrations import comfy_api_client
from integrations.workflow_builder_service import WorkflowBuilderService
from .image_service import ImageService
from .generation_service import GenerationService
from .game_service import GameService # Yuuka: PvP game feature v1.0
from .task_service import BackgroundTaskService


class CoreAPI:
    """
    Lớp "hộp cát" (Sandbox) được truyền cho mỗi plugin.
    Nó cung cấp các hàm an toàn để plugin tương tác với lõi
    mà không cần truy cập trực tiếp vào các thành phần nội bộ.
    Đây là cầu nối duy nhất giữa Plugin và Lõi.
    """
    def __init__(self, data_manager):
        self.data_manager = data_manager
        # Yuuka: Cache dữ liệu nhân vật và thumbnail để tăng tốc độ
        self._all_characters_list = []
        self._all_characters_dict = {}
        self._thumbnails_data_dict = {}
        self._user_data = {}
        self._tag_predictions = [] # Yuuka: Thêm cache cho tags
        # Yuuka: auth rework v1.0 - Thêm cache cho whitelist và waitlist
        self._whitelist_users = []
        self._waitlist_users = []

        # Yuuka: Khởi tạo các dịch vụ tích hợp
        self.workflow_builder = WorkflowBuilderService()
        self.comfy_api_client = comfy_api_client
        # Yuuka: Hệ thống dịch vụ mới để các plugin giao tiếp
        self._services = {}
        # YUUKA: KHỞI TẠO CÁC SERVICE LÕI MỚI
        self.image_service = ImageService(self)
        self.generation_service = GenerationService(self)
        self.game_service = GameService(self) # Yuuka: PvP game feature v1.0
        self.task_service = BackgroundTaskService()
        
        # Yuuka: Thêm các hằng số URL từ phiên bản cũ
        self.CSV_CHARACTERS_URL = "https://raw.githubusercontent.com/mirabarukaso/character_select_stand_alone_app/refs/heads/main/data/wai_characters.csv"
        self.JSON_THUMBNAILS_URL = "https://huggingface.co/datasets/flagrantia/character_select_stand_alone_app/resolve/main/wai_character_thumbs.json"
        self.CACHE_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 ngày

    # --- 1. Dịch vụ Dữ liệu (Data Services) ---
    def read_data(self, filename, default_value={}, obfuscated=False):
        """Đọc file JSON từ thư mục dữ liệu một cách an toàn."""
        return self.data_manager.read_json(filename, default_value, obfuscated)

    def save_data(self, data, filename, obfuscated=False):
        """Lưu dữ liệu vào file JSON một cách an toàn."""
        return self.data_manager.save_json(data, filename, obfuscated)

    # Yuuka: new image paths v1.0 - Gỡ bỏ hàm này, logic đã được chuyển vào ImageService
    # def save_user_image(self, image_base64: str) -> str: ...

    # --- 2. Dịch vụ Xác thực & Người dùng (Auth & User Services) ---
    # Yuuka: auth rework v1.0 - Viết lại hoàn toàn logic xác thực
    def verify_token_and_get_user_hash(self, token_override=None): # Yuuka: PvP game feature v1.0
        """
        Xác thực token từ header, có logic đặc biệt cho localhost.
        Trả về user_hash nếu hợp lệ, nếu không sẽ raise Exception.
        Cho phép ghi đè token để dùng trong WebSocket.
        """
        token = token_override
        client_ip = '127.0.0.1' if token_override else request.remote_addr # Giả định token_override là từ local hoặc đã được tin tưởng
        
        if not token:
            auth_header = request.headers.get('Authorization')
            if not auth_header or not auth_header.startswith('Bearer '):
                raise Exception("Authorization header is missing or invalid.")
            token = auth_header.split(' ')[1]
        
        is_localhost = client_ip == '127.0.0.1'

        is_valid = False
        # Yuuka: Sửa lại logic một chút để localhost có thể dùng bất kỳ token nào trong whitelist
        # và remote user dùng bất kỳ token nào trong user_data.
        if token in self._whitelist_users:
            is_valid = True
        elif not is_localhost and token in self._user_data.get("users", []):
             is_valid = True

        if is_valid:
            return hashlib.sha256(token.encode('utf-8')).hexdigest()
        
        raise Exception("Invalid token.")

    # Yuuka: auth rework v1.0 - Logic tạo token mới
    def generate_token(self):
        """
        Tạo token mới. Lưu vào waitlist nếu từ localhost, nếu không lưu vào user_data.
        """
        new_token = str(uuid.uuid4())
        client_ip = request.remote_addr
        is_localhost = client_ip == '127.0.0.1'

        if is_localhost:
            # Lưu vào waitlist
            if len(self._waitlist_users) >= 100:
                raise Exception("Waitlist is full. Please contact administrator.")
            
            if new_token not in self._waitlist_users:
                self._waitlist_users.append(new_token)
                self.save_data(self._waitlist_users, "waitlist.json", obfuscated=True)
                print(f"[CoreAPI] New token for localhost added to waitlist.")

        else:
            # Lưu vào user_data như bình thường
            self._user_data.setdefault("users", []).append(new_token)
            self.save_data(self._user_data, "user_data.json", obfuscated=True)
            print(f"[CoreAPI] Generated new token for remote user.")
            
        return jsonify({"status": "created", "token": new_token})

    # Yuuka: auth rework v1.0 - Logic đăng nhập chỉ để xác thực token
    def login_with_token(self, token: str):
        """Xác thực một token có tồn tại hay không."""
        all_users = self._user_data.get("users", [])
        if token in all_users or token in self._whitelist_users:
            print(f"[CoreAPI] User with token logged in successfully.")
            return jsonify({"status": "success", "token": token})
        else:
            return jsonify({"error": "Invalid token"}), 401

    # Yuuka: auth rework v1.0 - Logout không cần làm gì ở server
    def logout(self):
        """Xử lý đăng xuất. Client sẽ tự xóa token."""
        return jsonify({"status": "success", "message": "Logged out successfully."})

    # Yuuka: auth rework v1.1 - Hàm để quản lý whitelist
    def add_token_to_whitelist(self, token_to_add: str):
        """Thêm một token vào whitelist và xóa khỏi waitlist nếu có."""
        if token_to_add not in self._whitelist_users:
            self._whitelist_users.append(token_to_add)
            self.save_data(self._whitelist_users, "whitelist.json", obfuscated=True)
            print(f"[CoreAPI] Token added to whitelist.")

            if token_to_add in self._waitlist_users:
                self._waitlist_users.remove(token_to_add)
                self.save_data(self._waitlist_users, "waitlist.json", obfuscated=True)
                print(f"[CoreAPI] Token removed from waitlist.")
            
            return True, f"Token đã được thêm vào whitelist."
        return False, "Token đã tồn tại trong whitelist."


    # --- 3. Dịch vụ Dữ liệu Nhân vật (Character Data Services) ---
    def get_all_characters_list(self):
        return self._all_characters_list

    def get_character_by_hash(self, char_hash: str):
        return self._all_characters_dict.get(char_hash)

    def get_tag_predictions(self):
        return self._tag_predictions

    def get_thumbnail_image_data(self, md5_hash: str):
        base64_gzipped_webp = self._thumbnails_data_dict.get(md5_hash)
        if not base64_gzipped_webp: return None, None
        try:
            return gzip.decompress(base64.b64decode(base64_gzipped_webp)), 'image/webp'
        except Exception: return None, None
    
    # Yuuka: new image paths v1.0 - Hàm này giờ nhận thêm thư mục con
    def get_user_image_data(self, subfolder: str, filename: str):
        filepath = os.path.join('user_images', subfolder, filename)
        obfuscated_data = self.data_manager.read_binary(filepath)
        if obfuscated_data:
            return self.data_manager.deobfuscate_binary(obfuscated_data), 'image/png'
        return None, None

    # --- 4. Tải Dữ liệu Lõi (Internal Core Data Loading) ---
    def _fetch_or_read_from_cache(self, data_name: str, remote_url: str, local_filename: str) -> str:
        local_path = self.data_manager.get_path(local_filename)
        should_download = False
        if os.path.exists(local_path):
            if (time.time() - os.path.getmtime(local_path)) > self.CACHE_TTL_SECONDS:
                print(f"[CoreAPI Cache] Cache for {data_name} is stale. Refreshing.")
                should_download = True
            else:
                print(f"[CoreAPI Cache] Loading {data_name} from fresh cache file: {local_path}")
        else:
            print(f"[CoreAPI Cache] No cache found for {data_name}. Downloading.")
            should_download = True
        
        if should_download:
            print(f"[CoreAPI] Fetching {data_name} from: {remote_url}")
            try:
                response = requests.get(remote_url, timeout=60)
                response.raise_for_status()
                with open(local_path, 'w', encoding='utf-8') as f: f.write(response.text)
                print(f"[CoreAPI] Successfully updated cache file: {local_path}")
            except requests.RequestException as e:
                print(f"⚠️ [CoreAPI] Failed to fetch {data_name}: {e}. Will use existing cache if available.")
        
        if os.path.exists(local_path):
            with open(local_path, 'r', encoding='utf-8') as f: return f.read()
        else:
            raise RuntimeError(f"CRITICAL: No local cache for {data_name} and download failed.")

    def _load_tags_data(self):
        tags_path = self.data_manager.get_path("tags.csv")
        if not os.path.exists(tags_path):
            print("[CoreAPI] No tags.csv found. Tag prediction will be disabled.")
            return
        try:
            with open(tags_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                next(reader, None) # YUUKA'S FIX: Bỏ qua dòng tiêu đề của file CSV
                # YUUKA'S FIX: Xử lý `row` như một list, không phải string
                tags_with_pop = [(row[0].strip(), int(row[1])) for row in reader if len(row) >= 2]
            # YUUKA'S FIX: Sắp xếp theo số lượng (phần tử thứ 2)
            tags_with_pop.sort(key=lambda x: x[1], reverse=True)
            self._tag_predictions = [tag for tag, pop in tags_with_pop]
            print(f"[CoreAPI] Loaded and sorted {len(self._tag_predictions)} tags for prediction.")
        except Exception as e:
            print(f"⚠️ [CoreAPI] Warning: Could not load or process tags.csv. Error: {e}")
    
    # Yuuka: data migration v1.0 - Logic di chuyển ảnh cũ
    def _migrate_old_images(self):
        print("[CoreAPI Migration] Checking for old image paths...")
        img_data_path = "img_data.json"
        all_images = self.read_data(img_data_path, obfuscated=True)
        if not all_images or not isinstance(all_images, dict):
            print("[CoreAPI Migration] No image data found. Skipping.")
            return

        data_was_migrated = False
        user_images_dir = self.data_manager.get_path('user_images')
        new_imgs_dir = os.path.join(user_images_dir, 'imgs')

        for user_hash, characters in all_images.items():
            for char_hash, images in characters.items():
                for img_meta in images:
                    if 'url' in img_meta and not img_meta['url'].startswith('/user_image/imgs/'):
                        filename = os.path.basename(img_meta['url'])
                        old_path = os.path.join(user_images_dir, filename)
                        new_path = os.path.join(new_imgs_dir, filename)

                        if os.path.exists(old_path):
                            try:
                                os.rename(old_path, new_path)
                                print(f"  - Migrated: {filename}")
                                img_meta['url'] = f'/user_image/imgs/{filename}'
                                # Fallback pv_url cho dữ liệu cũ
                                if 'pv_url' not in img_meta:
                                    img_meta['pv_url'] = img_meta['url']
                                data_was_migrated = True
                            except OSError as e:
                                print(f"  - ⚠️ Failed to migrate {filename}: {e}")
                        elif os.path.exists(new_path):
                             # File đã ở đúng vị trí, chỉ cần cập nhật URL
                             img_meta['url'] = f'/user_image/imgs/{filename}'
                             if 'pv_url' not in img_meta:
                                img_meta['pv_url'] = img_meta['url']
                             data_was_migrated = True

        if data_was_migrated:
            self.save_data(all_images, img_data_path, obfuscated=True)
            print("[CoreAPI Migration] Image path migration complete and data saved.")
        else:
            print("[CoreAPI Migration] All image paths are up-to-date.")

    # Yuuka: preview generation v1.1 - Logic tạo preview cho ảnh cũ, có kiểm tra file
    def _generate_missing_previews(self):
        print("[CoreAPI Previews] Checking for missing preview images...")
        all_images = self.read_data("img_data.json", obfuscated=True)
        if not all_images or not isinstance(all_images, dict):
            print("[CoreAPI Previews] No image data to process. Skipping.")
            return

        data_was_modified = False
        for user_hash, characters in all_images.items():
            for char_hash, images in characters.items():
                for img_meta in images:
                    should_regenerate = False
                    pv_url = img_meta.get('pv_url')

                    # Điều kiện 1: Metadata thiếu hoặc là fallback
                    if not pv_url or pv_url == img_meta.get('url'):
                        should_regenerate = True
                    # Điều kiện 2: Metadata có nhưng file vật lý không tồn tại
                    else:
                        try:
                            # Yuuka: preview check fix v1.0
                            url_parts = pv_url.strip('/').split('/')
                            if len(url_parts) > 1 and url_parts[0] == 'user_image':
                                relative_path = os.path.join('user_images', *url_parts[1:])
                                physical_path = self.data_manager.get_path(relative_path)
                                if not os.path.exists(physical_path):
                                    #print(f"  - Detected missing preview file for: {os.path.basename(pv_url)}")
                                    should_regenerate = True
                        except Exception:
                            # Bỏ qua nếu URL không hợp lệ
                            pass
                    
                    if should_regenerate:
                        main_url = img_meta.get('url')
                        if not main_url: continue
                        
                        filename = os.path.basename(main_url)
                        main_image_relative_path = os.path.join('user_images', 'imgs', filename)
                        
                        try:
                            obfuscated_data = self.data_manager.read_binary(main_image_relative_path)
                            if not obfuscated_data:
                                print(f"  - ⚠️ Source not found for {filename}, skipping preview generation.")
                                continue
                            
                            image_data = self.data_manager.deobfuscate_binary(obfuscated_data)
                            
                            img = Image.open(io.BytesIO(image_data))
                            img.thumbnail((self.image_service.PREVIEW_MAX_DIMENSION, self.image_service.PREVIEW_MAX_DIMENSION))
                            
                            buffer = io.BytesIO()
                            img.save(buffer, format="PNG")
                            preview_data = buffer.getvalue()
                            
                            obfuscated_preview_data = self.data_manager.obfuscate_binary(preview_data)
                            preview_relative_path = os.path.join('user_images', 'pv_imgs', filename)
                            self.data_manager.save_binary(obfuscated_preview_data, preview_relative_path)
                            
                            img_meta['pv_url'] = f'/user_image/pv_imgs/{filename}'
                            data_was_modified = True
                            print(f"  - Generated preview for: {filename}")

                        except Exception as e:
                            print(f"  - 💥 Error generating preview for {filename}: {e}")

        if data_was_modified:
            self.save_data(all_images, "img_data.json", obfuscated=True)
            print("[CoreAPI Previews] Finished generating previews and saved updates.")
        else:
            print("[CoreAPI Previews] All images already have previews.")


    # Yuuka: data cleanup v1.0 - Logic dọn dẹp dữ liệu chết
    def _cleanup_dead_data(self):
        print("[CoreAPI Cleanup] Checking for dead user data...")
        # Yuuka: auth rework v1.0 - User hợp lệ là user trong user_data HOẶC whitelist
        valid_public_tokens = set(self._user_data.get("users", []))
        valid_whitelist_tokens = set(self._whitelist_users)
        valid_tokens = valid_public_tokens.union(valid_whitelist_tokens)

        if not valid_tokens:
            print("[CoreAPI Cleanup] No valid users found. Skipping cleanup.")
            return
        
        valid_hashes = {hashlib.sha256(t.encode('utf-8')).hexdigest() for t in valid_tokens}
        
        # Danh sách các file dữ liệu theo user_hash cần dọn dẹp
        # Format: (filename, is_image_data)
        per_user_data_files = [
            ("img_data.json", True),
            ("core_lists.json", False),
            ("scenes.json", False), # Giả định plugin `scene` có file này
            ("tag_groups.json", False) # Giả định plugin `tagger` có file này
        ]

        for filename, is_image_data in per_user_data_files:
            if not os.path.exists(self.data_manager.get_path(filename)):
                continue

            data = self.read_data(filename, obfuscated=True)
            if not isinstance(data, dict): continue

            dead_user_hashes = [h for h in data if h not in valid_hashes]
            
            if not dead_user_hashes:
                print(f"  - '{filename}' is clean.")
                continue

            print(f"  - Found {len(dead_user_hashes)} dead user(s) in '{filename}'. Cleaning...")
            
            for user_hash in dead_user_hashes:
                if is_image_data:
                    # Xử lý xóa file ảnh vật lý
                    user_images_by_char = data.get(user_hash, {})
                    for char_hash, images in user_images_by_char.items():
                        for img_meta in images:
                            for url_key in ['url', 'pv_url']:
                                if (url := img_meta.get(url_key)) and url.startswith('/user_image/'):
                                    try:
                                        # URL: /user_image/imgs/filename.png -> Path: user_images/imgs/filename.png
                                        relative_path = os.path.join(*url.strip('/').split('/'))
                                        filepath = self.data_manager.get_path(relative_path)
                                        if os.path.exists(filepath): os.remove(filepath)
                                    except Exception as e:
                                        print(f"    - ⚠️ Could not delete image file {url}: {e}")
                
                del data[user_hash]
            
            self.save_data(data, filename, obfuscated=True)
            print(f"  - Cleanup for '{filename}' complete.")
            
    # Yuuka: orphan file cleanup v1.0 - Logic dọn dẹp file mồ côi
    def _cleanup_orphan_files(self):
        print("[CoreAPI Cleanup] Checking for orphan image files...")
        all_images = self.read_data("img_data.json", obfuscated=True)
        valid_filenames = set()
        
        if all_images and isinstance(all_images, dict):
            for user_hash, characters in all_images.items():
                for char_hash, images in characters.items():
                    for img_meta in images:
                        if url := img_meta.get('url'):
                            valid_filenames.add(os.path.basename(url))
                        if pv_url := img_meta.get('pv_url'):
                            valid_filenames.add(os.path.basename(pv_url))
        
        user_images_dir = self.data_manager.get_path('user_images')
        deleted_count = 0
        try:
            for filename in os.listdir(user_images_dir):
                file_path = os.path.join(user_images_dir, filename)
                # Chỉ xử lý file, bỏ qua các thư mục con như 'imgs', 'pv_imgs'
                if os.path.isfile(file_path):
                    if filename not in valid_filenames:
                        try:
                            os.remove(file_path)
                            print(f"  - Deleted orphan file: {filename}")
                            deleted_count += 1
                        except OSError as e:
                            print(f"  - ⚠️ Failed to delete orphan file {filename}: {e}")
            
            if deleted_count > 0:
                print(f"[CoreAPI Cleanup] Deleted {deleted_count} orphan files.")
            else:
                print("[CoreAPI Cleanup] No orphan files found in root user_images directory.")
        except Exception as e:
            print(f"💥 [CoreAPI Cleanup] An error occurred during orphan file cleanup: {e}")


    def load_core_data(self):
        print("[CoreAPI] Loading core data (Users, Characters, Thumbnails, Tags)...")
        
        # Yuuka: auth rework v1.1 - Tự động tạo file whitelist/waitlist nếu chưa có
        whitelist_path = self.data_manager.get_path("whitelist.json")
        if not os.path.exists(whitelist_path):
            self.save_data([], "whitelist.json", obfuscated=True)
            print("[CoreAPI] Created empty whitelist.json.")
            
        waitlist_path = self.data_manager.get_path("waitlist.json")
        if not os.path.exists(waitlist_path):
            self.save_data([], "waitlist.json", obfuscated=True)
            print("[CoreAPI] Created empty waitlist.json.")

        # Yuuka: auth rework v1.0 - Tải user_data, whitelist, và waitlist
        self._user_data = self.read_data("user_data.json", default_value={"users":[]}, obfuscated=True)
        self._whitelist_users = self.read_data("whitelist.json", default_value=[], obfuscated=True)
        self._waitlist_users = self.read_data("waitlist.json", default_value=[], obfuscated=True)
        
        # Yuuka: auth rework v1.0 - Logic di chuyển dữ liệu cũ
        if "tokens" in self._user_data and "users" not in self._user_data:
            print("... ⚠️ [CoreAPI] Old user_data.json format detected. Migrating...")
            old_tokens_dict = self._user_data.get("tokens", {})
            self._user_data = {"users": list(set(old_tokens_dict.values()))}
            self.save_data(self._user_data, "user_data.json", obfuscated=True)
            print("... ✅ Migration complete. New user data format saved.")
        
        # Yuuka: Chạy các quy trình dọn dẹp và di chuyển theo thứ tự hợp lý
        self._migrate_old_images()
        self._generate_missing_previews() # Yuuka: preview generation v1.0
        self._cleanup_dead_data()
        self._cleanup_orphan_files() 
        
        self._load_tags_data()
        try:
            thumbs_content = self._fetch_or_read_from_cache("Thumbnails JSON", self.JSON_THUMBNAILS_URL, "wai_character_thumbs.json")
            self._thumbnails_data_dict = json.loads(thumbs_content)
            chars_content = self._fetch_or_read_from_cache("Characters CSV", self.CSV_CHARACTERS_URL, "wai_characters.csv")
            reader = csv.reader(io.StringIO(chars_content))
            next(reader, None)
            temp_list = []
            for row in reader:
                # YUUKA'S FIX: Xử lý `row` như một list, kiểm tra phần tử `row[1]`
                if len(row) >= 2 and row[1] and row[1].strip():
                    name = row[1].strip()
                    md5 = hashlib.md5(name.replace('(', '\\(').replace(')', '\\)').encode('utf-8')).hexdigest()
                    if md5 in self._thumbnails_data_dict:
                        char_data = {"name": name, "hash": md5}
                        temp_list.append(char_data)
                        self._all_characters_dict[md5] = char_data
            self._all_characters_list = sorted(temp_list, key=lambda x: x['name'].lower())
            print(f"[CoreAPI] Loaded {len(self._all_characters_list)} characters successfully.")
        except Exception as e:
            print(f"💥 CRITICAL ERROR during core data fetching/processing: {e}")
    
    # --- 5. Yuuka: Hệ thống Dịch vụ (Service System) ---
    def register_service(self, service_name: str, service_callable):
        if service_name in self._services:
            print(f"⚠️ [CoreAPI] Warning: Service '{service_name}' is being overwritten.")
        self._services[service_name] = service_callable
        print(f"[CoreAPI] Service '{service_name}' registered successfully.")

    def call_service(self, service_name: str, *args, **kwargs):
        service_callable = self._services.get(service_name)
        if callable(service_callable):
            try: return service_callable(*args, **kwargs)
            except Exception as e:
                print(f"💥 [CoreAPI] Error calling service '{service_name}': {e}")
                return None
        else: return None

    # --- 5.1 Background task helpers ---
    def register_background_task(
        self,
        plugin_id: str,
        task_name: str,
        target,
        *,
        args=None,
        kwargs=None,
        pass_stop_event: bool = True,
        stop_callback=None,
        auto_start: bool = True,
        auto_restart: bool = False,
        restart_delay: float = 5.0,
        daemon: bool = True,
    ):
        """Convenience wrapper so plugins can register managed background tasks."""
        return self.task_service.register_thread_task(
            plugin_id,
            task_name,
            target,
            args=args or (),
            kwargs=kwargs or {},
            pass_stop_event=pass_stop_event,
            stop_callback=stop_callback,
            auto_start=auto_start,
            auto_restart=auto_restart,
            restart_delay=restart_delay,
            daemon=daemon,
        )

    def stop_background_tasks_for_plugin(self, plugin_id: str, timeout: float = 10.0):
        self.task_service.stop_all_for_plugin(plugin_id, timeout=timeout)

    def stop_all_background_tasks(self, timeout: float = 10.0):
        self.task_service.stop_all(timeout=timeout)

    def get_background_task_status(self, plugin_id: str = None):
        return self.task_service.get_status(plugin_id)

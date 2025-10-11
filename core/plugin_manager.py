# --- MODIFIED FILE: core/plugin_manager.py ---
import os
import json
import importlib
import hashlib
import uuid
import time
import base64
import gzip
import requests
import io
import csv
import threading
import websocket
import random # Yuuka: Thêm thư viện random

# Yuuka: new image paths v1.0 - Thêm thư viện xử lý ảnh Pillow
from PIL import Image

from flask import request, abort, jsonify

# Yuuka: Import các thư viện tích hợp, chúng sẽ trở thành một phần của CoreAPI
from comfyui_integration import comfy_api_client
from comfyui_integration.workflow_builder_service import WorkflowBuilderService

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

class GenerationService:
    """Yuuka: Service mới để quản lý tập trung quá trình tạo ảnh."""
    def __init__(self, core_api):
        self.core_api = core_api
        self.image_service = core_api.image_service
        self.MAX_TASKS_PER_USER = 5
        self.user_states = {}
        self.user_locks = {}

    def _get_user_lock(self, user_hash):
        return self.user_locks.setdefault(user_hash, threading.Lock())

    def start_generation_task(self, user_hash, character_hash, gen_config, context):
        with self._get_user_lock(user_hash):
            user_tasks = self.user_states.setdefault(user_hash, {"tasks": {}, "events": []})
            if len(user_tasks["tasks"]) >= self.MAX_TASKS_PER_USER:
                return None, "Đã đạt giới hạn tác vụ đồng thời."

            task_id = str(uuid.uuid4())
            user_tasks["tasks"][task_id] = {
                "task_id": task_id, "is_running": True, "character_hash": character_hash,
                "progress_message": "Đang khởi tạo...", "progress_percent": 0,
                "cancel_requested": False, "prompt_id": None, "context": context,
                "generation_config": gen_config # Yuuka: global cancel v1.0
            }
            thread = threading.Thread(target=self._run_task, args=(user_hash, task_id, character_hash, gen_config))
            thread.start()
            return task_id, "Đã bắt đầu tác vụ."

    def get_user_status(self, user_hash):
        with self._get_user_lock(user_hash):
            state = self.user_states.get(user_hash, {"tasks": {}, "events": []})
            response = {"tasks": state["tasks"].copy(), "events": list(state["events"])}
            state["events"].clear() # Xóa event sau khi đã lấy
            
            # Dọn dẹp task đã hoàn thành
            finished_tasks = [tid for tid, t in state["tasks"].items() if not t["is_running"]]
            for tid in finished_tasks:
                del state["tasks"][tid]

            return response

    def request_cancellation(self, user_hash, task_id):
        with self._get_user_lock(user_hash):
            task = self.user_states.get(user_hash, {}).get("tasks", {}).get(task_id)
            if not task or not task["is_running"]:
                return False

            # Yuuka: global cancel v1.0 - Logic hủy nâng cao
            prompt_id = task.get("prompt_id")
            gen_config = task.get("generation_config", {})
            server_address = gen_config.get("server_address")

            if prompt_id and server_address:
                try:
                    queue_details = self.core_api.comfy_api_client.get_queue_details_sync(server_address)
                    
                    # Kiểm tra xem prompt có đang chạy không
                    is_running = any(p[1] == prompt_id for p in queue_details.get("queue_running", []))
                    if is_running:
                        print(f"[GenService] Task {task_id} (prompt {prompt_id}) is running. Sending interrupt to {server_address}...")
                        self.core_api.comfy_api_client.interrupt_execution(server_address)
                    
                    # Kiểm tra xem prompt có đang chờ không
                    is_pending = any(p[1] == prompt_id for p in queue_details.get("queue_pending", []))
                    if is_pending:
                        print(f"[GenService] Task {task_id} (prompt {prompt_id}) is pending. Deleting from queue on {server_address}...")
                        self.core_api.comfy_api_client.delete_queued_item(prompt_id, server_address)
                        
                except Exception as e:
                    print(f"💥 [GenService] Error during ComfyUI cancellation for task {task_id}: {e}")
            
            # Đặt cờ hủy nội bộ để dừng vòng lặp trong _run_task
            task["cancel_requested"] = True
            return True

    def _add_event(self, user_hash, event_type, data):
        with self._get_user_lock(user_hash):
            self.user_states.setdefault(user_hash, {"tasks": {}, "events": []})["events"].append({
                "type": event_type, "data": data, "timestamp": time.time()
            })

    def _run_task(self, user_hash, task_id, character_hash, cfg_data):
        ws = None
        execution_successful = False
        start_time = None 
        try:
            client_id = str(uuid.uuid4())
            seed = uuid.uuid4().int % (10**15) if int(cfg_data.get("seed", 0)) == 0 else int(cfg_data.get("seed", 0))
            target_address = cfg_data.get('server_address', '127.0.0.1:8888')

            workflow, output_node_id = self.core_api.workflow_builder.build_workflow(cfg_data, seed)
            
            prompt_info = self.core_api.comfy_api_client.queue_prompt(workflow, client_id, target_address)
            prompt_id = prompt_info['prompt_id']

            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"][task_id]
                task['prompt_id'] = prompt_id
                task['progress_message'] = "Đã gửi, đang chờ trong hàng đợi..."

            # YUUKA: QUEUE POLLING LOGIC v1.0
            while True:
                with self._get_user_lock(user_hash):
                    task = self.user_states[user_hash]["tasks"].get(task_id)
                    if not task or task.get('cancel_requested'):
                        raise InterruptedError("Cancelled by user during queue wait.")
                
                queue_details = self.core_api.comfy_api_client.get_queue_details_sync(target_address)
                running_prompts = queue_details.get("queue_running", [])
                pending_prompts = queue_details.get("queue_pending", [])
                
                if any(p[1] == prompt_id for p in running_prompts):
                    break # Đến lượt của chúng ta, thoát khỏi vòng lặp polling
                
                is_pending = any(p[1] == prompt_id for p in pending_prompts)
                if is_pending:
                    try:
                        # Tìm vị trí chính xác trong hàng đợi
                        queue_pos = [p[1] for p in pending_prompts].index(prompt_id)
                        total_ahead = len(running_prompts) + queue_pos
                        with self._get_user_lock(user_hash):
                            self.user_states[user_hash]["tasks"][task_id]['progress_message'] = f"Trong hàng đợi ({total_ahead} trước)..."
                    except ValueError:
                        pass # Prompt có thể đã chuyển sang running giữa hai lần check
                    time.sleep(1)
                else:
                    # Không running, cũng không pending -> có thể đã xong rất nhanh hoặc lỗi
                    break

            # Yuuka: creation time patch v1.0 - Bắt đầu đếm giờ ngay khi rời hàng đợi
            start_time = time.time()

            ws = websocket.WebSocket()
            ws.connect(f"ws://{target_address}/ws?clientId={client_id}", timeout=10)

            while True:
                with self._get_user_lock(user_hash):
                    task = self.user_states[user_hash]["tasks"].get(task_id)
                    if not task or task.get('cancel_requested'): raise InterruptedError("Cancelled by user.")
                try: out = ws.recv()
                except (websocket.WebSocketTimeoutException, websocket.WebSocketConnectionClosedException): break
                if not isinstance(out, str): continue
                try: message = json.loads(out)
                except json.JSONDecodeError: continue
                
                msg_type, msg_data = message.get('type'), message.get('data', {})
                with self._get_user_lock(user_hash):
                    task = self.user_states[user_hash]["tasks"].get(task_id)
                    if not task: continue
                    if msg_data.get('prompt_id') == prompt_id:
                        if msg_type == 'execution_start':
                            task['progress_message'] = "Bắt đầu xử lý..."
                        elif msg_type == 'progress':
                            v, m = msg_data.get('value',0), msg_data.get('max',1)
                            p = int(v/m*100) if m>0 else 0
                            task['progress_percent'] = p; task['progress_message'] = f"Đang tạo... {p}%"
                        elif msg_type == 'executing' and msg_data.get('node') is None:
                            execution_successful = True
                            break
                        elif msg_type == 'execution_error': raise Exception(f"Node error: {msg_data.get('exception_message', 'Unknown')}")
            
            if execution_successful:
                with self._get_user_lock(user_hash): self.user_states[user_hash]["tasks"][task_id]['progress_message'] = "Đang xử lý kết quả..."
                history = self.core_api.comfy_api_client.get_history(prompt_id, target_address)
                outputs = history.get(prompt_id, {}).get('outputs', {})
                if output_node_id in outputs and "images_base64" in outputs[output_node_id]:
                    image_b64 = outputs[output_node_id]["images_base64"][0]
                else:
                    raise Exception(f"Không tìm thấy dữ liệu ảnh base64 trong node '{output_node_id}'")

                # Yuuka: creation time patch v1.0 - start_time giờ đây luôn được đảm bảo
                creation_duration = (time.time() - start_time) - 0.3 # Trừ đi thời gian chờ WebSocket
                new_metadata = self.image_service.save_image_metadata(
                    user_hash, character_hash, image_b64, cfg_data, creation_duration
                )
                if not new_metadata: raise Exception("Lưu ảnh thất bại.")
                
                self._add_event(user_hash, "IMAGE_SAVED", {"task_id": task_id, "image_data": new_metadata, "context": task.get("context")})
            else:
                 raise ConnectionAbortedError("WebSocket connection lost before prompt finished execution.")

        except InterruptedError as e:
             print(f"✅ [GenService Task {task_id}] Cancelled gracefully for user {user_hash}.")
        except Exception as e:
            print(f"💥 [GenService Task {task_id}] Failed for user {user_hash}: {e}")
            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"].get(task_id)
                if task: task['error_message'] = f"Lỗi: {str(e)}"
        finally:
            if ws: ws.close()
            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"].get(task_id)
                if task: task['is_running'] = False


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
        # Yuuka: Khởi tạo các dịch vụ tích hợp
        self.workflow_builder = WorkflowBuilderService()
        self.comfy_api_client = comfy_api_client
        # Yuuka: Hệ thống dịch vụ mới để các plugin giao tiếp
        self._services = {}
        # YUUKA: KHỞI TẠO CÁC SERVICE LÕI MỚI
        self.image_service = ImageService(self)
        self.generation_service = GenerationService(self)
        
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
    def verify_token_and_get_user_hash(self):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            raise Exception("Authorization header is missing or invalid.")
        token = auth_header.split(' ')[1]
        
        user_ips = self._user_data.get("IPs", {})
        client_ip = request.remote_addr

        # Yuuka's Fix: Cho phép token hợp lệ dù không có trong IP list (ví dụ: mới login)
        if user_ips.get(client_ip) == token or token in self._user_data.get("users", []):
             return hashlib.sha256(token.encode('utf-8')).hexdigest()
        
        raise Exception("Invalid token.")


    def get_token_for_ip(self):
        client_ip = request.remote_addr
        token = self._user_data.get("IPs", {}).get(client_ip)
        if token:
            return jsonify({"status": "exists", "token": token})
        return jsonify({"status": "not_found"}), 404

    def generate_token_for_ip(self):
        client_ip = request.remote_addr
        new_token = str(uuid.uuid4())
        
        self._user_data.setdefault("users", []).append(new_token)
        self._user_data.setdefault("IPs", {})[client_ip] = new_token
        
        self.save_data(self._user_data, "user_data.json", obfuscated=True)
        print(f"[CoreAPI] Generated new token for IP: {client_ip}")
        return jsonify({"status": "created", "token": new_token})
        
    def login_with_token(self, token: str):
        """Xác thực token và gán nó cho IP hiện tại nếu hợp lệ."""
        client_ip = request.remote_addr
        all_users = self._user_data.get("users", [])
        
        if token in all_users:
            self._user_data.setdefault("IPs", {})[client_ip] = token
            self.save_data(self._user_data, "user_data.json", obfuscated=True)
            print(f"[CoreAPI] User with token logged in from IP: {client_ip}")
            return jsonify({"status": "success", "token": token})
        else:
            return jsonify({"error": "Invalid token"}), 401

    def logout_from_ip(self):
        """Xóa token khỏi danh sách IP đang hoạt động (logout)."""
        try:
            auth_header = request.headers.get('Authorization')
            token = auth_header.split(' ')[1]
            user_ips = self._user_data.get("IPs", {})

            ips_to_remove = [ip for ip, t in user_ips.items() if t == token]
            if not ips_to_remove:
                 return jsonify({"status": "not_found", "message": "Token not associated with any active IP."})
            
            for ip in ips_to_remove:
                del user_ips[ip]
                print(f"[CoreAPI] Token logged out from IP: {ip}")

            self.save_data(self._user_data, "user_data.json", obfuscated=True)
            return jsonify({"status": "success", "message": "Logged out successfully."})
        except (IndexError, TypeError):
             return jsonify({"error": "Invalid or missing token for logout"}), 400


    def share_token_with_ip(self, target_ip: str):
        """Lấy token của người dùng hiện tại và gán nó cho một IP khác."""
        auth_header = request.headers.get('Authorization')
        token = auth_header.split(' ')[1] 
        if "IPs" not in self._user_data: self._user_data["IPs"] = {}
        self._user_data["IPs"][target_ip] = token
        self.save_data(self._user_data, "user_data.json", obfuscated=True)
        print(f"[CoreAPI] Shared current user's token with new IP: {target_ip}")


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
        valid_tokens = set(self._user_data.get("users", []))
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
        self._user_data = self.read_data("user_data.json", default_value={}, obfuscated=True)
        if "tokens" in self._user_data and "users" not in self._user_data:
            print("... ⚠️ [CoreAPI] Old user_data.json format detected. Migrating...")
            old_tokens_dict = self._user_data["tokens"]
            self._user_data = {"users": list(set(old_tokens_dict.values())), "IPs": old_tokens_dict}
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


class Plugin:
    def __init__(self, path, metadata, backend_instance):
        self.path = path
        self.metadata = metadata
        self.backend = backend_instance
        self.id = metadata.get('id', os.path.basename(path))

class PluginManager:
    def __init__(self, plugins_dir, app, data_manager):
        self.plugins_dir = plugins_dir
        self.app = app
        self.data_manager = data_manager
        self.core_api = CoreAPI(data_manager)
        self._plugins = {}

    def load_plugins(self):
        print("[PluginManager] Bắt đầu quét và tải plugins...")
        os.makedirs(self.plugins_dir, exist_ok=True)
        for entry in os.scandir(self.plugins_dir):
            if entry.is_dir():
                self._load_plugin_from_path(entry.path)

    def _load_plugin_from_path(self, path):
        plugin_id = os.path.basename(path)
        manifest_path = os.path.join(path, 'plugin.json')
        if not os.path.exists(manifest_path):
            return

        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            backend_entry = metadata.get('entry_points', {}).get('backend')
            if not backend_entry:
                raise ValueError("Plugin manifest is missing backend entry point.")
            
            module_name, class_name = backend_entry.split(':')
            full_module_path = f"plugins.{plugin_id}.{module_name}"
            
            module_spec = importlib.util.spec_from_file_location(
                full_module_path, 
                os.path.join(path, f"{module_name}.py")
            )
            module = importlib.util.module_from_spec(module_spec)
            module_spec.loader.exec_module(module)
            
            plugin_class = getattr(module, class_name)
            backend_instance = plugin_class(self.core_api)

            if hasattr(backend_instance, 'register_services') and callable(getattr(backend_instance, 'register_services')):
                backend_instance.register_services()
            
            if hasattr(backend_instance, 'get_blueprint'):
                blueprint, url_prefix = backend_instance.get_blueprint()
                if blueprint:
                    self.app.register_blueprint(blueprint, url_prefix=url_prefix)
            
            self._plugins[plugin_id] = Plugin(path, metadata, backend_instance)
            print(f"  - Đã tải thành công plugin: '{metadata.get('name', plugin_id)}'")

        except Exception as e:
            print(f"💥 Lỗi khi tải plugin từ '{path}': {e}")
            
    def get_plugin_by_id(self, plugin_id):
        return self._plugins.get(plugin_id)

    def get_active_plugins(self):
        return list(self._plugins.values())

    def get_frontend_assets(self):
        assets = {'js': [], 'css': []}
        for plugin in self._plugins.values():
            if 'assets' in plugin.metadata:
                for js_file in plugin.metadata['assets'].get('js', []):
                    assets['js'].append(f"/plugins/{plugin.id}/static/{js_file}")
                for css_file in plugin.metadata['assets'].get('css', []):
                    assets['css'].append(f"/plugins/{plugin.id}/static/{css_file}")
        return assets

    def get_ui_components(self):
        ui_data = []
        for plugin in sorted(self._plugins.values(), key=lambda p: p.metadata.get('ui', {}).get('order', 99)):
            if 'ui' in plugin.metadata:
                ui_data.append({
                    'id': plugin.id,
                    'name': plugin.metadata.get('name'),
                    'ui': plugin.metadata['ui'],
                    'entry_points': plugin.metadata.get('entry_points', {})
                })
        return ui_data
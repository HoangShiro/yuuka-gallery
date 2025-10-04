# --- MODIFIED FILE: app.py ---
import csv
import io
import hashlib
import base64
import gzip
import requests
import os
import time
import json
import ipaddress
import uuid
import threading
import signal
from flask import Flask, render_template, jsonify, Response, abort, request, send_from_directory
from flask_cors import CORS

# Yuuka: Import các module mới từ thư mục comfyui_integration
from comfyui_integration.workflow_builder_service import WorkflowBuilderService
from comfyui_integration import comfy_api_client

# --- Constants ---
CSV_CHARACTERS_URL = "https://raw.githubusercontent.com/mirabarukaso/character_select_stand_alone_app/refs/heads/main/data/wai_characters.csv"
JSON_THUMBNAILS_URL = "https://huggingface.co/datasets/flagrantia/character_select_stand_alone_app/resolve/main/wai_character_thumbs.json"
COMFYUI_DEFAULT_ADDRESS = "127.0.0.1:8888"
OBFUSCATION_KEY = b'yuuka_is_the_best_sensei_at_millennium_seminar'
# Yuuka: Tiền tố để nhận biết chuỗi đã được mã hoá Base64
B64_PREFIX = "b64:"


# Yuuka: Cấu hình mặc định cho ComfyUI khi người dùng chưa có config
DEFAULT_CONFIG = {
    "server_address": "127.0.0.1:8888",
    "ckpt_name": "waiNSFWIllustrious_v150.safensors",
    "character": "shiina_mahiru_(otonari_no_tenshi-sama)",
    "expression": "smile",
    "action": "sitting",
    "outfits": "school uniform",
    "context": "1girl, classroom",
    "quality": "masterpiece, best quality, highres, amazing quality",
    "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
    "batch_size": 1, 
    "height": 1216, 
    "width": 832, 
    "cfg": 2.5, 
    "sampler_name": "euler_ancestral", 
    "scheduler": "karras", 
    "steps": 25,
    "lora_name": "None", 
    "lora_strength_model": 1.0, 
    "lora_strength_clip": 1.0,
}

# --- Cache Configuration ---
CACHE_DIR = "data_cache"
USER_IMAGES_DIR = "user_images"
CACHE_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days
CHARACTERS_CACHE_FILENAME = "wai_characters.csv"
THUMBNAILS_CACHE_FILENAME = "wai_character_thumbs.json"
USER_DATA_FILENAME = "user_data.json"
ALBUM_DATA_FILENAME = "album_data.json"
COMFYUI_CONFIG_FILENAME = "comfyui_config.json"
TAGS_FILENAME = "tags.csv"
SCENE_DATA_FILENAME = "scene_data.json"
TAG_GROUPS_FILENAME = "tags_group.json"

# Yuuka: Danh sách các file JSON cần mã hóa giá trị string
OBFUSCATED_JSON_FILES = [ALBUM_DATA_FILENAME, TAG_GROUPS_FILENAME, USER_DATA_FILENAME]


# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# --- In-memory Data Cache ---
ALL_CHARACTERS_LIST = []
ALL_CHARACTERS_DICT = {}
THUMBNAILS_DATA_DICT = {}
USER_DATA = {}
ALBUM_DATA = {}
COMFYUI_CONFIG = {} 
TAG_PREDICTIONS = []
SCENE_DATA = {}
TAG_GROUPS_DATA = {} # Yuuka: Chuyển sang dict để lưu theo user_hash

# Yuuka: State cho việc gen ảnh nền
SCENE_GENERATION_STATE = {
    "is_running": False, 
    "cancel_requested": False, 
    "current_job": None,
    "user_hash": None,
    "current_scene_id": None,
    "current_stage_id": None,
    "progress": {
        "current": 0,
        "total": 0,
        "message": "Chưa bắt đầu"
    }
}
scene_generation_lock = threading.Lock()

workflow_builder = WorkflowBuilderService()

# === Helper functions ===

# Yuuka: Các hàm này dùng để mã hoá/giải mã Base64 cho các giá trị string trong file JSON.
def _encode_string_b64(s: str) -> str:
    """Mã hoá một chuỗi sang Base64 và thêm tiền tố."""
    encoded = base64.b64encode(s.encode('utf-8')).decode('utf-8')
    return f"{B64_PREFIX}{encoded}"

def _decode_string_b64(s: str) -> str:
    """Giải mã một chuỗi từ Base64 nếu có tiền tố. Nếu không, trả về chuỗi gốc."""
    if s.startswith(B64_PREFIX):
        try:
            b64_part = s[len(B64_PREFIX):]
            return base64.b64decode(b64_part.encode('utf-8')).decode('utf-8')
        except (TypeError, base64.binascii.Error):
            # Nếu giải mã thất bại dù có prefix, trả về chuỗi gốc để tránh lỗi
            return s
    return s

def _process_data_recursive(data, process_func):
    """
    Hàm đệ quy để áp dụng một hàm xử lý (mã hóa/giải mã)
    lên tất cả các giá trị string trong một cấu trúc dữ liệu lồng nhau.
    """
    if isinstance(data, dict):
        return {k: _process_data_recursive(v, process_func) for k, v in data.items()}
    elif isinstance(data, list):
        return [_process_data_recursive(item, process_func) for item in data]
    elif isinstance(data, str):
        # Yuuka: Không mã hoá URL hình ảnh trong album_data.json
        if data.startswith('/user_image/'):
            return data
        return process_func(data)
    else:
        return data

# Yuuka: Cập nhật hệ thống xác thực dựa trên IP và Token
def _get_user_hash_from_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()

def _verify_token_and_get_user_hash(req):
    auth_header = req.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        abort(401, description="Authorization header is missing or invalid.")
    
    token = auth_header.split(' ')[1]
    client_ip = request.remote_addr
    
    user_tokens = USER_DATA.get("tokens", {})
    if user_tokens.get(client_ip) != token:
        # Yuuka: Cho phép token được chia sẻ qua nhiều IP
        if token not in user_tokens.values():
            abort(401, description="Invalid token for this IP address.")
        
    return _get_user_hash_from_token(token)

def is_lan_ip(ip_str: str) -> bool:
    try:
        if ip_str in ('127.0.0.1', '::1'): return True
        return ipaddress.ip_address(ip_str).is_private
    except ValueError:
        return False

def get_data_path(filename: str) -> str:
    return os.path.join(CACHE_DIR, filename)

def load_json_data(filename, default_value={}):
    path = get_data_path(filename)
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
                # Yuuka: Giải mã dữ liệu nếu file nằm trong danh sách cần mã hoá
                if filename in OBFUSCATED_JSON_FILES:
                    return _process_data_recursive(loaded_data, _decode_string_b64)
                return loaded_data
        except json.JSONDecodeError:
            print(f"⚠️ [Server] Warning: Could not decode {path}. Starting fresh.")
    else:
        print(f"[Server] No {filename} file found. A new one will be created on first save.")
    return default_value

def save_json_data(data, filename):
    path = get_data_path(filename)
    try:
        data_to_save = data
        # Yuuka: Mã hoá dữ liệu trước khi lưu nếu file nằm trong danh sách
        if filename in OBFUSCATED_JSON_FILES:
            data_to_save = _process_data_recursive(data, _encode_string_b64)

        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, indent=2)
        print(f"[Server] Saved data to: {path}")
    except IOError as e:
        print(f"💥 CRITICAL ERROR: Could not write data to {path}. Error: {e}")

def get_md5_hash(tag: str) -> str:
    tag_for_md5 = tag.replace('(', '\\(').replace(')', '\\)')
    return hashlib.md5(tag_for_md5.encode('utf-8')).hexdigest()

def _fetch_or_read_from_cache(data_name: str, remote_url: str, local_filename: str) -> str:
    local_path = os.path.join(CACHE_DIR, local_filename)
    should_download = False
    if os.path.exists(local_path):
        if (time.time() - os.path.getmtime(local_path)) > CACHE_TTL_SECONDS:
            print(f"[Server Cache] Cache for {data_name} is stale. Refreshing.")
            should_download = True
        else:
            print(f"[Server Cache] Loading {data_name} from fresh cache file: {local_path}")
    else:
        print(f"[Server Cache] No cache found for {data_name}. Downloading for the first time.")
        should_download = True
    if should_download:
        print(f"[Server] Fetching {data_name} from: {remote_url}")
        try:
            response = requests.get(remote_url, timeout=60)
            response.raise_for_status()
            content = response.text
            with open(local_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"[Server] Successfully updated cache file: {local_path}")
        except requests.RequestException as e:
            print(f"⚠️ [Server] Failed to fetch {data_name}: {e}. Will use existing cache if available.")
    if os.path.exists(local_path):
        with open(local_path, 'r', encoding='utf-8') as f:
            return f.read()
    else:
        raise RuntimeError(f"CRITICAL: No local cache for {data_name} and download failed.")

def load_and_prepare_data():
    global ALL_CHARACTERS_LIST, THUMBNAILS_DATA_DICT, ALL_CHARACTERS_DICT, USER_DATA, ALBUM_DATA, COMFYUI_CONFIG, TAG_PREDICTIONS, SCENE_DATA, TAG_GROUPS_DATA
    print("[Server] Starting to load and process data...")
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        os.makedirs(USER_IMAGES_DIR, exist_ok=True)
        USER_DATA = load_json_data(USER_DATA_FILENAME, default_value={})
        ALBUM_DATA = load_json_data(ALBUM_DATA_FILENAME, default_value={})
        COMFYUI_CONFIG = load_json_data(COMFYUI_CONFIG_FILENAME, default_value={})
        SCENE_DATA = load_json_data(SCENE_DATA_FILENAME, default_value={})
        
        # Yuuka: Xử lý chuyển đổi định dạng cho TAG_GROUPS_DATA
        TAG_GROUPS_DATA = load_json_data(TAG_GROUPS_FILENAME, default_value={})
        if isinstance(TAG_GROUPS_DATA, list):
            print("⚠️ [Server Migration] Old 'tags_group.json' format (list) detected.")
            print("   - This format is deprecated and will be replaced with the new user-specific format (dictionary).")
            print("   - The old shared data will be discarded. Please backup the file if you need to preserve it.")
            TAG_GROUPS_DATA = {}
            save_json_data(TAG_GROUPS_DATA, TAG_GROUPS_FILENAME)

        tags_path = get_data_path(TAGS_FILENAME)
        if os.path.exists(tags_path):
            try:
                with open(tags_path, 'r', encoding='utf-8') as f:
                    reader = csv.reader(f)
                    tags_with_popularity = []
                    for row in reader:
                        if len(row) >= 2:
                            try:
                                tags_with_popularity.append((row[0].strip(), int(row[1])))
                            except ValueError: continue
                    tags_with_popularity.sort(key=lambda x: x[1], reverse=True)
                    TAG_PREDICTIONS = [tag for tag, pop in tags_with_popularity]
                    print(f"[Server] Loaded and sorted {len(TAG_PREDICTIONS)} tags for prediction.")
            except Exception as e:
                print(f"⚠️ [Server] Warning: Could not load or process {TAGS_FILENAME}. Error: {e}")
        else:
            print(f"[Server] No {TAGS_FILENAME} found. Tag prediction will be disabled.")

        thumbnails_content = _fetch_or_read_from_cache("Thumbnails JSON", JSON_THUMBNAILS_URL, THUMBNAILS_CACHE_FILENAME)
        THUMBNAILS_DATA_DICT = json.loads(thumbnails_content)
        print(f"[Server] Loaded {len(THUMBNAILS_DATA_DICT)} thumbnails into memory.")
        characters_content = _fetch_or_read_from_cache("Characters CSV", CSV_CHARACTERS_URL, CHARACTERS_CACHE_FILENAME)
        reader = csv.reader(io.StringIO(characters_content))
        next(reader, None)
        temp_char_list = []
        for row in reader:
            if len(row) >= 2 and row[1] and row[1].strip():
                original_name = row[1].strip()
                md5_hash = get_md5_hash(original_name)
                if md5_hash in THUMBNAILS_DATA_DICT:
                    char_data = {"name": original_name, "hash": md5_hash}
                    temp_char_list.append(char_data)
                    ALL_CHARACTERS_DICT[md5_hash] = char_data
        ALL_CHARACTERS_LIST = sorted(temp_char_list, key=lambda x: x['name'].lower())
        print(f"[Server] Processed and linked {len(ALL_CHARACTERS_LIST)} characters.")
    except Exception as e:
        print(f"💥 CRITICAL ERROR: Could not load or process data. Server cannot function. Error: {e}")

# === Route Definitions ===

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/user_image/<filename>')
def user_image(filename):
    # Yuuka: Logic mới để giải mã ảnh trước khi gửi về client.
    filepath = os.path.join(USER_IMAGES_DIR, filename)
    if not os.path.exists(filepath):
        abort(404)
    try:
        with open(filepath, 'rb') as f:
            obfuscated_data = f.read()
        
        # Áp dụng lại phép XOR để có được dữ liệu gốc
        original_data = bytes([
            b ^ OBFUSCATION_KEY[i % len(OBFUSCATION_KEY)] 
            for i, b in enumerate(obfuscated_data)
        ])
        
        return Response(original_data, mimetype='image/png')
    except Exception as e:
        print(f"Error de-obfuscating image {filename}: {e}")
        abort(500)

# === API Endpoints for Auth ===
@app.route('/api/auth/token', methods=['GET'])
def get_token_for_ip():
    client_ip = request.remote_addr
    token = USER_DATA.get("tokens", {}).get(client_ip)
    if token:
        return jsonify({"status": "exists", "token": token})
    return jsonify({"status": "not_found"}), 404

@app.route('/api/auth/token', methods=['POST'])
def generate_token_for_ip():
    client_ip = request.remote_addr
    new_token = str(uuid.uuid4())
    if "tokens" not in USER_DATA:
        USER_DATA["tokens"] = {}
    USER_DATA["tokens"][client_ip] = new_token
    save_json_data(USER_DATA, USER_DATA_FILENAME)
    print(f"[Auth] Generated new token for IP: {client_ip}")
    return jsonify({"status": "created", "token": new_token})

# Yuuka: Thêm API endpoint để chia sẻ token cho IP khác
@app.route('/api/auth/share_token', methods=['POST'])
def share_token_with_ip():
    _verify_token_and_get_user_hash(request)
    
    data = request.json
    target_ip = data.get('ip_address')
    if not target_ip:
        abort(400, description="Missing 'ip_address' in request body.")
    
    auth_header = request.headers.get('Authorization')
    token = auth_header.split(' ')[1]

    if "tokens" not in USER_DATA:
        USER_DATA["tokens"] = {}
        
    USER_DATA["tokens"][target_ip] = token
    save_json_data(USER_DATA, USER_DATA_FILENAME)
    print(f"[Auth] Shared token with new IP: {target_ip}")
    return jsonify({"status": "success", "message": f"Token has been successfully associated with {target_ip}."})

# === API Endpoints for LAN Sync (Favourites/Blacklist) ===

@app.route('/api/lists', methods=['GET'])
def get_lists():
    _verify_token_and_get_user_hash(request) # Yuuka: All APIs now require a valid token
    client_ip = request.remote_addr
    if is_lan_ip(client_ip):
        print(f"[Server] LAN client {client_ip} connected. Providing synced lists.")
        lan_data = USER_DATA.get("lan", {})
        return jsonify({"sync_mode": "lan", "favourites": lan_data.get("favourites", []), "blacklist": lan_data.get("blacklist", [])})
    else:
        print(f"[Server] Public client {client_ip} connected. Instructing to use local storage.")
        return jsonify({"sync_mode": "local"})

@app.route('/api/lists', methods=['POST'])
def update_lists():
    _verify_token_and_get_user_hash(request)
    client_ip = request.remote_addr
    if not is_lan_ip(client_ip):
        abort(403, description="Only LAN clients can update the shared lists.")
    data = request.json
    new_favourites = data.get('favourites', [])
    new_blacklist = data.get('blacklist', [])
    if not isinstance(new_favourites, list) or not isinstance(new_blacklist, list):
        abort(400, description="Invalid data format.")
    USER_DATA["lan"] = {"favourites": new_favourites, "blacklist": new_blacklist}
    save_json_data(USER_DATA, USER_DATA_FILENAME)
    print(f"[Server] Received and saved list updates from LAN client {client_ip}.")
    return jsonify({"status": "success", "message": "Lists updated."})

# === API Endpoints for Synced Album ===
def _save_generated_image(user_hash, character_hash, image_base64, generation_config):
    try:
        image_data = base64.b64decode(image_base64)
        
        # Yuuka: Áp dụng phép XOR đơn giản để mã hoá dữ liệu ảnh
        obfuscated_data = bytes([
            b ^ OBFUSCATION_KEY[i % len(OBFUSCATION_KEY)] 
            for i, b in enumerate(image_data)
        ])
        
        image_id = str(uuid.uuid4())
        filename = f"{image_id}.png"
        filepath = os.path.join(USER_IMAGES_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(obfuscated_data)
            
    except Exception as e:
        print(f"Error saving image: {e}")
        raise IOError("Could not save image file.")

    if user_hash not in ALBUM_DATA: ALBUM_DATA[user_hash] = {}
    if character_hash not in ALBUM_DATA[user_hash]: ALBUM_DATA[user_hash][character_hash] = []
        
    new_image_metadata = {
        "id": image_id, "url": f"/user_image/{filename}",
        "generationConfig": generation_config, "createdAt": time.time()
    }
    
    ALBUM_DATA[user_hash][character_hash].append(new_image_metadata)
    save_json_data(ALBUM_DATA, ALBUM_DATA_FILENAME)
    return new_image_metadata

@app.route('/api/album/characters', methods=['GET'])
def get_album_characters():
    user_hash = _verify_token_and_get_user_hash(request)
    user_album = ALBUM_DATA.get(user_hash, {})
    return jsonify(list(user_album.keys()))

@app.route('/api/album/<character_hash>', methods=['GET'])
def get_character_album(character_hash):
    user_hash = _verify_token_and_get_user_hash(request)
    user_album = ALBUM_DATA.get(user_hash, {})
    images = user_album.get(character_hash, [])
    sorted_images = sorted(images, key=lambda x: x.get('createdAt', 0), reverse=True)
    return jsonify(sorted_images)

@app.route('/api/album/<character_hash>', methods=['POST'])
def add_character_image(character_hash):
    user_hash = _verify_token_and_get_user_hash(request)
    data = request.json
    if not data or 'image_base64' not in data or 'generation_config' not in data:
        abort(400, description="Missing required data in request body.")
    
    try:
        new_metadata = _save_generated_image(
            user_hash, character_hash,
            data['image_base64'], data['generation_config']
        )
        return jsonify(new_metadata), 201
    except IOError as e:
        abort(500, description=str(e))

@app.route('/api/album/image/<image_id>', methods=['DELETE'])
def delete_character_image(image_id):
    user_hash = _verify_token_and_get_user_hash(request)
    if user_hash not in ALBUM_DATA: abort(404, description="User album not found.")

    found = False
    for char_hash, images in ALBUM_DATA[user_hash].items():
        image_to_remove = next((img for img in images if img['id'] == image_id), None)
        if image_to_remove:
            try:
                filename = os.path.basename(image_to_remove['url'])
                filepath = os.path.join(USER_IMAGES_DIR, filename)
                if os.path.exists(filepath): os.remove(filepath)
            except Exception as e:
                print(f"Could not delete file {filepath}: {e}")

            ALBUM_DATA[user_hash][char_hash] = [img for img in images if img['id'] != image_id]
            if not ALBUM_DATA[user_hash][char_hash]: del ALBUM_DATA[user_hash][char_hash]
            found = True
            break
            
    if not found: abort(404, description="Image ID not found in user's album.")
    save_json_data(ALBUM_DATA, ALBUM_DATA_FILENAME)
    return jsonify({"status": "success", "message": "Image deleted."})

# === API Endpoints for Direct ComfyUI Communication ===

@app.route('/api/comfyui/status', methods=['GET'])
def comfyui_status():
    try:
        target_address = request.args.get('server_address', COMFYUI_DEFAULT_ADDRESS).strip()
        comfy_api_client.get_queue_details_sync(target_address)
        return jsonify({"status": "ok", "message": f"ComfyUI is online at {target_address}."})
    except Exception as e:
        print(f"[ComfyUI] Status check failed: {e}")
        abort(503, description=f"ComfyUI is not reachable.")

@app.route('/api/comfyui/info', methods=['GET'])
def comfyui_info():
    _verify_token_and_get_user_hash(request)
    try:
        last_config = None
        character_hash = request.args.get('character_hash')
        user_hash = _get_user_hash_from_token(request.headers.get('Authorization').split(' ')[1])

        if COMFYUI_CONFIG:
            print("[ComfyUI Info] Using saved ComfyUI config (Priority 1)")
            last_config = COMFYUI_CONFIG
        elif character_hash:
            user_album = ALBUM_DATA.get(user_hash, {})
            images = user_album.get(character_hash, [])
            if images:
                sorted_images = sorted(images, key=lambda x: x.get('createdAt', 0), reverse=True)
                print(f"[ComfyUI Info] Using latest image config for {character_hash} (Priority 2)")
                last_config = sorted_images[0]['generationConfig']

        if not last_config:
            print("[ComfyUI Info] Using default config (Priority 3)")
            last_config = DEFAULT_CONFIG
            
        final_config = {**DEFAULT_CONFIG, **last_config}

        # Yuuka: Ưu tiên địa chỉ từ query param, nếu không có thì mới dùng config đã lưu
        target_address = request.args.get('server_address')
        if not target_address:
            target_address = final_config.get('server_address', COMFYUI_DEFAULT_ADDRESS).strip()
            if not target_address: target_address = COMFYUI_DEFAULT_ADDRESS
        
        print(f"[ComfyUI Info] Fetching choices from target server: {target_address}")
        all_choices = comfy_api_client.get_full_object_info(target_address)
        
        all_choices['sizes'] = [
            {"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"},
            {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"},
            {"name": "IL 1344x768", "value": "1344x768"},
            {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}
        ]
        all_choices['checkpoints'] = [{"name": c, "value": c} for c in all_choices.get('checkpoints', [])]
        all_choices['samplers'] = [{"name": s, "value": s} for s in all_choices.get('samplers', [])]
        all_choices['schedulers'] = [{"name": s, "value": s} for s in all_choices.get('schedulers', [])]
        
        return jsonify({"global_choices": all_choices, "last_config": final_config})
    except Exception as e:
        print(f"[ComfyUI] Info fetch failed: {e}")
        abort(500, description=f"Failed to get info from ComfyUI: {e}")

@app.route('/api/comfyui/config', methods=['POST'])
def save_comfyui_config():
    _verify_token_and_get_user_hash(request)
    global COMFYUI_CONFIG
    config_data = request.json
    if not config_data: abort(400, "Missing config data.")
    COMFYUI_CONFIG = config_data
    save_json_data(COMFYUI_CONFIG, COMFYUI_CONFIG_FILENAME)
    print("[Server] Saved new ComfyUI config.")
    return jsonify({"status": "success", "message": "ComfyUI config saved."})

@app.route('/api/comfyui/genart_sync', methods=['POST'])
def comfyui_genart_sync():
    _verify_token_and_get_user_hash(request)
    cfg_data = request.json
    if not cfg_data: abort(400, "Missing generation config.")
    
    client_id, seed = str(uuid.uuid4()), cfg_data.get("seed", uuid.uuid4().int % 10**10)
    try:
        target_address = cfg_data.get('server_address', COMFYUI_DEFAULT_ADDRESS).strip()
        if not target_address: target_address = COMFYUI_DEFAULT_ADDRESS
        print(f"[ComfyUI] Sending generation request to: {target_address}")

        # Yuuka: Logic mới - Lấy workflow gốc và thay thế SaveImage bằng node Base64
        workflow, original_output_node_id = workflow_builder.build_workflow(cfg_data, seed)
        vaedecode_node_id = workflow[original_output_node_id]["inputs"]["images"][0]
        del workflow[original_output_node_id]
        
        api_output_node_id = "999" # ID của node custom
        workflow[api_output_node_id] = {
            "inputs": {"images": [vaedecode_node_id, 0]},
            "class_type": "ImageToBase64_Yuuka"
        }

        prompt_info = comfy_api_client.queue_prompt(workflow, client_id, target_address)
        prompt_id = prompt_info['prompt_id']
        
        while True:
            history = comfy_api_client.get_history(prompt_id, target_address)
            if prompt_id in history and 'outputs' in history[prompt_id]:
                outputs = history[prompt_id]['outputs']
                # Yuuka: Chờ output của node custom thay vì node SaveImage
                if api_output_node_id in outputs and 'images_base64' in outputs[api_output_node_id]:
                    break
            time.sleep(1)

        # Yuuka: Lấy dữ liệu base64 trực tiếp từ history
        image_base64 = outputs[api_output_node_id]['images_base64'][0]
        
        return jsonify({
            "status": "success", "images_base64": [image_base64],
            "generation_config": cfg_data
        })
    except Exception as e:
        print(f"💥 [ComfyUI] Generation failed: {e}")
        return jsonify({"status": "error", "error_message": str(e)}), 500

# === API Endpoints for Scene Tab ===

@app.route('/api/scenes', methods=['GET'])
def get_scenes():
    user_hash = _verify_token_and_get_user_hash(request)
    user_scenes = SCENE_DATA.get(user_hash, [])
    return jsonify(user_scenes)

@app.route('/api/scenes', methods=['POST'])
def save_scenes():
    user_hash = _verify_token_and_get_user_hash(request)
    scenes = request.json
    if not isinstance(scenes, list): abort(400, "Invalid data format, expected a list of scenes.")
    SCENE_DATA[user_hash] = scenes
    save_json_data(SCENE_DATA, SCENE_DATA_FILENAME)
    return jsonify({"status": "success", "message": "Scenes saved."})

def _run_scene_generation_task(job, user_hash):
    global SCENE_GENERATION_STATE
    try:
        # Yuuka: Lấy tag group của đúng user đang thực hiện
        user_tag_groups = TAG_GROUPS_DATA.get(user_hash, [])
        all_groups_map = {g['id']: g for g in user_tag_groups}
        
        initial_stages_to_run = []
        total_images = 0
        for scene in job['scenes']:
            if scene.get('bypassed', False): continue
            quantity = scene.get('generationConfig', {}).get('quantity_per_stage', 1)
            for stage in scene.get('stages', []):
                if not stage.get('bypassed', False):
                    initial_stages_to_run.append({'stage_id': stage['id'], 'scene_id': scene['id']})
                    total_images += quantity
        
        with scene_generation_lock:
            SCENE_GENERATION_STATE['progress']['total'] = total_images

        last_config, images_generated_count = {}, 0
        
        for item_ids in initial_stages_to_run:
            fresh_scene_data = load_json_data(SCENE_DATA_FILENAME)
            user_scenes = fresh_scene_data.get(user_hash, [])
            scene = next((s for s in user_scenes if s.get('id') == item_ids['scene_id']), None)
            
            if not scene or scene.get('bypassed', False):
                print(f"[Scenes] Scene {item_ids['scene_id']} skipped: Not found or bypassed.")
                if scene:
                    with scene_generation_lock:
                        SCENE_GENERATION_STATE['progress']['total'] -= scene.get('generationConfig', {}).get('quantity_per_stage', 1)
                continue

            stage = next((st for st in scene.get('stages', []) if st.get('id') == item_ids['stage_id']), None)
            quantity = scene.get('generationConfig', {}).get('quantity_per_stage', 1)
            
            if not stage or stage.get('bypassed', False):
                print(f"[Scenes] Stage {item_ids['stage_id']} skipped: Not found or bypassed.")
                with scene_generation_lock:
                    SCENE_GENERATION_STATE['progress']['total'] -= quantity
                continue

            with scene_generation_lock:
                SCENE_GENERATION_STATE['current_scene_id'] = scene['id']
                SCENE_GENERATION_STATE['current_stage_id'] = stage['id']

            scene_config, prompt_parts = scene.get('generationConfig', {}), {'character': '', 'outfits': [], 'expression': [], 'action': [], 'context': []}
            category_mapping = { 'pose': 'action', 'outfits': 'outfits', 'view': 'expression', 'context': 'context' }
            char_name = None

            for category, group_ids in stage.get('tags', {}).items():
                cat_lower = category.lower()
                if cat_lower == 'character':
                    # Yuuka: Sửa lỗi - Luôn lấy ID cuối cùng trong list làm nhân vật chính.
                    if group_ids:
                        group = all_groups_map.get(group_ids[-1])
                        if group: char_name = group['tags'][0]
                else:
                    key = category_mapping.get(cat_lower, 'context')
                    for group_id in group_ids:
                        group = all_groups_map.get(group_id)
                        if group: prompt_parts[key].extend(group['tags'])
            
            if not char_name: 
                print(f"[Scenes] Stage {stage['id']} skipped: No character defined.")
                continue
            
            # Yuuka: Sửa lỗi tìm nhân vật có ký tự đặc biệt bằng cách so sánh tên trực tiếp
            char_name = str(char_name).replace(':', '').replace('  ', ' ').strip()
            found_char = next((c for c in ALL_CHARACTERS_LIST if str(c['name']).replace(':', '').replace('  ', ' ').strip() == char_name), None)
            if not found_char:
                print(f"[Scenes] Stage {stage['id']} skipped: Character '{char_name}' not found in the main list.")
                continue
            char_hash = found_char['hash']
            
            prompt_parts['character'] = char_name
            final_prompt = {k: ', '.join(v) if isinstance(v, list) else v for k, v in prompt_parts.items()}

            base_config = DEFAULT_CONFIG.copy()
            if ALBUM_DATA.get(user_hash, {}).get(char_hash):
                latest_image = sorted(ALBUM_DATA[user_hash][char_hash], key=lambda x: x.get('createdAt', 0), reverse=True)[0]
                base_config.update(latest_image['generationConfig'])
            elif COMFYUI_CONFIG: base_config.update(COMFYUI_CONFIG)
            
            for i in range(quantity):
                with scene_generation_lock:
                    if SCENE_GENERATION_STATE['cancel_requested']: print("[Scenes] Generation cancelled."); SCENE_GENERATION_STATE['progress']['message'] = "Đã huỷ."; break
                    images_generated_count += 1
                    SCENE_GENERATION_STATE['progress']['current'] = images_generated_count
                    SCENE_GENERATION_STATE['progress']['message'] = f"Đang xử lý ảnh {images_generated_count}/{SCENE_GENERATION_STATE['progress']['total']}..."

                gen_config = {**base_config, **scene_config, **last_config, **final_prompt}
                seed_value = uuid.uuid4().int % 10**10 if int(scene_config.get("seed", 0)) == 0 else int(gen_config.get("seed", 0))
                gen_config['seed'] = seed_value

                try:
                    print(f"[Scenes] Generating for character: {char_name}")
                    target_address = gen_config.get('server_address', COMFYUI_DEFAULT_ADDRESS).strip()
                    if not target_address: target_address = COMFYUI_DEFAULT_ADDRESS
                    print(f"[Scenes] Sending ComfyUI request to: {target_address}")
                    
                    # Yuuka: Logic mới - Thay thế node SaveImage
                    client_id = str(uuid.uuid4())
                    workflow, original_output_node_id = workflow_builder.build_workflow(gen_config, seed_value)
                    vaedecode_node_id = workflow[original_output_node_id]["inputs"]["images"][0]
                    del workflow[original_output_node_id]
                    api_output_node_id = "999"
                    workflow[api_output_node_id] = {
                        "inputs": {"images": [vaedecode_node_id, 0]},
                        "class_type": "ImageToBase64_Yuuka"
                    }

                    prompt_id = comfy_api_client.queue_prompt(workflow, client_id, target_address)['prompt_id']
                    
                    while True:
                        if SCENE_GENERATION_STATE['cancel_requested']: raise Exception("Cancelled during poll")
                        history = comfy_api_client.get_history(prompt_id, target_address)
                        if prompt_id in history and 'outputs' in history[prompt_id]:
                             if api_output_node_id in history[prompt_id]['outputs']:
                                break
                        time.sleep(1)

                    outputs = history[prompt_id]['outputs']
                    image_base64 = outputs[api_output_node_id]['images_base64'][0]
                    result = {"status": "success", "images_base64": [image_base64], "generation_config": gen_config}
                    
                    if result.get('status') == 'success' and result.get('images_base64'):
                        _save_generated_image(user_hash, char_hash, result['images_base64'][0], result['generation_config'])
                        print(f"[Scenes] Successfully generated and saved image for '{char_name}'.")
                        last_config = result['generation_config']
                    else: raise Exception(result.get('error_message', 'Unknown generation error'))
                except Exception as e:
                    print(f"💥 [Scenes] Generation failed for image {images_generated_count}: {e}")
                    with scene_generation_lock: SCENE_GENERATION_STATE['progress']['message'] = f"Lỗi ở ảnh {images_generated_count}: {e}"
                    time.sleep(3)
            with scene_generation_lock:
                if SCENE_GENERATION_STATE['cancel_requested']: break
    except Exception as e:
        print(f"💥 CRITICAL ERROR in Scene Generation Task: {e}")
        with scene_generation_lock: SCENE_GENERATION_STATE['progress']['message'] = f"Lỗi nghiêm trọng: {e}"
    finally:
        with scene_generation_lock:
            print("[Scenes] Generation process finished or stopped.")
            SCENE_GENERATION_STATE['is_running'] = False
            SCENE_GENERATION_STATE['cancel_requested'] = False
            SCENE_GENERATION_STATE['current_scene_id'] = None
            SCENE_GENERATION_STATE['current_stage_id'] = None
            if "Lỗi" not in SCENE_GENERATION_STATE['progress']['message'] and "huỷ" not in SCENE_GENERATION_STATE['progress']['message']:
                 SCENE_GENERATION_STATE['progress']['message'] = "Hoàn thành."

@app.route('/api/scenes/generate', methods=['POST'])
def scene_generate():
    with scene_generation_lock:
        if SCENE_GENERATION_STATE['is_running']: return jsonify({"status": "error", "message": "Generation is already in progress."}), 409
        user_hash = _verify_token_and_get_user_hash(request)
        job = request.json
        if not job or 'scenes' not in job: abort(400, "Invalid job data.")
        SCENE_GENERATION_STATE.update({
            "is_running": True, "cancel_requested": False, "current_job": job, "user_hash": user_hash,
            "current_scene_id": None, "current_stage_id": None,
            "progress": {"current": 0, "total": 0, "message": "Đang khởi tạo..."}
        })
        thread = threading.Thread(target=_run_scene_generation_task, args=(job, user_hash))
        thread.start()
        print("[Scenes] Generation thread started.")
        return jsonify({"status": "started", "message": "Scene generation process started."})

@app.route('/api/scenes/cancel', methods=['POST'])
def scene_cancel():
    _verify_token_and_get_user_hash(request)
    with scene_generation_lock:
        if SCENE_GENERATION_STATE['is_running']:
            SCENE_GENERATION_STATE['cancel_requested'] = True
            print("[Scenes] Cancellation requested.")
            return jsonify({"status": "success", "message": "Cancellation requested."})
    return jsonify({"status": "error", "message": "No generation process is running."}), 404

@app.route('/api/scenes/status', methods=['GET'])
def scene_status():
    _verify_token_and_get_user_hash(request)
    with scene_generation_lock:
        status_copy = SCENE_GENERATION_STATE.copy()
        status_copy['progress'] = SCENE_GENERATION_STATE['progress'].copy()
    return jsonify(status_copy)

# === Existing API Endpoints ===

@app.route('/api/tags')
def get_tags():
    return jsonify(TAG_PREDICTIONS)
    
@app.route('/api/tag_groups', methods=['GET'])
def get_tag_groups():
    user_hash = _verify_token_and_get_user_hash(request)
    user_groups_list = TAG_GROUPS_DATA.get(user_hash, [])
    
    all_groups, flat_map = {}, {g['id']: g for g in user_groups_list}
    for group in user_groups_list:
        category = group.get("category")
        if category:
            if category not in all_groups: all_groups[category] = []
            all_groups[category].append(group)
    return jsonify({"grouped": all_groups, "flat": flat_map})

@app.route('/api/tag_groups', methods=['POST'])
def create_tag_group():
    user_hash = _verify_token_and_get_user_hash(request)
    data = request.json
    if not data or 'name' not in data or 'category' not in data or 'tags' not in data:
        abort(400, "Missing required fields: name, category, tags.")
    
    user_groups = TAG_GROUPS_DATA.setdefault(user_hash, [])
    
    for group in user_groups:
        if group.get('category') == data['category'] and group.get('name') == data['name']:
            abort(409, f"Tag group with name '{data['name']}' already exists in category '{data['category']}'.")
            
    new_group = {
        "id": str(uuid.uuid4()), "name": data['name'], "category": data['category'], "tags": data['tags'],
        "score": data.get('score', 0), "is_nsfw": data.get('is_nsfw', False)
    }
    user_groups.append(new_group)
    save_json_data(TAG_GROUPS_DATA, TAG_GROUPS_FILENAME)
    return jsonify(new_group), 201

@app.route('/api/tag_groups/<group_id>', methods=['PUT'])
def update_tag_group(group_id):
    user_hash = _verify_token_and_get_user_hash(request)
    data = request.json
    if not data or 'name' not in data or 'tags' not in data:
        abort(400, "Missing required fields: name, tags.")
        
    user_groups = TAG_GROUPS_DATA.get(user_hash, [])
    group_to_update = next((g for g in user_groups if g.get('id') == group_id), None)
    
    if not group_to_update: abort(404, f"Tag group with id '{group_id}' not found.")
    
    for group in user_groups:
        if group.get('id') != group_id and group.get('category') == group_to_update.get('category') and group.get('name') == data['name']:
            abort(409, f"Tag group with name '{data['name']}' already exists in category '{group_to_update.get('category')}'.")
            
    group_to_update.update({'name': data['name'], 'tags': data['tags']})
    save_json_data(TAG_GROUPS_DATA, TAG_GROUPS_FILENAME)
    return jsonify(group_to_update)

@app.route('/api/tag_groups/<group_id>', methods=['DELETE'])
def delete_tag_group(group_id):
    user_hash = _verify_token_and_get_user_hash(request)
    global SCENE_DATA
    
    user_groups = TAG_GROUPS_DATA.get(user_hash, [])
    group_to_delete = next((g for g in user_groups if g.get('id') == group_id), None)
    
    if not group_to_delete: abort(404, f"Tag group with id '{group_id}' not found.")
    
    TAG_GROUPS_DATA[user_hash] = [g for g in user_groups if g.get('id') != group_id]
    
    # Yuuka: Vẫn quét tất cả scene data để xoá reference, an toàn hơn.
    for user_hash_in_scenes, scenes in SCENE_DATA.items():
        for scene in scenes:
            for stage in scene.get('stages', []):
                if 'tags' in stage:
                    for category, group_ids in stage['tags'].items():
                        if isinstance(group_ids, list) and group_id in group_ids:
                            stage['tags'][category] = [gid for gid in group_ids if gid != group_id]
                            
    save_json_data(TAG_GROUPS_DATA, TAG_GROUPS_FILENAME)
    save_json_data(SCENE_DATA, SCENE_DATA_FILENAME)
    return jsonify({"status": "success", "message": f"Tag group '{group_to_delete.get('name')}' and all its references have been deleted."})

@app.route('/api/characters')
def get_characters():
    filtered_list = [char for char in ALL_CHARACTERS_LIST if request.args.get('search', '').strip().lower() in char['name'].lower()] if request.args.get('search') else ALL_CHARACTERS_LIST
    try: page, limit = int(request.args.get('page', 1)), int(request.args.get('limit', 100000))
    except ValueError: return jsonify({"error": "Parameters 'page' and 'limit' must be integers."}), 400
    start_index, end_index = (page - 1) * limit, page * limit
    return jsonify({"characters": filtered_list[start_index:end_index], "total": len(filtered_list), "has_more": end_index < len(filtered_list)})

@app.route('/api/characters/by_hashes', methods=['POST'])
def get_characters_by_hashes():
    hashes = request.json.get('hashes', [])
    if not isinstance(hashes, list): abort(400, "Invalid input: 'hashes' must be a list.")
    results = [ALL_CHARACTERS_DICT.get(h) for h in hashes if ALL_CHARACTERS_DICT.get(h)]
    return jsonify(results)

@app.route('/image/<md5_hash>')
def get_image(md5_hash):
    base64_gzipped_webp = THUMBNAILS_DATA_DICT.get(md5_hash)
    if not base64_gzipped_webp: abort(404, "Image not found.")
    try:
        webp_data = gzip.decompress(base64.b64decode(base64_gzipped_webp))
        return Response(webp_data, mimetype='image/webp')
    except Exception as e:
        print(f"Error decoding image for hash {md5_hash}: {e}")
        abort(500, "Error processing image.")

# === API Endpoints for Server Control ===
def _shutdown_server():
    print("Yuuka: Nhận được lệnh tắt server. Tạm biệt senpai!")
    # Yuuka: Gửi tín hiệu SIGINT (giống Ctrl+C) để tắt tiến trình.
    os.kill(os.getpid(), signal.SIGINT)

@app.route('/api/server/shutdown', methods=['POST'])
def server_shutdown():
    _verify_token_and_get_user_hash(request)
    print("[Server] Lệnh tắt server đã được nhận từ client.")
    # Yuuka: Sử dụng Timer để đảm bảo client nhận được phản hồi trước khi server tắt.
    threading.Timer(0.5, _shutdown_server).start()
    return jsonify({"status": "success", "message": "Server is shutting down."})


# === Run Server ===
if __name__ == '__main__':
    load_and_prepare_data()
    print("\n✅ Server is ready!")
    print("   - Local access at: http://127.0.0.1:5000")
    print("   - To access from other devices on the same network, use this machine's IP address.")
    app.run(host='0.0.0.0', debug=True, port=5000)
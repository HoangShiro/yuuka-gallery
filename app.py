# --- MODIFIED FILE: app.py ---
import os
import signal
import threading
import time # Yuuka: Thêm time để tạo version cho cache
import datetime # Yuuka: uptime tracking v1.0
import atexit
from flask import Flask, render_template, jsonify, send_from_directory, abort, Response, request
from flask_sock import Sock # Yuuka: PvP game feature v1.0 - Thư viện cho WebSocket

from core.plugin_manager import PluginManager
from core.data_manager import DataManager

# --- Flask App Initialization ---
app = Flask(__name__)
sock = Sock(app) # Yuuka: PvP game feature v1.0 - Khởi tạo Sock
# Yuuka: Tắt cache phía server khi debug
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0 

# --- Core Services Initialization ---
data_manager = DataManager('data_cache')
plugin_manager = PluginManager('plugins', app, data_manager)
atexit.register(lambda: _perform_graceful_shutdown('atexit'))

def _handle_termination_signal(signum, frame):
    label_map = {}
    if hasattr(signal, 'SIGINT'):
        label_map[signal.SIGINT] = 'SIGINT'
    if hasattr(signal, 'SIGTERM'):
        label_map[signal.SIGTERM] = 'SIGTERM'
    if hasattr(signal, 'SIGBREAK'):
        label_map[signal.SIGBREAK] = 'SIGBREAK'

    label = label_map.get(signum, f'signal {signum}')
    _perform_graceful_shutdown(label)
    try:
        signal.signal(signum, signal.SIG_DFL)
    except Exception:
        pass
    os.kill(os.getpid(), signum)

signal.signal(signal.SIGINT, _handle_termination_signal)
if hasattr(signal, 'SIGTERM'):
    signal.signal(signal.SIGTERM, _handle_termination_signal)
if hasattr(signal, 'SIGBREAK'):
    try:
        signal.signal(signal.SIGBREAK, _handle_termination_signal)
    except Exception:
        pass

# === Yuuka: Uptime Tracking v1.0 ===
server_start_time = time.time()
uptime_thread_stop_event = threading.Event()
_shutdown_executed = False

def _save_current_uptime(is_final_save=False):
    """Hàm nội bộ để đọc, tính toán và lưu thời gian hoạt động của server."""
    try:
        now = datetime.datetime.now()
        current_month = now.month
        
        saved_data = data_manager.read_json('server_info.json', default_value={
            'total_uptime': 0,
            'month_server_uptime': 0,
            'last_saved_timestamp': server_start_time,
            'last_saved_month': current_month
        })

        # Reset uptime tháng nếu đã sang tháng mới
        if current_month != saved_data.get('last_saved_month'):
            print(f"[Uptime] New month detected. Resetting monthly uptime.")
            saved_data['month_server_uptime'] = 0
        
        # Tính toán thời gian trôi qua kể từ lần lưu cuối
        time_since_last_save = time.time() - saved_data.get('last_saved_timestamp', server_start_time)

        # Cập nhật dữ liệu
        saved_data['total_uptime'] += time_since_last_save
        saved_data['month_server_uptime'] += time_since_last_save
        saved_data['last_saved_timestamp'] = time.time()
        saved_data['last_saved_month'] = current_month
        
        data_manager.save_json(saved_data, 'server_info.json')
        if not is_final_save:
            print(f"[Uptime] Server uptime saved successfully. Monthly uptime: {saved_data['month_server_uptime']:.2f}s")
        else:
            print(f"[Uptime] Final server uptime saved.")

    except Exception as e:
        print(f"💥 [Uptime] Error saving server uptime: {e}")


def _uptime_tracking_thread():
    """Luồng nền chạy để lưu uptime mỗi giờ."""
    print("[Uptime] Uptime tracking thread started.")
    while not uptime_thread_stop_event.wait(3600): # Chờ 1 giờ hoặc cho đến khi có tín hiệu dừng
        _save_current_uptime()
    print("[Uptime] Uptime tracking thread stopped.")


# === Core API Routes ===

@app.route('/')
def index():
    """
    Render trang chính, tự động "tiêm" các file JS/CSS của plugin vào template.
    Yuuka: Thêm cache_version và danh sách ID plugin đang hoạt động.
    """
    cache_version = int(time.time())
    active_plugin_ids = [p.id for p in plugin_manager.get_active_plugins()]
    return render_template(
        'index.html', 
        plugin_assets=plugin_manager.get_frontend_assets(),
        cache_version=cache_version,
        active_plugin_ids=active_plugin_ids
    )

@app.route('/plugins/<plugin_name>/static/<path:filename>')
def serve_plugin_static(plugin_name, filename):
    """
    Route đặc biệt để phục vụ các file tĩnh (js, css) từ bên trong thư mục của một plugin.
    Ví dụ: /plugins/album/static/album.js
    """
    plugin = plugin_manager.get_plugin_by_id(plugin_name)
    if plugin and 'static_folder' in plugin.metadata:
        static_folder = os.path.join(plugin.path, plugin.metadata['static_folder'])
        if os.path.exists(os.path.join(static_folder, filename)):
            return send_from_directory(static_folder, filename)
    abort(404)

@app.route('/api/plugins/active')
def get_active_plugins_ui():
    """
    Cung cấp thông tin UI (tab, component) cho frontend để render động.
    """
    return jsonify(plugin_manager.get_ui_components())

# --- Yuuka: Các route tiện ích cốt lõi mà mọi plugin đều có thể cần ---

# Yuuka: auth rework v1.0 - Route giờ chỉ dùng để tạo token mới
@app.route('/api/auth/token', methods=['POST'])
def handle_generate_token():
    """Tạo một token mới."""
    try:
        return plugin_manager.core_api.generate_token()
    except Exception as e:
        # Yuuka: auth rework v1.0 - Trả về lỗi nếu waitlist đầy
        return jsonify({"error": str(e)}), 429 # 429 Too Many Requests

@app.route('/api/auth/login', methods=['POST'])
def handle_auth_login():
    """Xử lý đăng nhập bằng token đã có."""
    token = request.json.get('token')
    if not token:
        abort(400, "Missing 'token' in request body.")
    return plugin_manager.core_api.login_with_token(token)

@app.route('/api/auth/logout', methods=['POST'])
def handle_auth_logout():
    """Xử lý đăng xuất.""" # Yuuka: auth rework v1.0 - Logic server-side không còn cần thiết
    return plugin_manager.core_api.logout()

@app.route('/api/characters')
def get_characters():
    """API lấy danh sách tất cả nhân vật đã được xử lý."""
    return jsonify({ "characters": plugin_manager.core_api.get_all_characters_list() })

@app.route('/api/characters/by_hashes', methods=['POST'])
def get_characters_by_hashes():
    """Lấy thông tin chi tiết của các nhân vật dựa trên danh sách hash."""
    hashes = request.json.get('hashes', [])
    if not isinstance(hashes, list):
        abort(400, "Invalid input: 'hashes' must be a list.")
    
    results = [plugin_manager.core_api.get_character_by_hash(h) for h in hashes]
    results = [res for res in results if res is not None]
    return jsonify(results)


@app.route('/image/<md5_hash>')
def get_thumbnail_image(md5_hash):
    """Phục vụ ảnh thumbnail đã được nén và mã hóa."""
    image_data, mimetype = plugin_manager.core_api.get_thumbnail_image_data(md5_hash)
    if image_data:
        return Response(image_data, mimetype=mimetype)
    abort(404)

# Yuuka: new image paths v1.0 - Tách route để phục vụ ảnh từ các thư mục con
@app.route('/user_image/imgs/<filename>')
def get_user_main_image(filename):
    """Phục vụ ảnh gốc do người dùng tạo ra, tự động giải mã."""
    image_data, mimetype = plugin_manager.core_api.get_user_image_data('imgs', filename)
    if image_data:
        return Response(image_data, mimetype=mimetype)
    abort(404)

@app.route('/user_image/pv_imgs/<filename>')
def get_user_preview_image(filename):
    """Phục vụ ảnh preview do người dùng tạo ra, tự động giải mã."""
    image_data, mimetype = plugin_manager.core_api.get_user_image_data('pv_imgs', filename)
    if image_data:
        return Response(image_data, mimetype=mimetype)
    abort(404)


@app.route('/api/tags')
def get_tags():
    """API lấy danh sách các tag đã được sắp xếp để dùng cho tiên đoán."""
    return jsonify(plugin_manager.core_api.get_tag_predictions())

@app.route('/api/comfyui/status', methods=['GET'])
def comfyui_status():
    """API chung để kiểm tra xem một server ComfyUI có đang hoạt động không."""
    try:
        target_address = request.args.get('server_address', '127.0.0.1:8888').strip()
        plugin_manager.core_api.comfy_api_client.get_queue_details_sync(target_address)
        return jsonify({"status": "ok", "message": f"ComfyUI is online at {target_address}."})
    except Exception as e:
        print(f"[Core ComfyUI Check] Status check failed: {e}")
        abort(503, description=f"ComfyUI is not reachable.")


# === YUUKA: CORE SERVICES API (Image & Generation) ===

@app.route('/api/core/images', methods=['GET'])
def get_all_user_images():
    """Lấy tất cả ảnh của người dùng, sắp xếp theo ngày tạo."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        images = plugin_manager.core_api.image_service.get_all_user_images(user_hash)
        return jsonify(images)
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route('/api/core/images/by_character/<character_hash>', methods=['GET'])
def get_character_images(character_hash):
    """Lấy tất cả ảnh của một nhân vật cụ thể."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        images = plugin_manager.core_api.image_service.get_images_by_character(user_hash, character_hash)
        return jsonify(images)
    except Exception as e:
        return jsonify({"error": str(e)}), 401
        
@app.route('/api/core/images/<image_id>', methods=['DELETE'])
def delete_user_image(image_id):
    """Xóa một ảnh của người dùng."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        success = plugin_manager.core_api.image_service.delete_image_by_id(user_hash, image_id)
        if success:
            return jsonify({"status": "success"})
        else:
            abort(404, "Image not found or deletion failed.")
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route('/api/core/generate', methods=['POST'])
def start_generation():
    """Bắt đầu một tác vụ tạo ảnh mới."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        data = request.json
        character_hash = data.get('character_hash')
        gen_config = data.get('generation_config')
        context = data.get('context', {}) # Plugin có thể gửi thêm thông tin
        if not character_hash or not gen_config:
            abort(400, "Missing character_hash or generation_config.")
        
        task_id, message = plugin_manager.core_api.generation_service.start_generation_task(
            user_hash, character_hash, gen_config, context
        )
        if task_id:
            return jsonify({"status": "started", "task_id": task_id, "message": message})
        else:
            return jsonify({"error": message}), 429 # 429: Too Many Requests
            
    except Exception as e:
        return jsonify({"error": str(e)}), 401


@app.route('/api/core/generate/alpha', methods=['POST'])
def start_generation_alpha():
    """Bắt đầu một tác vụ tạo ảnh alpha (lưu metadata với Alpha=True)."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        data = request.json
        character_hash = data.get('character_hash')
        gen_config = data.get('generation_config')
        context = data.get('context', {})
        if not isinstance(context, dict):
            context = {}
        context['Alpha'] = True

        # Mark config so WorkflowBuilder can select Alpha templates.
        if isinstance(gen_config, dict):
            gen_config['Alpha'] = True

        if not character_hash or not gen_config:
            abort(400, "Missing character_hash or generation_config.")

        task_id, message = plugin_manager.core_api.generation_service.start_generation_task(
            user_hash, character_hash, gen_config, context
        )
        if task_id:
            return jsonify({"status": "started", "task_id": task_id, "message": message})
        return jsonify({"error": message}), 429
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route('/api/core/generate/status', methods=['GET'])
def get_generation_status():
    """Lấy trạng thái của tất cả các tác vụ đang chạy."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        status = plugin_manager.core_api.generation_service.get_user_status(user_hash)
        return jsonify(status)
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route('/api/core/generate/cancel', methods=['POST'])
def cancel_generation():
    """Hủy một tác vụ đang chạy."""
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()
        task_id = request.json.get('task_id')
        if not task_id: abort(400, "Missing task_id.")

        success = plugin_manager.core_api.generation_service.request_cancellation(user_hash, task_id)
        if success:
            return jsonify({"status": "success", "message": "Đã yêu cầu hủy."})
        else:
            return jsonify({"error": "Không tìm thấy tác vụ đang chạy để hủy."}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 401


# === Yuuka: I2V (Image-to-Video) Generation Route ===
@app.route('/api/core/generate/i2v', methods=['POST'])
def start_i2v_generation():
    """Bắt đầu tác vụ tạo video I2V (DaSiWa WAN2)."""
    import base64 as b64mod
    from io import BytesIO
    from PIL import Image as PILImage
    try:
        user_hash = plugin_manager.core_api.verify_token_and_get_user_hash()

        # --- Parse request ---
        # Hỗ trợ cả multipart/form-data (file upload) và JSON (base64)
        character_hash = request.form.get('character_hash') or (request.json or {}).get('character_hash')
        if not character_hash:
            abort(400, "Missing character_hash.")

        # Parse config from form-data or JSON
        gen_config = {}
        config_str = request.form.get('generation_config')
        if config_str:
            import json as json_mod
            gen_config = json_mod.loads(config_str)
        elif request.json:
            gen_config = request.json.get('generation_config', {})
        if not isinstance(gen_config, dict):
            gen_config = {}

        # Required: prompt
        prompt = gen_config.get('prompt', '')
        if not prompt:
            abort(400, "Missing 'prompt' in generation_config.")

        # Server address
        server_address = gen_config.get('server_address', '127.0.0.1:8888')

        # --- Handle first frame image (required) ---
        first_frame_bytes = None
        if 'first_frame_image' in request.files:
            first_frame_bytes = request.files['first_frame_image'].read()
        elif gen_config.get('first_frame_image_base64'):
            first_frame_bytes = b64mod.b64decode(gen_config['first_frame_image_base64'])
        if not first_frame_bytes:
            abort(400, "Missing 'first_frame_image' (file upload or base64).")

        # --- Handle last frame image (optional, defaults to first frame) ---
        last_frame_bytes = None
        if 'last_frame_image' in request.files:
            last_frame_bytes = request.files['last_frame_image'].read()
        elif gen_config.get('last_frame_image_base64'):
            last_frame_bytes = b64mod.b64decode(gen_config['last_frame_image_base64'])

        # --- Detect image dimensions from first frame ---
        try:
            img = PILImage.open(BytesIO(first_frame_bytes))
            img_width, img_height = img.size
        except Exception:
            img_width, img_height = 768, 1024

        # --- Upload images to ComfyUI ---
        import uuid as uuid_mod
        first_frame_name = f"i2v_first_{uuid_mod.uuid4().hex[:8]}.png"
        try:
            first_frame_name = plugin_manager.core_api.comfy_api_client.upload_image_bytes(
                first_frame_bytes, first_frame_name, server_address
            )
        except ConnectionError as err:
            abort(503, description=f"Cannot upload first frame to ComfyUI: {err}")

        if last_frame_bytes:
            last_frame_name = f"i2v_last_{uuid_mod.uuid4().hex[:8]}.png"
            try:
                last_frame_name = plugin_manager.core_api.comfy_api_client.upload_image_bytes(
                    last_frame_bytes, last_frame_name, server_address
                )
            except ConnectionError as err:
                abort(503, description=f"Cannot upload last frame to ComfyUI: {err}")
        else:
            last_frame_name = first_frame_name

        # --- Build generation config ---
        gen_config['_workflow_type'] = 'dasiwa_wan2_i2v'
        gen_config['_first_frame_image_name'] = first_frame_name
        gen_config['_last_frame_image_name'] = last_frame_name
        gen_config['_input_image_width'] = img_width
        gen_config['_input_image_height'] = img_height
        gen_config['server_address'] = server_address

        context_raw = request.form.get('context') or (request.json or {}).get('context', {})
        if isinstance(context_raw, str):
            try:
                import json as json_mod2
                context_raw = json_mod2.loads(context_raw)
            except Exception:
                context_raw = {}
        context = context_raw if isinstance(context_raw, dict) else {}

        task_id, message = plugin_manager.core_api.generation_service.start_generation_task(
            user_hash, character_hash, gen_config, context
        )
        if task_id:
            return jsonify({"status": "started", "task_id": task_id, "message": message})
        return jsonify({"error": message}), 429

    except Exception as e:
        return jsonify({"error": str(e)}), 401


# === Yuuka: Game Service (WebSocket) v1.0 ===
@sock.route('/ws/game')
def game_websocket(ws):
    """Endpoint WebSocket để xử lý các kết nối game PvP."""
    game_service = plugin_manager.core_api.game_service
    game_service.handle_connect(ws)
    try:
        while True:
            message = ws.receive()
            if message:
                game_service.handle_message(ws, message)
    except Exception as e:
        # Lỗi xảy ra thường là do client đã ngắt kết nối
        # print(f"[WebSocket] Connection error: {e}")
        pass
    finally:
        game_service.handle_disconnect(ws)


def _perform_graceful_shutdown(reason: str = None):
    global _shutdown_executed
    if _shutdown_executed:
        return

    _shutdown_executed = True
    if reason:
        print(f"[Server] Graceful shutdown requested ({reason}).")
    else:
        print("[Server] Graceful shutdown requested.")

    try:
        uptime_thread_stop_event.set()
    except Exception:
        pass

    try:
        _save_current_uptime(is_final_save=True)
    except Exception as uptime_err:
        print(f"[Server] Warning while saving uptime during shutdown: {uptime_err}")

    try:
        plugin_manager.shutdown_all()
    except Exception as plugin_err:
        print(f"[Server] Warning while shutting down plugins: {plugin_err}")

@app.route('/api/server/background_tasks', methods=['GET'])
def get_background_task_status_endpoint():
    """Return background task status for debugging (requires authentication)."""
    try:
        plugin_manager.core_api.verify_token_and_get_user_hash()
    except Exception as auth_error:
        abort(401, description=str(auth_error))

    plugin_id = request.args.get('plugin_id')
    return jsonify(plugin_manager.get_background_task_status(plugin_id))
# === Server Control ===
def _shutdown_server():
    print('Yuuka: Nhan duoc lenh tat server. Tam biet senpai!')
    _perform_graceful_shutdown('timer')
    os.kill(os.getpid(), signal.SIGINT)

@app.route('/api/server/shutdown', methods=['POST'])
def server_shutdown():
    """API to stop the server safely."""
    try:
        plugin_manager.core_api.verify_token_and_get_user_hash()
        print('[Server] Shutdown command received from client.')
        _perform_graceful_shutdown('api')
        threading.Timer(0.5, _shutdown_server).start()
        return jsonify({"status": "success", "message": "Server is shutting down."})
    except Exception as e:
        abort(401, description=str(e))


# === YUUKA: NEW SERVER INITIALIZATION FUNCTION v1.0 ===
def initialize_server():
    """Tải dữ liệu lõi và các plugin."""
    plugin_manager.core_api.load_core_data()
    plugin_manager.load_plugins()
    
    # Yuuka: uptime tracking v1.0 - Khởi động luồng theo dõi
    uptime_thread = threading.Thread(target=_uptime_tracking_thread, daemon=True)
    uptime_thread.start()

    print("\n✅ Yuuka's Server V5.7 is ready!")
    print(f"   - Loaded {len(plugin_manager.get_active_plugins())} plugins.")
    print("   - Local access at: http://127.0.0.1:5000")
    print("   - To access from other devices on the same network, use this machine's IP address.")


# === Run Server ===
if __name__ == '__main__':
    initialize_server() # Yuuka: main.py compatibility v1.0
    # Yuuka: Chú ý - app.run() sẽ không hoạt động tốt với WebSocket trong production.
    # Senpai nên cân nhắc dùng một server WSGI như Gunicorn với gevent.
    # Ví dụ: gunicorn --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 app:app
    app.run(host='127.0.0.1', debug=False, port=5000)






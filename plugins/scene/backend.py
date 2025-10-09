# --- FILE: plugins/scene/backend.py ---
import uuid
import time
import threading
import websocket # Yuuka: Thêm thư viện websocket
import json      # Yuuka: Thêm thư viện json

from flask import Blueprint, jsonify, request, abort

class ScenePlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('scene', __name__)
        
        self.SCENE_DATA_FILENAME = "scene_data.json"
        self.TAG_GROUPS_FILENAME = "tags_group.json"

        self.scene_run_state = { "is_running": False, "cancel_requested": False }
        self.scene_run_lock = threading.Lock()
        
        self.register_routes()

    def register_routes(self):
        @self.blueprint.route('', methods=['GET', 'POST'])
        def handle_scenes():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            if request.method == 'GET':
                scenes = self.core_api.data_manager.load_user_data(self.SCENE_DATA_FILENAME, user_hash, default_value=[])
                return jsonify(scenes)
            if request.method == 'POST':
                scenes = request.json
                if not isinstance(scenes, list): abort(400, "Invalid data format.")
                self.core_api.data_manager.save_user_data(scenes, self.SCENE_DATA_FILENAME, user_hash)
                return jsonify({"status": "success"})

        @self.blueprint.route('/tag_groups', methods=['GET'])
        def get_tag_groups():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            user_groups = self.core_api.data_manager.load_user_data(self.TAG_GROUPS_FILENAME, user_hash, default_value=[], obfuscated=True)
            all_groups, flat_map = {}, {g['id']: g for g in user_groups}
            for group in user_groups:
                category = group.get("category")
                if category:
                    if category not in all_groups: all_groups[category] = []
                    all_groups[category].append(group)
            return jsonify({"grouped": all_groups, "flat": flat_map})

        @self.blueprint.route('/tag_groups', methods=['POST'])
        def create_tag_group():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json
            if not all(k in data for k in ['name', 'category', 'tags']): abort(400, "Missing fields.")
            user_groups = self.core_api.data_manager.load_user_data(self.TAG_GROUPS_FILENAME, user_hash, default_value=[], obfuscated=True)
            if any(g.get('category') == data['category'] and g.get('name') == data['name'] for g in user_groups):
                abort(409, f"Tag group '{data['name']}' đã tồn tại trong category '{data['category']}'.")
            new_group = {"id": str(uuid.uuid4()), "name": data['name'], "category": data['category'], "tags": data['tags']}
            user_groups.append(new_group)
            self.core_api.data_manager.save_user_data(user_groups, self.TAG_GROUPS_FILENAME, user_hash, obfuscated=True)
            return jsonify(new_group), 201

        @self.blueprint.route('/tag_groups/<group_id>', methods=['PUT', 'DELETE'])
        def handle_tag_group(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            user_groups = self.core_api.data_manager.load_user_data(self.TAG_GROUPS_FILENAME, user_hash, default_value=[], obfuscated=True)
            group_to_update = next((g for g in user_groups if g.get('id') == group_id), None)
            if not group_to_update: abort(404, "Tag group not found.")
            if request.method == 'PUT':
                data = request.json
                if not all(k in data for k in ['name', 'tags']): abort(400, "Missing required fields: name, tags.")
                if any(g.get('id') != group_id and g.get('category') == group_to_update.get('category') and g.get('name') == data['name'] for g in user_groups):
                    abort(409, f"Tag group with name '{data['name']}' already exists in category '{group_to_update.get('category')}'.")
                group_to_update.update({'name': data['name'], 'tags': data['tags']})
                self.core_api.data_manager.save_user_data(user_groups, self.TAG_GROUPS_FILENAME, user_hash, obfuscated=True)
                return jsonify(group_to_update)
            if request.method == 'DELETE':
                user_groups_after_delete = [g for g in user_groups if g.get('id') != group_id]
                self.core_api.data_manager.save_user_data(user_groups_after_delete, self.TAG_GROUPS_FILENAME, user_hash, obfuscated=True)
                scenes = self.core_api.data_manager.load_user_data(self.SCENE_DATA_FILENAME, user_hash, default_value=[])
                for scene in scenes:
                    for stage in scene.get('stages', []):
                        if 'tags' in stage:
                            for category, group_ids in stage['tags'].items():
                                if isinstance(group_ids, list) and group_id in group_ids:
                                    stage['tags'][category] = [gid for gid in group_ids if gid != group_id]
                self.core_api.data_manager.save_user_data(scenes, self.SCENE_DATA_FILENAME, user_hash)
                return jsonify({"status": "success"})

        @self.blueprint.route('/generate', methods=['POST'])
        def scene_generate():
            with self.scene_run_lock:
                if self.scene_run_state['is_running']:
                    return jsonify({"status": "error", "message": "In progress."}), 409
                
                user_hash = self.core_api.verify_token_and_get_user_hash()
                job = request.json
                if not job or 'scenes' not in job: abort(400, "Invalid job data.")
                
                self.scene_run_state.update({ "is_running": True, "cancel_requested": False })
                
                thread = threading.Thread(target=self._run_scene_generation_task, args=(job, user_hash))
                thread.start()
                return jsonify({"status": "started"})

        @self.blueprint.route('/cancel', methods=['POST'])
        def scene_cancel():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            cancelled_count = 0
            with self.scene_run_lock:
                self.scene_run_state['cancel_requested'] = True
                
            all_status = self.core_api.generation_service.get_user_status(user_hash)
            for task_id, task_data in all_status.get("tasks", {}).items():
                if task_data.get("context", {}).get("source") == "scene":
                    if self.core_api.generation_service.request_cancellation(user_hash, task_id):
                        cancelled_count += 1
            
            return jsonify({"status": "success", "message": f"Requested cancellation for {cancelled_count} tasks."})

        @self.blueprint.route('/status', methods=['GET'])
        def scene_status():
            with self.scene_run_lock:
                return jsonify(self.scene_run_state)
        
        @self.blueprint.route('/comfyui/info', methods=['GET'])
        def comfyui_info():
            # Yuuka: scene decouple v1.0
            self.core_api.verify_token_and_get_user_hash()
            server_address = request.args.get('server_address', '127.0.0.1:8888').strip()
            try:
                all_choices = self.core_api.comfy_api_client.get_full_object_info(server_address)
                all_choices['sizes'] = [{"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"}, {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"}, {"name": "IL 1344x768", "value": "1344x768"}, {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}]
                all_choices['checkpoints'] = [{"name": c, "value": c} for c in all_choices.get('checkpoints', [])]
                all_choices['samplers'] = [{"name": s, "value": s} for s in all_choices.get('samplers', [])]
                all_choices['schedulers'] = [{"name": s, "value": s} for s in all_choices.get('schedulers', [])]
                return jsonify({"global_choices": all_choices, "last_config": {}})
            except Exception as e:
                abort(500, description=f"Failed to get info from ComfyUI: {e}")

    def _find_next_stage(self, user_scenes, last_completed_stage_id): # Yuuka: live-editing fix v2.0
        """
        Tìm scene và stage hợp lệ tiếp theo để chạy, dựa trên dữ liệu scene mới nhất.
        Hàm này có khả năng chống lỗi khi người dùng chỉnh sửa scene trong lúc đang chạy.
        """
        # Nếu chưa có stage nào hoàn thành, bắt đầu tìm từ đầu.
        found_last_completed = not last_completed_stage_id

        for scene in user_scenes:
            if scene.get('bypassed'):
                continue

            for stage in scene.get('stages', []):
                if found_last_completed:
                    # Đây là stage đầu tiên chúng ta gặp sau stage đã hoàn thành (hoặc từ đầu).
                    # Nếu nó không bị bỏ qua, đây chính là mục tiêu.
                    if not stage.get('bypassed'):
                        return scene, stage
                elif stage['id'] == last_completed_stage_id:
                    # Đã tìm thấy stage vừa hoàn thành.
                    # Đánh dấu để lần lặp tiếp theo sẽ chọn stage kế tiếp.
                    found_last_completed = True
        
        # Nếu duyệt hết mà không tìm thấy, nghĩa là đã hoàn thành.
        return None, None

    def _run_scene_generation_task(self, job, user_hash):
        try:
            user_tag_groups_raw = self.core_api.data_manager.load_user_data(self.TAG_GROUPS_FILENAME, user_hash, [], obfuscated=True)
            all_groups_map = {g['id']: g for g in user_tag_groups_raw}
            last_completed_scene_id, last_completed_stage_id = None, None
            
            while True:
                with self.scene_run_lock:
                    if self.scene_run_state['cancel_requested']: raise InterruptedError("Scene run cancelled.")
                
                all_user_scenes = self.core_api.data_manager.load_user_data(self.SCENE_DATA_FILENAME, user_hash, default_value=[])
                scene, stage = self._find_next_stage(all_user_scenes, last_completed_stage_id) # Yuuka: live-editing fix v2.1
                if not scene or not stage: break
                
                scene_config, prompt_parts, char_name = scene.get('generationConfig', {}), {'outfits': [], 'expression': [], 'action': [], 'context': []}, None
                for category, group_ids in stage.get('tags', {}).items():
                    if not group_ids: continue
                    if category.lower() == 'character':
                        if group := all_groups_map.get(group_ids[-1]): char_name = group['tags'][0]
                    else:
                        key = {'pose': 'action', 'outfits': 'outfits', 'view': 'expression'}.get(category.lower(), 'context')
                        for group_id in group_ids:
                            if group := all_groups_map.get(group_id): prompt_parts[key].extend(group['tags'])
                
                if not char_name:
                    last_completed_scene_id, last_completed_stage_id = scene['id'], stage['id']
                    continue
                
                clean_name = str(char_name).replace(':', '').replace('  ', ' ').strip()
                char_info = next((c for c in self.core_api.get_all_characters_list() if str(c['name']).replace(':', '').replace('  ', ' ').strip() == clean_name), None)
                if not char_info:
                    last_completed_scene_id, last_completed_stage_id = scene['id'], stage['id']
                    continue
                
                char_hash, final_prompt = char_info['hash'], {k: ', '.join(v) for k, v in prompt_parts.items()}
                quantity = scene_config.get('quantity_per_stage', 1)

                stage_task_ids = []
                for i in range(quantity):
                    with self.scene_run_lock:
                        if self.scene_run_state['cancel_requested']: raise InterruptedError("Scene run cancelled.")
                    
                    gen_config = {**scene_config, **final_prompt, "character": char_name}
                    context = {"source": "scene", "scene_id": scene['id'], "stage_id": stage['id']}
                    
                    task_id, _ = self.core_api.generation_service.start_generation_task(user_hash, char_hash, gen_config, context)
                    if task_id:
                        stage_task_ids.append(task_id)

                if stage_task_ids:
                    while True:
                        with self.scene_run_lock:
                            if self.scene_run_state['cancel_requested']:
                                for task_id in stage_task_ids:
                                    self.core_api.generation_service.request_cancellation(user_hash, task_id)
                                raise InterruptedError("Scene run cancelled during stage wait.")
                        
                        current_status = self.core_api.generation_service.get_user_status(user_hash)
                        running_tasks = current_status.get("tasks", {})
                        
                        stage_still_running = any(task_id in running_tasks for task_id in stage_task_ids)
                        
                        if not stage_still_running:
                            break 
                        
                        time.sleep(2) 

                last_completed_scene_id, last_completed_stage_id = scene['id'], stage['id']
        
        except InterruptedError:
            print(f"✅ [Plugin:Scene] Scene run for user {user_hash} was cancelled.")
        except Exception as e:
            print(f"💥 CRITICAL ERROR in Scene Generation Task: {e}")
        finally:
            with self.scene_run_lock:
                self.scene_run_state.update({"is_running": False, "cancel_requested": False})

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/scene"
# --- NEW FILE: core/generation_service.py ---
import uuid
import threading
import time
import json
import websocket

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
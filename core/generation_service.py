# --- NEW FILE: core/generation_service.py ---
import uuid
import threading
import time
import json
import websocket
from datetime import datetime

class GenerationService:
    """Yuuka: Service mới để quản lý tập trung quá trình tạo ảnh."""
    def __init__(self, core_api):
        self.core_api = core_api
        self.image_service = core_api.image_service
        self.MAX_TASKS_PER_USER = 5
        self.user_states = {}
        self.user_locks = {}
    # Console output coordination for dynamic progress
        self.console_lock = threading.Lock()
        self._last_console_len = 0

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
                "generation_config": gen_config, # Yuuka: global cancel v1.0
                "is_alpha": bool(isinstance(context, dict) and (context.get('Alpha') or context.get('alpha') is True)),
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

    def peek_user_status(self, user_hash):
        """Return a status snapshot without consuming events or clearing finished tasks."""
        with self._get_user_lock(user_hash):
            state = self.user_states.get(user_hash, {"tasks": {}, "events": []})
            return {
                "tasks": state["tasks"].copy(),
                "events": list(state["events"]),
            }

    def dismiss_task(self, user_hash, task_id):
        """Remove a completed task and any matching emitted events from memory."""
        with self._get_user_lock(user_hash):
            state = self.user_states.get(user_hash)
            if not state:
                return False
            task = state.get("tasks", {}).get(task_id)
            if task and task.get("is_running"):
                return False
            state.get("tasks", {}).pop(task_id, None)
            state["events"] = [
                event for event in state.get("events", [])
                if str((event.get("data") or {}).get("task_id") or "") != str(task_id)
            ]
            return True

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

    # ---------- Console progress helpers ----------
    def _render_generation_progress(self, user_tail: str, workflow_label: str, size_label: str, percent: int):
        """Render a single-line dynamic progress bar using the unified format:
        [DD/MM - HH:MM:SS] Art Generation: <user_tail> | <workflow_label> | <size_label> | <bar> <percent>%
        """
        try:
            bar_len = 24
            p = max(0, min(100, int(percent)))
            filled = int(bar_len * p // 100)
            bar = "█" * filled + "░" * (bar_len - filled)
            dt_str = datetime.now().strftime('%d/%m - %H:%M:%S')
            line = f"\r[{dt_str}] Art Generation: {user_tail} | {workflow_label} | {size_label} | [{bar}] {p:3d}%"
            with self.console_lock:
                print(line, end="", flush=True)
                self._last_console_len = len(line)
        except Exception:
            pass

    def _clear_progress_line(self):
        try:
            with self.console_lock:
                if getattr(self, "_last_console_len", 0) > 0:
                    print("\r" + " " * self._last_console_len + "\r", end="", flush=True)
                self._last_console_len = 0
        except Exception:
            pass

    # ---------- Workflow label helpers (multi-LoRA aware) ----------
    def _count_loras_from_cfg(self, cfg: dict) -> int:
        """Count how many LoRA entries are requested in the config.
        Supports lora_chain (list of dict/str), lora_names (list or CSV), and lora_name (single).
        """
        try:
            # 1) lora_chain
            chain = cfg.get('lora_chain')
            if isinstance(chain, list) and chain:
                count = 0
                for item in chain:
                    if isinstance(item, dict):
                        name = (item.get('name') or item.get('lora_name') or '').strip()
                        if name and name.lower() != 'none':
                            count += 1
                    elif isinstance(item, str):
                        name = item.strip()
                        if name and name.lower() != 'none':
                            count += 1
                if count:
                    return count

            # 2) lora_names (CSV or list)
            names = cfg.get('lora_names')
            if isinstance(names, str):
                parts = [p.strip() for p in names.split(',') if p.strip() and p.strip().lower() != 'none']
                if parts:
                    return len(parts)
            elif isinstance(names, list):
                parts = []
                for p in names:
                    if isinstance(p, str):
                        s = p.strip()
                        if s and s.lower() != 'none':
                            parts.append(s)
                    elif isinstance(p, dict):
                        s = (p.get('name') or p.get('lora_name') or '').strip()
                        if s and s.lower() != 'none':
                            parts.append(s)
                if parts:
                    return len(parts)

            # 3) lora_name (single)
            single = cfg.get('lora_name')
            if isinstance(single, str):
                s = single.strip()
                if s and s.lower() != 'none':
                    return 1
        except Exception:
            pass
        return 0

    def _base_workflow_label(self, cfg: dict) -> str:
        """Derive a base workflow label from config fields.
        Prefers explicit labels; strips .json suffix if present.
        """
        label = (
            cfg.get('workflow_template') or
            cfg.get('workflow_type') or
            cfg.get('_workflow_template') or
            cfg.get('_workflow_type') or
            'workflow'
        )
        try:
            if isinstance(label, str) and label.endswith('.json'):
                return label[:-5]
        except Exception:
            pass
        return label

    def _format_workflow_label(self, cfg: dict) -> str:
        """Format workflow label with multi-LoRA awareness.
        Examples:
          - standard
          - standard + LoRA
          - hiresfix_esrgan_input_image + 3 LoRA
        """
        base = self._base_workflow_label(cfg or {})
        lora_count = self._count_loras_from_cfg(cfg or {})
        if lora_count > 1:
            return f"{base} + {lora_count} LoRA"
        if lora_count == 1:
            return f"{base} + LoRA"
        return base

    def _friendly_node_label(self, node_type: str) -> str:
        if not isinstance(node_type, str) or not node_type.strip():
            return "Đang xử lý"
        mapping = {
            "checkpointloadersimple": "Nạp checkpoint",
            "cliptextencode": "Mã hóa prompt",
            "emptylatentimage": "Tạo latent",
            "ksampler": "Sampling",
            "vaedecode": "Giải mã VAE",
            "upscalemodelloader": "Nạp model upscale",
            "imageupscalewithmodel": "Upscale bằng model",
            "image_scale": "Resize ảnh",
            "imagescaleby": "Resize ảnh",
            "loadimage": "Nạp ảnh nguồn",
            "imagetobase64_yuuka": "Đóng gói ảnh",
            "videotobase64_yuuka": "Đóng gói video",
            "loraloader": "Nạp LoRA",
            "power lora loader (rgthree)": "Nạp LoRA",
            "rmbg": "Tách nền",
        }
        key = node_type.strip().lower()
        return mapping.get(key, node_type)

    def _run_task(self, user_hash, task_id, character_hash, cfg_data):
        ws = None
        execution_successful = False
        start_time = None
        # Yuuka: I2V timeout support
        context = None
        with self._get_user_lock(user_hash):
            context = self.user_states.get(user_hash, {}).get("tasks", {}).get(task_id, {}).get("context") or {}
        timeout_seconds = None
        if isinstance(context, dict):
            ts = context.get('timeout_seconds')
            if ts and int(ts) > 0:
                timeout_seconds = int(ts)
        try:
            client_id = str(uuid.uuid4())
            seed = uuid.uuid4().int % (10**15) if int(cfg_data.get("seed", 0)) == 0 else int(cfg_data.get("seed", 0))
            target_address = cfg_data.get('server_address', '127.0.0.1:8888')
            # Pre-calc display fields for progress line
            user_tail = user_hash[-4:]
            workflow_label_display = self._format_workflow_label(cfg_data)
            width_display = cfg_data.get('width') or cfg_data.get('img_width') or '?'
            height_display = cfg_data.get('height') or cfg_data.get('img_height') or '?'
            size_label_display = f"{width_display} x {height_display}"
            try:
                original_lora_tags = list(cfg_data.get("lora_prompt_tags") or [])
            except Exception:
                original_lora_tags = []

            workflow, output_node_id = self.core_api.workflow_builder.build_workflow(cfg_data, seed)
            workflow_node_types = {}
            if isinstance(workflow, dict):
                for node_id, node_data in workflow.items():
                    if isinstance(node_data, dict):
                        workflow_node_types[str(node_id)] = str(node_data.get('class_type') or '').strip()
            
            prompt_info = self.core_api.comfy_api_client.queue_prompt(workflow, client_id, target_address)
            prompt_id = prompt_info['prompt_id']

            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"][task_id]
                task['prompt_id'] = prompt_id
                task['progress_message'] = "Đã gửi, đang chờ trong hàng đợi..."
                task['workflow_label'] = workflow_label_display
                task['comfy_event_type'] = 'queued'
                task['queue_position'] = 0
                task['current_node'] = None
                task['current_node_type'] = None
                task['current_node_label'] = None
                task['step_value'] = 0
                task['step_max'] = 0
                task['workflow_node_types'] = workflow_node_types

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
                            self.user_states[user_hash]["tasks"][task_id]['comfy_event_type'] = 'queued'
                            self.user_states[user_hash]["tasks"][task_id]['queue_position'] = total_ahead
                        # Dynamic generation-style progress (0%) while in queue
                        self._render_generation_progress(user_tail, workflow_label_display, size_label_display, 0)
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
            # Set a short timeout for recv so we can periodically check for user cancellation or overall task timeout
            ws.settimeout(3.0)
            websocket_closed_early = False

            while True:
                with self._get_user_lock(user_hash):
                    task = self.user_states[user_hash]["tasks"].get(task_id)
                    if not task or task.get('cancel_requested'): raise InterruptedError("Cancelled by user.")
                
                # Yuuka: I2V timeout check
                if timeout_seconds and start_time and (time.time() - start_time) > timeout_seconds:
                    raise TimeoutError(f"Task timed out after {timeout_seconds}s.")
                
                try:
                    out = ws.recv()
                except websocket.WebSocketTimeoutException:
                    # Expected: no messages from ComfyUI for 3s (e.g. during a long generation step).
                    # Just loop back to check cancellation/timeout and recv again.
                    continue
                except websocket.WebSocketConnectionClosedException:
                    websocket_closed_early = True
                    break
                
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
                            task['comfy_event_type'] = 'execution_start'
                            task['queue_position'] = 0
                            task['current_node'] = None
                            task['current_node_type'] = None
                            task['current_node_label'] = None
                            task['step_value'] = 0
                            task['step_max'] = 0
                            self._render_generation_progress(user_tail, workflow_label_display, size_label_display, 0)
                        elif msg_type == 'executing' and msg_data.get('node') is not None:
                            current_node = str(msg_data.get('node'))
                            node_type = workflow_node_types.get(current_node, '')
                            task['comfy_event_type'] = 'executing'
                            task['queue_position'] = 0
                            task['current_node'] = current_node
                            task['current_node_type'] = node_type or None
                            task['current_node_label'] = self._friendly_node_label(node_type)
                            if task.get('step_max') and task.get('step_value'):
                                task['progress_message'] = f"{task['current_node_label']}... {task['progress_percent']}%"
                            else:
                                task['progress_message'] = f"{task['current_node_label']}..."
                        elif msg_type == 'execution_cached':
                            current_node = str(msg_data.get('node') or '')
                            node_type = workflow_node_types.get(current_node, '') if current_node else ''
                            task['comfy_event_type'] = 'execution_cached'
                            if current_node:
                                task['current_node'] = current_node
                            if node_type:
                                task['current_node_type'] = node_type
                                task['current_node_label'] = f"{self._friendly_node_label(node_type)} (cache)"
                                task['progress_message'] = task['current_node_label']
                        elif msg_type == 'progress':
                            v, m = msg_data.get('value',0), msg_data.get('max',1)
                            p = int(v/m*100) if m>0 else 0
                            task['comfy_event_type'] = 'progress'
                            task['step_value'] = v
                            task['step_max'] = m
                            task['progress_percent'] = p
                            node_label = task.get('current_node_label') or 'Đang tạo'
                            if m and m > 0:
                                task['progress_message'] = f"{node_label}... bước {v}/{m} · {p}%"
                            else:
                                task['progress_message'] = f"{node_label}... {p}%"
                            self._render_generation_progress(user_tail, workflow_label_display, size_label_display, p)
                        elif msg_type in ('executing', 'execution_done', 'execution_end') and msg_data.get('node') is None:
                            # move to 100% visually as execution ends
                            task['comfy_event_type'] = msg_type
                            task['current_node'] = None
                            task['current_node_type'] = None
                            task['current_node_label'] = 'Hoàn tất thực thi'
                            task['progress_percent'] = 100
                            task['progress_message'] = 'Hoàn tất thực thi, đang lấy kết quả...'
                            self._render_generation_progress(user_tail, workflow_label_display, size_label_display, 100)
                            execution_successful = True
                            break
                        elif msg_type == 'execution_error': raise Exception(f"Node error: {msg_data.get('exception_message', 'Unknown')}")
            
            history_outputs = {}
            image_b64 = None
            video_b64 = None
            history_error = None

            max_history_attempts = 360
            for attempt in range(max_history_attempts):
                # Yuuka: I2V timeout check in history poll
                if timeout_seconds and start_time and (time.time() - start_time) > timeout_seconds:
                    raise TimeoutError(f"Task timed out after {timeout_seconds}s.")
                try:
                    history = self.core_api.comfy_api_client.get_history(prompt_id, target_address)
                except Exception as err:
                    history_error = err
                    time.sleep(1.0)
                    continue

                history_outputs = history.get(prompt_id, {}).get('outputs', {})
                if not isinstance(history_outputs, dict):
                    history_outputs = {}
                node_output = history_outputs.get(output_node_id, {})
                if isinstance(node_output, dict):
                    # Check for image output (ImageToBase64_Yuuka)
                    images_base64 = node_output.get("images_base64")
                    if images_base64:
                        image_b64 = images_base64[0]
                        execution_successful = True
                        break
                    # Check for video output (VideoToBase64_Yuuka)
                    video_base64_list = node_output.get("video_base64")
                    if video_base64_list:
                        video_b64 = video_base64_list[0]
                        execution_successful = True
                        break

                time.sleep(1.0)

            result_b64 = image_b64 or video_b64
            is_video_result = video_b64 is not None

            if execution_successful and result_b64:
                # Clear progress line before final output
                self._clear_progress_line()
                with self._get_user_lock(user_hash):
                    self.user_states[user_hash]["tasks"][task_id]['comfy_event_type'] = 'history'
                    self.user_states[user_hash]["tasks"][task_id]['current_node'] = output_node_id
                    self.user_states[user_hash]["tasks"][task_id]['current_node_type'] = workflow_node_types.get(str(output_node_id)) or None
                    self.user_states[user_hash]["tasks"][task_id]['current_node_label'] = 'Đọc kết quả đầu ra'
                    self.user_states[user_hash]["tasks"][task_id]['progress_message'] = "\u0110ang x\u1eed l\u00fd k\u1ebft qu\u1ea3..."

                creation_duration = (time.time() - start_time) - 0.3 # tru do tre websocket
                if original_lora_tags:
                    cfg_data["lora_prompt_tags"] = original_lora_tags
                elif "lora_prompt_tags" not in cfg_data:
                    cfg_data["lora_prompt_tags"] = []
                try:
                    alpha_flag = bool(task.get('is_alpha'))
                except Exception:
                    alpha_flag = False

                if is_video_result:
                    new_metadata = self.image_service.save_video_metadata(
                        user_hash, character_hash, video_b64, cfg_data, creation_duration
                    )
                else:
                    new_metadata = self.image_service.save_image_metadata(
                        user_hash, character_hash, image_b64, cfg_data, creation_duration, alpha=alpha_flag
                    )
                if not new_metadata:
                    raise Exception("L\u01b0u k\u1ebft qu\u1ea3 th\u1ea5t b\u1ea1i.")

                # Yuuka: console notify when generation completes
                try:
                    dt_str = datetime.now().strftime('%d/%m - %H:%M:%S')
                    # user_hash tail (last 4 chars or segments separated by '-')
                    user_tail = user_hash[-4:]
                    cfg_gc = new_metadata.get('generationConfig', {}) or {}
                    workflow_label = self._format_workflow_label(cfg_gc)
                    media_type = "Video" if is_video_result else "Art"
                    # image size: try width/height from config, else '?' placeholders
                    width = cfg_gc.get('width') or cfg_gc.get('img_width') or '?'
                    height = cfg_gc.get('height') or cfg_gc.get('img_height') or '?'
                    size_label = f"{width} x {height}"
                    GREEN = "\033[32m"; RESET = "\033[0m"
                    print(f"{GREEN}[{dt_str}] {media_type} Generation: {user_tail} | {workflow_label} | {size_label} | {round(creation_duration,2)}s{RESET}")
                except Exception:
                    pass

                event_type = "VIDEO_SAVED" if is_video_result else "IMAGE_SAVED"
                self._add_event(user_hash, event_type, {"task_id": task_id, "image_data": new_metadata, "context": task.get("context")})
            else:
                if history_error and result_b64 is None:
                    raise ConnectionAbortedError(f"WebSocket closed early and history unavailable: {history_error}")
                if websocket_closed_early and not execution_successful:
                    raise ConnectionAbortedError("WebSocket connection lost before prompt finished execution.")
                raise Exception(f"Kh\u00f4ng t\u00ecm th\u1ea5y d\u1eef li\u1ec7u base64 trong node '{output_node_id}'")

        except InterruptedError as e:
             self._clear_progress_line()
             print(f"✅ [GenService Task {task_id}] Cancelled gracefully for user {user_hash}.")
        except TimeoutError as e:
            self._clear_progress_line()
            print(f"⏰ [GenService Task {task_id}] Timed out for user {user_hash}: {e}")
            # Auto-cancel on ComfyUI side
            try:
                self.request_cancellation(user_hash, task_id)
            except Exception:
                pass
            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"].get(task_id)
                if task:
                    task['error_message'] = f"Lỗi: Task quá thời gian ({timeout_seconds}s)"
        except Exception as e:
            self._clear_progress_line()
            msg = str(e)
            # Rút gọn thông báo khi không thể kết nối tới ComfyUI
            if msg.startswith("COMFY_CONN_REFUSED:"):
                try:
                    _, address, _ = msg.split(":", 2)
                except ValueError:
                    address = cfg_data.get('server_address', '127.0.0.1:8888')
                print(f"[ComfyUI] Không thể kết nối tới server {address} (WinError 10061).")
            elif msg.startswith("COMFY_CONN_ERROR:"):
                try:
                    _, address, reason = msg.split(":", 2)
                except ValueError:
                    address, reason = cfg_data.get('server_address', '127.0.0.1:8888'), msg
                print(f"[ComfyUI] Không thể kết nối tới server {address}. {reason}")
            else:
                print(f"💥 [GenService Task {task_id}] Failed for user {user_hash}: {e}")
            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"].get(task_id)
                if task:
                    # Lưu thông điệp lỗi gọn
                    if msg.startswith("COMFY_CONN_REFUSED:"):
                        task['error_message'] = f"Lỗi: Không thể kết nối tới ComfyUI tại {cfg_data.get('server_address', '127.0.0.1:8888')} (10061)"
                    elif msg.startswith("COMFY_CONN_ERROR:"):
                        task['error_message'] = f"Lỗi: Không thể kết nối tới ComfyUI tại {cfg_data.get('server_address', '127.0.0.1:8888')}"
                    else:
                        task['error_message'] = f"Lỗi: {str(e)}"
        finally:
            if ws: ws.close()
            with self._get_user_lock(user_hash):
                task = self.user_states[user_hash]["tasks"].get(task_id)
                if task: task['is_running'] = False
            # Ensure any lingering progress line is cleared
            self._clear_progress_line()

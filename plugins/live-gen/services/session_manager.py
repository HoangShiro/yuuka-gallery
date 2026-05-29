import json
import threading
import time
import uuid

class LiveGenSession:
    def __init__(self, manager, ws, user_hash):
        self.manager = manager
        self.generation_service = manager.generation_service
        self.config_service = manager.config_service
        self.ws = ws
        self.user_hash = user_hash
        self.send_lock = threading.Lock()
        self.current_lock = threading.Lock()
        self.current = None
        self.closed = False

    def send(self, payload):
        if self.closed:
            return False
        with self.send_lock:
            try:
                self.ws.send(json.dumps(payload))
                return True
            except Exception:
                return False

    def start_generation(self, prompt, seed=None, config_overrides=None, seq=None, input_image_base64=None):
        prompt = str(prompt or "").strip()
        if not prompt:
            self.cancel_current()
            self.send({"type": "idle", "seq": seq})
            return

        self.cancel_current()
        stop_event = threading.Event()
        generation_id = uuid.uuid4().hex
        thread = threading.Thread(
            target=self.generation_service.run_generation,
            args=(self, generation_id, prompt, seed, config_overrides or {}, seq, stop_event, input_image_base64),
            daemon=True,
        )
        with self.current_lock:
            self.current = {
                "id": generation_id,
                "thread": thread,
                "stop_event": stop_event,
                "prompt_id": None,
                "server_address": None,
            }
        thread.start()

    def cancel_current(self):
        with self.current_lock:
            current = self.current
            self.current = None
        if not current:
            return
        current["stop_event"].set()
        prompt_id = current.get("prompt_id")
        server_address = current.get("server_address")
        if prompt_id and server_address:
            try:
                queue_details = self.manager.core_api.comfy_api_client.get_queue_details_sync(server_address)
                running = any(item[1] == prompt_id for item in queue_details.get("queue_running", []))
                pending = any(item[1] == prompt_id for item in queue_details.get("queue_pending", []))
                if pending:
                    self.manager.core_api.comfy_api_client.delete_queued_item(prompt_id, server_address)
                if running:
                    self.manager.core_api.comfy_api_client.interrupt_execution(server_address)
            except Exception as err:
                self.send({"type": "warning", "message": f"Cancel failed: {err}"})

    def close(self):
        self.closed = True
        self.cancel_current()
        try:
            self.ws.close()
        except Exception:
            pass


class SessionManager:
    def __init__(self, core_api, config_service, generation_service):
        self.core_api = core_api
        self.config_service = config_service
        self.generation_service = generation_service
        self._sessions = set()
        self._sessions_lock = threading.Lock()

    def add_session(self, ws, user_hash):
        session = LiveGenSession(self, ws, user_hash)
        with self._sessions_lock:
            self._sessions.add(session)
        return session

    def remove_session(self, session):
        with self._sessions_lock:
            self._sessions.discard(session)

    def shutdown(self):
        with self._sessions_lock:
            sessions = list(self._sessions)
        for session in sessions:
            session.close()

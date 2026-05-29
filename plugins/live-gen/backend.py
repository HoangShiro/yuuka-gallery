import json
import time
import urllib.parse
from flask import Blueprint

from .services import ConfigService, HistoryService, GenerationService, SessionManager
from .api.routes import setup_routes

class LiveGenPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint("live_gen", __name__)
        
        # Initialize sub-services
        self.config_service = ConfigService(self.core_api)
        self.history_service = HistoryService(self.core_api)
        self.generation_service = GenerationService(self.core_api, self.config_service, self.history_service)
        self.session_manager = SessionManager(self.core_api, self.config_service, self.generation_service)
        
        # Setup API routes
        setup_routes(self.blueprint, self)
        print("[Plugin:LiveGen] Backend initialized (Restructured version).")

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/live-gen"

    def shutdown(self):
        self.session_manager.shutdown()

    def handle_websocket(self, ws):
        token = self._extract_token(ws)
        try:
            user_hash = self.core_api.verify_token_and_get_user_hash(token_override=token)
        except Exception as err:
            self._safe_send(ws, {"type": "error", "message": f"Auth failed: {err}"})
            try:
                ws.close()
            except Exception:
                pass
            return

        session = self.session_manager.add_session(ws, user_hash)

        try:
            session.send({"type": "ready", "config": self.config_service.get_config()})
            while not session.closed:
                raw = ws.receive()
                if raw is None:
                    break
                try:
                    message = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    session.send({"type": "error", "message": "Invalid websocket message."})
                    continue

                msg_type = message.get("type")
                if msg_type == "generate":
                    session.start_generation(
                        prompt=message.get("prompt", ""),
                        seed=message.get("seed"),
                        config_overrides=message.get("config") or {},
                        seq=message.get("seq"),
                        input_image_base64=message.get("input_image_base64"),
                    )
                elif msg_type == "cancel":
                    session.cancel_current()
                elif msg_type == "update_config":
                    current = self.config_service.save_config(message.get("config") or {})
                    session.send({"type": "config", "config": current})
                elif msg_type == "ping":
                    session.send({"type": "pong", "time": time.time()})
                else:
                    session.send({"type": "error", "message": f"Unknown message type: {msg_type}"})
        finally:
            session.close()
            self.session_manager.remove_session(session)

    def _extract_token(self, ws):
        environ = getattr(ws, "environ", {}) or {}
        query = environ.get("QUERY_STRING", "")
        params = urllib.parse.parse_qs(query)
        token = (params.get("token") or [""])[0]
        return token.strip()

    def _safe_send(self, ws, payload):
        try:
            ws.send(json.dumps(payload))
            return True
        except Exception:
            return False

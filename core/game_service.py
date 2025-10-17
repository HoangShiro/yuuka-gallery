# --- NEW FILE: core/game_service.py ---
import json
import threading
import uuid
import time
import hashlib
from collections import defaultdict

class GameService:
    """
    Yuuka: Service mới để quản lý các phòng game PvP và giao tiếp WebSocket.
    Service này hoạt động như một trung gian, chuyển tiếp hành động của người chơi
    đến plugin game tương ứng để xử lý.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        self.clients = {}  # ws -> { "user_hash": str, "room_id": str }
        self.rooms = {}    # room_id -> { "id", "game_id", "players", "state", "lock" }
        self.lock = threading.Lock() # Lock chung cho việc sửa đổi clients và rooms dict

    def _get_client_ip(self, ws):
        """Retrieve the remote IP for the given websocket connection."""
        environ = getattr(ws, "environ", None)
        if isinstance(environ, dict):
            for header in (
                "HTTP_X_FORWARDED_FOR",
                "HTTP_X_ORIGINAL_FORWARDED_FOR",
                "HTTP_X_CLIENT_IP",
                "HTTP_CF_CONNECTING_IP",
                "HTTP_X_REAL_IP",
                "REMOTE_ADDR",
            ):
                value = environ.get(header)
                if value:
                    return value.split(",")[0].strip()
        return "0.0.0.0"

    def handle_connect(self, ws):
        """Xử lý khi một client mới kết nối."""
        print(f"[GameService] Client connected: {ws}")
        # Client sẽ được thêm vào self.clients sau khi xác thực thành công

    def handle_disconnect(self, ws):
        """Xử lý khi một client ngắt kết nối, dọn dẹp phòng và thông báo cho người khác."""
        with self.lock:
            client_info = self.clients.pop(ws, None)
            if not client_info:
                print(f"[GameService] Unauthenticated client disconnected: {ws}")
                return

        user_hash = client_info["user_hash"]
        room_id = client_info.get("room_id")
        print(f"[GameService] Client disconnected: {user_hash[:8]}...")

        if room_id:
            self._remove_player_from_room(user_hash, room_id)

    def handle_message(self, ws, message_str):
        """Xử lý tin nhắn đến từ client."""
        try:
            message = json.loads(message_str)
            msg_type = message.get("type")

            if msg_type == "auth":
                self._handle_auth(ws, message.get("token"))
                return

            with self.lock:
                client_info = self.clients.get(ws)
                if not client_info:
                    self._send(ws, {"type": "error", "message": "Not authenticated."})
                    return
            
            user_hash = client_info["user_hash"]

            # Route tin nhắn đến handler tương ứng
            if msg_type == "create_room":
                self._handle_create_room(user_hash, ws, message.get("data", {}))
            elif msg_type == "join_room":
                self._handle_join_room(user_hash, ws, message.get("data", {}))
            elif msg_type == "leave_room":
                self._handle_leave_room(user_hash, ws)
            elif msg_type == "game_action":
                self._handle_game_action(user_hash, ws, message.get("data", {}))
            else:
                self._send(ws, {"type": "error", "message": f"Unknown message type: {msg_type}"})

        except json.JSONDecodeError:
            self._send(ws, {"type": "error", "message": "Invalid JSON format."})
        except Exception as e:
            print(f"💥 [GameService] Error handling message: {e}")
            self._send(ws, {"type": "error", "message": f"An internal error occurred: {str(e)}"})

    def _handle_auth(self, ws, token):
        """Xác thực người dùng qua token."""
        if not token:
            self._send(ws, {"type": "auth_fail", "message": "Missing token."})
            try:
                ws.close()
            except Exception:
                pass
            return

        try:
            client_ip = self._get_client_ip(ws)
            environ = getattr(ws, "environ", {}) if isinstance(getattr(ws, "environ", None), dict) else {}
            forwarded_chain = None
            for header in (
                "HTTP_X_FORWARDED_FOR",
                "HTTP_X_ORIGINAL_FORWARDED_FOR",
                "HTTP_X_CLIENT_IP",
                "HTTP_CF_CONNECTING_IP",
            ):
                value = environ.get(header)
                if value:
                    forwarded_chain = value
                    break

            loopback_ips = {"127.0.0.1", "::1", "localhost"}
            is_loopback = client_ip in loopback_ips
            origin_ip = None
            if forwarded_chain:
                origin_ip = forwarded_chain.split(",")[0].strip()
            if not origin_ip:
                origin_ip = client_ip if client_ip != "0.0.0.0" else None

            whitelist = getattr(self.core_api, "_whitelist_users", []) or []
            user_data = getattr(self.core_api, "_user_data", {}) or {}
            registered_users = user_data.get("users", []) or []
            waitlist = getattr(self.core_api, "_waitlist_users", []) or []

            is_valid = False
            if token in whitelist or token in registered_users:
                is_valid = True
            elif is_loopback and token in waitlist:
                is_valid = True

            if not is_valid:
                raise Exception("Invalid token.")

            user_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

            client_record = {
                "user_hash": user_hash,
                "room_id": None,
                "authenticated": True,
                "connected": True,
                "ip": client_ip,
            }
            if forwarded_chain:
                client_record["forwarded_for"] = forwarded_chain
            if origin_ip:
                client_record["origin_ip"] = origin_ip

            with self.lock:
                self.clients[ws] = client_record

            if forwarded_chain and origin_ip and origin_ip not in loopback_ips:
                location_tag = "proxied"
            elif is_loopback:
                location_tag = "local"
            else:
                location_tag = "remote"
            print(f"[GameService] Client authenticated ({location_tag}): {user_hash[:8]}...")
            self._send(ws, {"type": "auth_success", "user_hash": user_hash})

        except Exception as e:
            print(f"[GameService] Auth failed: {e}")
            self._send(ws, {"type": "auth_fail", "message": str(e)})
            try:
                ws.close()
            except Exception:
                pass

    def _handle_create_room(self, user_hash, ws, data):
        """Tạo một phòng game mới."""
        game_id = data.get("game_id")
        if not game_id:
            return self._send(ws, {"type": "error", "message": "game_id is required to create a room."})

        requested_room_id = data.get("room_id")
        if requested_room_id:
            with self.lock:
                if requested_room_id in self.rooms:
                    return self._send(ws, {"type": "error", "message": "Room already exists."})
        room_id = requested_room_id or str(uuid.uuid4())
        room = {
            "id": room_id,
            "game_id": game_id,
            "players": {user_hash: {"ws": ws}},
            "state": {}, # Initial game state
            "lock": threading.Lock()
        }
        
        with self.lock:
            self.rooms[room_id] = room
            self.clients[ws]["room_id"] = room_id

        print(f"[GameService] Room {room_id} created by {user_hash[:8]} for game '{game_id}'.")
        self._send(ws, {"type": "room_created", "room": self._get_room_public_info(room)})
    
    def _handle_join_room(self, user_hash, ws, data):
        """Tham gia vào một phòng game đã có."""
        room_id = data.get("room_id")
        if not room_id or room_id not in self.rooms:
            return self._send(ws, {"type": "error", "message": "Room not found."})

        room = self.rooms[room_id]
        with room["lock"]:
            if user_hash in room["players"]:
                return self._send(ws, {"type": "error", "message": "Already in this room."})

            room["players"][user_hash] = {"ws": ws}
            with self.lock:
                self.clients[ws]["room_id"] = room_id
            
            # Thông báo cho những người khác trong phòng
            self._broadcast(room_id, {
                "type": "player_joined",
                "user_hash": user_hash
            }, exclude_ws=ws)
            
            # Gửi thông tin phòng đầy đủ cho người mới vào
            self._send(ws, {"type": "room_joined", "room": self._get_room_public_info(room)})
            print(f"[GameService] Player {user_hash[:8]} joined room {room_id}.")

    def _handle_leave_room(self, user_hash, ws):
        """Rời khỏi phòng hiện tại."""
        with self.lock:
            client_info = self.clients.get(ws)

        if not client_info:
            return self._send(ws, {"type": "error", "message": "Not authenticated."})

        room_id = client_info.get("room_id")
        if not room_id or room_id not in self.rooms:
            return self._send(ws, {"type": "error", "message": "Not in a room."})

        if not self._remove_player_from_room(user_hash, room_id):
            return self._send(ws, {"type": "error", "message": "Failed to leave the room."})

        print(f"[GameService] Player {user_hash[:8]}... left room {room_id} via request.")

        with self.lock:
            updated_info = self.clients.get(ws)
            if updated_info is not None:
                updated_info.pop("room_id", None)

        self._send(ws, {"type": "room_left", "room_id": room_id})


    def _remove_player_from_room(self, user_hash, room_id, notify_plugin=True):
        """Remove a player from a room and handle follow-up notifications."""
        if not room_id:
            return False

        with self.lock:
            room = self.rooms.get(room_id)
        if not room:
            return False

        should_notify_plugin = False
        should_delete_room = False

        with room["lock"]:
            if user_hash not in room["players"]:
                return False

            room["players"].pop(user_hash, None)
            print(f"[GameService] Player {user_hash[:8]}... removed from room {room_id}")

            state = room.get("state") or {}
            if notify_plugin and state.get("mode") == "pvp":
                should_notify_plugin = True

            if not room["players"]:
                should_delete_room = True
            else:
                self._broadcast(room_id, {
                    "type": "player_left",
                    "user_hash": user_hash
                })

        if should_notify_plugin:
            self._notify_plugin_player_departure(room, user_hash)

        if should_delete_room:
            with self.lock:
                if self.rooms.get(room_id) is room:
                    del self.rooms[room_id]
                    print(f"[GameService] Room {room_id} is empty and has been deleted.")

        return True

    def _handle_game_action(self, user_hash, ws, action_data):
        """Handle an incoming game action and forward it to the registered plugin service."""
        if not isinstance(action_data, dict):
            return self._send(ws, {"type": "error", "message": "Invalid action payload."})

        action_type = action_data.get("type")
        if not action_type:
            return self._send(ws, {"type": "error", "message": "Action type is required."})

        room_id = self.clients[ws].get("room_id")
        allowed_without_room = {"get_lobby", "request_pvp_slot"}

        if not room_id or room_id not in self.rooms:
            if action_type not in allowed_without_room:
                return self._send(ws, {"type": "error", "message": "Not in a room."})

            game_id = action_data.get("game_id")
            if not game_id:
                return self._send(ws, {"type": "error", "message": "game_id is required for this action."})

            service_name = f"game:{game_id}:action"
            result = self.core_api.call_service(
                service_name,
                current_state=None,
                player_hash=user_hash,
                action_data=action_data
            )
            if result and result.get("player_message"):
                self._send(ws, result["player_message"])
            return

        room = self.rooms[room_id]
        with room["lock"]:
            game_id = room["game_id"]
            service_name = f"game:{game_id}:action"
            result = self.core_api.call_service(
                service_name,
                current_state=room["state"],
                player_hash=user_hash,
                action_data=action_data
            )

            if result is None:
                return self._send(ws, {"type": "error", "message": f"Game '{game_id}' did not handle the action."})

            new_state = result.get("new_state")
            if new_state is not None:
                room["state"] = new_state

            player_message = result.get("player_message")
            if player_message:
                self._send(ws, player_message)

            broadcast_message = result.get("broadcast_message")
            if broadcast_message:
                self._broadcast(room_id, broadcast_message)

    def _send(self, ws, data):
        """Gửi dữ liệu tới một client cụ thể."""
        try:
            ws.send(json.dumps(data))
        except Exception as e:
            print(f"💥 [GameService] Failed to send to {ws}: {e}")

    def _broadcast(self, room_id, data, exclude_ws=None):
        """Gửi dữ liệu tới tất cả client trong phòng, có thể loại trừ một người."""
        if room_id not in self.rooms: return
        
        room = self.rooms[room_id]
        # Tạo một bản copy để tránh race condition nếu dict thay đổi trong lúc lặp
        players_copy = list(room["players"].values())

        for player_info in players_copy:
            ws = player_info.get("ws")
            if ws and ws != exclude_ws:
                self._send(ws, data)
    
    def _notify_plugin_player_departure(self, room, user_hash):
        """Inform the game plugin that a PvP player has left the room."""
        game_id = room.get("game_id")
        if not game_id:
            return

        service_name = f"game:{game_id}:action"
        try:
            result = self.core_api.call_service(
                service_name,
                current_state=room.get("state"),
                player_hash=user_hash,
                action_data={
                    "type": "leave_match",
                    "room_id": room.get("id"),
                    "player_hash": user_hash,
                }
            )
        except Exception as exc:
            print(f"[GameService] Failed to notify plugin about player leave: {exc}")
            return

        if not result:
            return

        new_state = result.get("new_state")
        if new_state is not None:
            room["state"] = new_state

        broadcast_message = result.get("broadcast_message")
        if broadcast_message:
            self._broadcast(room["id"], broadcast_message)

    def _get_room_public_info(self, room):
        """Lấy thông tin công khai của phòng để gửi cho client."""
        # YUUKA'S FIX: Call the game-specific serialization service to prevent sending
        # internal, non-serializable data (like RNG objects).
        game_id = room.get("game_id")
        sanitized_state = room.get("state")  # Fallback to raw state if service fails

        if game_id:
            service_name = f"game:{game_id}:serialize_state"
            result = self.core_api.call_service(service_name, room.get("state"))
            if result is not None:
                sanitized_state = result
            else:
                print(f"⚠️ [GameService] Warning: Could not find or call serialize_state service for game '{game_id}'.")

        return {
            "id": room["id"],
            "game_id": room["game_id"],
            "players": list(room["players"].keys()),
            "state": sanitized_state
        }

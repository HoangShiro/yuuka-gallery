from __future__ import annotations
import hashlib
import time
from flask import Blueprint, jsonify, request, abort

class AccountPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self._first_admin_cache_file = "account_first_admin.json"
        self.blueprint = Blueprint("account_plugin", __name__)
        self._register_routes()
        print("[Plugin:Account] Backend initialized.")

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/account"

    def _register_routes(self):
        @self.blueprint.route("/users", methods=["GET"])
        def get_users_list():
            self._ensure_first_admin()
            current_user_hash = self.core_api.verify_token_and_get_user_hash()

            token = self._get_request_token()
            is_admin = self._is_admin(token)

            if not is_admin:
                return jsonify({"error": "Admin permission required."}), 403

            # Gom danh sách user từ Core - Đảm bảo dữ liệu mới nhất
            whitelist = self.core_api._whitelist_users
            waitlist = self.core_api._waitlist_users
            regular_users = self.core_api._user_data.get("users", [])

            all_users = []
            
            def add_user(token_val, role, status):
                try:
                    uhash = hashlib.sha256(token_val.encode('utf-8')).hexdigest()
                    all_users.append({
                        "token": token_val,
                        "hash": uhash,
                        "role": role,
                        "status": status,
                        "is_self": uhash == current_user_hash
                    })
                except Exception: pass

            unique_tokens = set()
            for t in whitelist: 
                if t not in unique_tokens:
                    add_user(t, "admin", "active")
                    unique_tokens.add(t)
            for t in waitlist: 
                if t not in unique_tokens:
                    add_user(t, "user", "waiting")
                    unique_tokens.add(t)
            for t in regular_users: 
                if t not in unique_tokens:
                    add_user(t, "user", "active")
                    unique_tokens.add(t)

            return jsonify({
                "users": all_users,
                "current_is_admin": is_admin
            })

        @self.blueprint.route("/promote", methods=["POST"])
        def promote_user():
            self._ensure_first_admin()
            self.core_api.verify_token_and_get_user_hash()
            if not self._is_admin(self._get_request_token()):
                abort(403)

            target_token = request.json.get("token")
            if not target_token: abort(400)

            success, msg = self.core_api.add_token_to_whitelist(target_token)
            return jsonify({"status": "ok" if success else "error", "message": msg})

        @self.blueprint.route("/revoke", methods=["POST"])
        def revoke_user():
            self._ensure_first_admin()
            self.core_api.verify_token_and_get_user_hash()
            if not self._is_admin(self._get_request_token()):
                abort(403)

            target_token = request.json.get("token")
            if not target_token: abort(400)

            if target_token in self.core_api._whitelist_users:
                # Không cho tự hạ quyền chính mình nếu là admin duy nhất
                if len(self.core_api._whitelist_users) <= 1:
                    return jsonify({"error": "Cannot revoke the last admin."}), 400

                self.core_api._whitelist_users.remove(target_token)
                self.core_api.save_data(self.core_api._whitelist_users, "whitelist.json", obfuscated=True)
                
                # Chuyển về regular user list nếu chưa có
                if target_token not in self.core_api._user_data.get("users", []):
                    self.core_api._user_data.setdefault("users", []).append(target_token)
                    self.core_api.save_data(self.core_api._user_data, "user_data.json", obfuscated=True)
                
                return jsonify({"status": "ok"})
            return jsonify({"error": "User is not an admin."}), 404

        @self.blueprint.route("/delete", methods=["DELETE"])
        def delete_user():
            self._ensure_first_admin()
            self.core_api.verify_token_and_get_user_hash()
            if not self._is_admin(self._get_request_token()):
                abort(403)

            target_token = request.json.get("token")
            if not target_token: abort(400)

            # Xóa khỏi tất cả các list
            modified = False
            if target_token in self.core_api._whitelist_users:
                if len(self.core_api._whitelist_users) <= 1:
                    return jsonify({"error": "Cannot delete the last admin."}), 400
                self.core_api._whitelist_users.remove(target_token)
                self.core_api.save_data(self.core_api._whitelist_users, "whitelist.json", obfuscated=True)
                modified = True

            if target_token in self.core_api._waitlist_users:
                self.core_api._waitlist_users.remove(target_token)
                self.core_api.save_data(self.core_api._waitlist_users, "waitlist.json", obfuscated=True)
                modified = True

            regular_users = self.core_api._user_data.get("users", [])
            if target_token in regular_users:
                regular_users.remove(target_token)
                self.core_api.save_data(self.core_api._user_data, "user_data.json", obfuscated=True)
                modified = True

            return jsonify({"status": "ok" if modified else "not_found"})

        @self.blueprint.route("/status", methods=["GET"])
        def get_auth_status():
            self._ensure_first_admin()
            try:
                token = self._get_request_token()
                if not token:
                    return jsonify({
                        "is_logged_in": False,
                        "is_admin": False,
                        "can_setup": not self.core_api._whitelist_users
                    })

                self.core_api.verify_token_and_get_user_hash()
                is_admin = self._is_admin(token)

                return jsonify({
                    "is_logged_in": True,
                    "is_admin": is_admin,
                    "can_setup": not self.core_api._whitelist_users
                })
            except Exception:
                return jsonify({
                    "is_logged_in": False,
                    "is_admin": False
                })

    def _is_admin(self, token: str) -> bool:
        return token in self.core_api._whitelist_users

    def _get_request_token(self) -> str:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return ''
        return auth_header.replace('Bearer ', '').strip()

    def _is_known_account_token(self, token: str) -> bool:
        if not token:
            return False
        return (
            token in self.core_api._whitelist_users or
            token in self.core_api._waitlist_users or
            token in self.core_api._user_data.get("users", [])
        )

    def _save_first_admin_cache(self, token: str):
        payload = {
            "first_admin_hash": hashlib.sha256(token.encode('utf-8')).hexdigest(),
            "claimed_at": int(time.time())
        }
        self.core_api.save_data(payload, self._first_admin_cache_file, obfuscated=True)

    def _ensure_first_admin(self):
        if self.core_api._whitelist_users:
            return

        token = self._get_request_token()
        if not self._is_known_account_token(token):
            return

        success, _ = self.core_api.add_token_to_whitelist(token)
        if success:
            self._save_first_admin_cache(token)
            print(f"[Plugin:Account] First account claimed admin: {token[:8]}...")

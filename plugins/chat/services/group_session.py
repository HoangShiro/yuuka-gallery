import time
import uuid


class GroupChatSessionMixin:
    def get_group_session_filename(self, user_hash) -> str:
        return f"chat_group_sessions_{user_hash}.json"

    def get_all_group_sessions(self, user_hash) -> dict:
        filename = self.get_group_session_filename(user_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )
        return data.get("sessions", {})

    def get_group_session(self, user_hash, group_id) -> dict | None:
        sessions = self.get_all_group_sessions(user_hash)
        return sessions.get(group_id, None)

    def save_group_session(self, user_hash, group_id, session_data) -> dict:
        filename = self.get_group_session_filename(user_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )

        if not group_id:
            group_id = str(uuid.uuid4())
            session_data["id"] = group_id
            session_data["created_at"] = time.time()
            session_data["messages"] = session_data.get("messages", [])

        session_data["updated_at"] = time.time()
        session_data["is_group"] = True

        if "sessions" not in data:
            data["sessions"] = {}

        data["sessions"][group_id] = session_data

        self.core_api.data_manager.save_user_data(
            data,
            filename,
            user_hash,
            obfuscated=True
        )
        return session_data

    def delete_group_session(self, user_hash, group_id) -> bool:
        filename = self.get_group_session_filename(user_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )
        if "sessions" in data and group_id in data["sessions"]:
            del data["sessions"][group_id]
            self.core_api.data_manager.save_user_data(
                data,
                filename,
                user_hash,
                obfuscated=True
            )
            return True
        return False

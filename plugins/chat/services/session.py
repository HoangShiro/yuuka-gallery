import time
import uuid

class ChatSessionMixin:
    def get_session_filename(self, char_hash):
        return f"chat_sessions_{char_hash}.json"

    def get_character_sessions(self, user_hash, char_hash):
        filename = self.get_session_filename(char_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )
        return data.get("sessions", {})

    def get_session(self, user_hash, char_hash, session_id):
        sessions = self.get_character_sessions(user_hash, char_hash)
        return sessions.get(session_id, None)

    def save_session(self, user_hash, char_hash, session_id, session_data):
        filename = self.get_session_filename(char_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )
        
        if not session_id:
            session_id = str(uuid.uuid4())
            session_data["id"] = session_id
            session_data["created_at"] = time.time()
            session_data["messages"] = session_data.get("messages", [])
        
        session_data["updated_at"] = time.time()
        
        if "sessions" not in data:
            data["sessions"] = {}
            
        data["sessions"][session_id] = session_data
        
        self.core_api.data_manager.save_user_data(
            data,
            filename,
            user_hash,
            obfuscated=True
        )
        return session_data

    def delete_session(self, user_hash, char_hash, session_id):
        filename = self.get_session_filename(char_hash)
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"sessions": {}},
            obfuscated=True
        )
        if "sessions" in data and session_id in data["sessions"]:
            del data["sessions"][session_id]
            self.core_api.data_manager.save_user_data(
                data,
                filename,
                user_hash,
                obfuscated=True
            )
            return True
        return False

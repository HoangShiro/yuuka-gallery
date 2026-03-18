import os
import time
import uuid

class ChatPersonaMixin:
    def get_all_personas(self, user_hash):
        data = self.core_api.data_manager.load_user_data(
            self.CHAT_PERSONAS_FILENAME,
            user_hash,
            default_value={"characters": {}, "users": {}},
            obfuscated=True
        )
        
        data_modified = False
        def _is_avatar_valid(url):
            if not url: return True
            if url.startswith('/image/'): return True
            parts = url.split('/')
            if len(parts) >= 4 and parts[1] == 'user_image':
                sub_dir = parts[2]
                filename = parts[-1]
                filepath = self.core_api.data_manager.get_path(os.path.join('user_images', sub_dir, filename))
                return os.path.exists(filepath)
            return True

        for p_type in ["characters", "users"]:
            for pid, pdata in data.get(p_type, {}).items():
                if pdata.get("avatar") and not _is_avatar_valid(pdata["avatar"]):
                    pdata["avatar"] = ""
                    data_modified = True

        if data_modified:
            self.core_api.data_manager.save_user_data(
                data,
                self.CHAT_PERSONAS_FILENAME,
                user_hash,
                obfuscated=True
            )
            
        return data

    def save_persona(self, user_hash, persona_type, persona_id, data):
        personas = self.get_all_personas(user_hash)
        if persona_type not in ["characters", "users"]:
            raise ValueError("Invalid persona type")
            
        if not persona_id:
            persona_id = str(uuid.uuid4())
            
        # Optional: default structure mapping
        avatar_val = data.get("avatar", "")
        
        avatar_base64 = data.get("avatar_base64")
        if avatar_base64:
            try:
                if ',' in avatar_base64:
                    avatar_base64 = avatar_base64.split(',', 1)[1]
                gen_config = {"prompt": "User uploaded avatar", "workflow_type": "standard"}
                char_hash = persona_id if persona_type == "characters" else "User persona"
                meta = self.core_api.image_service.save_image_metadata(
                    user_hash, char_hash, avatar_base64, gen_config
                )
                if meta and meta.get("pv_url"):
                    avatar_val = meta["pv_url"]
            except Exception as e:
                print(f"Error uploading persona avatar: {e}")

        persona_obj = {
            "id": persona_id,
            "name": data.get("name", ""),
            "avatar": avatar_val,
            "persona": data.get("persona", ""),
        }
        
        if persona_type == "characters":
            persona_obj["chat_sample"] = data.get("chat_sample", "")
            persona_obj["appearance"] = data.get("appearance", [])
            persona_obj["default_outfits"] = data.get("default_outfits", [])
            
        personas[persona_type][persona_id] = persona_obj
        
        self.core_api.data_manager.save_user_data(
            personas,
            self.CHAT_PERSONAS_FILENAME,
            user_hash,
            obfuscated=True
        )
        return persona_obj

    def delete_persona(self, user_hash, persona_type, persona_id):
        personas = self.get_all_personas(user_hash)
        if persona_type in personas and persona_id in personas[persona_type]:
            del personas[persona_type][persona_id]
            self.core_api.data_manager.save_user_data(
                personas,
                self.CHAT_PERSONAS_FILENAME,
                user_hash,
                obfuscated=True
            )
            return True
        return False

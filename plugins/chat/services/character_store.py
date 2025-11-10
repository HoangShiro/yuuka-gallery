from typing import Any, Dict, Optional


class CharacterDefinitionStore:
    """Persistence layer for per-character definitions."""

    filename = "chat_character_definitions.json"

    def __init__(self, data_manager):
        self.data_manager = data_manager

    def all(self, user_hash: str) -> Dict[str, Dict[str, Any]]:
        return self.data_manager.load_user_data(
            self.filename,
            user_hash,
            default_value={},
            obfuscated=True,
        )

    def get(self, user_hash: str, character_id: str) -> Optional[Dict[str, Any]]:
        definitions = self.all(user_hash)
        return definitions.get(character_id)

    def save(self, user_hash: str, character_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        definitions = self.all(user_hash)
        definitions[character_id] = payload
        self.data_manager.save_user_data(
            definitions,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return payload

    def delete(self, user_hash: str, character_id: str) -> bool:
        definitions = self.all(user_hash)
        if character_id not in definitions:
            return False
        del definitions[character_id]
        self.data_manager.save_user_data(
            definitions,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return True

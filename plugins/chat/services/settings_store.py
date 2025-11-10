from typing import Any, Dict


class GenerationSettingsStore:
    """Persistence layer for global generation settings."""

    filename = "chat_generation_settings.json"

    def __init__(self, data_manager):
        self.data_manager = data_manager

    def get(self, user_hash: str) -> Dict[str, Any]:
        return self.data_manager.load_user_data(
            self.filename,
            user_hash,
            default_value={
                "provider": "openai",
                "model": None,
                "temperature": 0.7,
                "max_tokens": 1024,
                "api_key": None,
                "overrides": {},
                "system_instruction": "",
            },
            obfuscated=True,
        )

    def save(self, user_hash: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get(user_hash)
        current.update(payload or {})
        self.data_manager.save_user_data(
            current,
            self.filename,
            user_hash,
            obfuscated=True,
        )
        return current

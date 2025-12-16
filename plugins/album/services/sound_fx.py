from __future__ import annotations

import os


class AlbumSoundFxMixin:
    """Sound FX preset/group storage helpers (per-user)."""

    def _load_sound_fx_groups(self, user_hash: str) -> list[dict]:
        data = self.core_api.data_manager.load_user_data(
            getattr(self, 'SOUND_FX_GROUPS_FILENAME', 'album_sound_fx_groups.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return data if isinstance(data, list) else []

    def _save_sound_fx_groups(self, user_hash: str, groups: list[dict]) -> None:
        self.core_api.data_manager.save_user_data(
            groups if isinstance(groups, list) else [],
            getattr(self, 'SOUND_FX_GROUPS_FILENAME', 'album_sound_fx_groups.json'),
            user_hash,
            obfuscated=True,
        )

    def _load_sound_fx_presets(self, user_hash: str) -> list[dict]:
        data = self.core_api.data_manager.load_user_data(
            getattr(self, 'SOUND_FX_PRESETS_FILENAME', 'album_sound_fx_presets.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return data if isinstance(data, list) else []

    def _save_sound_fx_presets(self, user_hash: str, presets: list[dict]) -> None:
        self.core_api.data_manager.save_user_data(
            presets if isinstance(presets, list) else [],
            getattr(self, 'SOUND_FX_PRESETS_FILENAME', 'album_sound_fx_presets.json'),
            user_hash,
            obfuscated=True,
        )

    def _sound_fx_dir_rel(self, user_hash: str) -> str:
        # Keep audio in data_cache/user_audio/sfx/<user_hash>/
        return os.path.join('user_audio', 'sfx', str(user_hash))

    def _sound_fx_file_rel(self, user_hash: str, preset_id: str, ext: str) -> str:
        ext = (ext or '').strip().lstrip('.').lower() or 'bin'
        return os.path.join(self._sound_fx_dir_rel(user_hash), f"{preset_id}.{ext}")

    def _ensure_sound_fx_dir(self, user_hash: str) -> None:
        abs_dir = self.core_api.data_manager.get_path(self._sound_fx_dir_rel(user_hash))
        os.makedirs(abs_dir, exist_ok=True)

    def _save_sound_fx_file(self, user_hash: str, preset_id: str, ext: str, data: bytes) -> str:
        self._ensure_sound_fx_dir(user_hash)
        rel_path = self._sound_fx_file_rel(user_hash, preset_id, ext)
        obf = self.core_api.data_manager.obfuscate_binary(data)
        self.core_api.data_manager.save_binary(obf, rel_path)
        return rel_path

    def _load_sound_fx_file_bytes(self, user_hash: str, preset_id: str, ext: str) -> bytes | None:
        rel_path = self._sound_fx_file_rel(user_hash, preset_id, ext)
        obf = self.core_api.data_manager.read_binary(rel_path)
        if not obf:
            return None
        return self.core_api.data_manager.deobfuscate_binary(obf)

    def _delete_sound_fx_file(self, user_hash: str, preset_id: str, ext: str) -> bool:
        rel_path = self._sound_fx_file_rel(user_hash, preset_id, ext)
        abs_path = self.core_api.data_manager.get_path(rel_path)
        try:
            if os.path.exists(abs_path):
                os.remove(abs_path)
            return True
        except Exception:
            return False

from __future__ import annotations


class AlbumAnimationMixin:
    """Animation preset/group storage helpers (per-user)."""

    def _load_animation_groups(self, user_hash: str) -> list[dict]:
        data = self.core_api.data_manager.load_user_data(
            getattr(self, 'ANIMATION_GROUPS_FILENAME', 'album_animation_groups.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return data if isinstance(data, list) else []

    def _save_animation_groups(self, user_hash: str, groups: list[dict]) -> None:
        self.core_api.data_manager.save_user_data(
            groups if isinstance(groups, list) else [],
            getattr(self, 'ANIMATION_GROUPS_FILENAME', 'album_animation_groups.json'),
            user_hash,
            obfuscated=True,
        )

    def _load_animation_presets(self, user_hash: str) -> list[dict]:
        data = self.core_api.data_manager.load_user_data(
            getattr(self, 'ANIMATION_PRESETS_FILENAME', 'album_animation_presets.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return data if isinstance(data, list) else []

    def _save_animation_presets(self, user_hash: str, presets: list[dict]) -> None:
        self.core_api.data_manager.save_user_data(
            presets if isinstance(presets, list) else [],
            getattr(self, 'ANIMATION_PRESETS_FILENAME', 'album_animation_presets.json'),
            user_hash,
            obfuscated=True,
        )

    def _sanitize_animation_key(self, value) -> str:
        try:
            key = str(value or '').strip()
        except Exception:
            return ''
        return key

    def _sanitize_animation_graph_type(self, value) -> str:
        try:
            gt = str(value or '').strip()
        except Exception:
            return ''
        return gt

    def _sanitize_animation_timeline(self, value):
        # Allow list/dict as-is; fallback to empty list for invalid payload.
        if isinstance(value, (list, dict)):
            return value
        return []

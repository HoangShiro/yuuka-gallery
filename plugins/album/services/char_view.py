from __future__ import annotations


class AlbumCharacterViewMixin:
    """Character view storage + category helpers.

    Extracted from backend.py to keep AlbumPlugin smaller and easier to extend.
    """

    # ------------------------------
    # Character-view helpers
    # ------------------------------
    def _load_char_tag_groups(self, user_hash):
        groups = self.core_api.data_manager.load_user_data(
            self.CHAR_TAG_GROUPS_FILENAME, user_hash, default_value=[], obfuscated=True
        )
        return groups if isinstance(groups, list) else []

    def _save_char_tag_groups(self, user_hash, groups):
        self.core_api.data_manager.save_user_data(
            groups, self.CHAR_TAG_GROUPS_FILENAME, user_hash, obfuscated=True
        )

    def _load_char_presets_root(self, user_hash):
        root = self.core_api.data_manager.load_user_data(
            self.CHAR_PRESETS_FILENAME, user_hash, default_value={}, obfuscated=True
        )
        return root if isinstance(root, dict) else {}

    def _save_char_presets_root(self, user_hash, root):
        self.core_api.data_manager.save_user_data(
            root, self.CHAR_PRESETS_FILENAME, user_hash, obfuscated=True
        )

    # ------------------------------
    # Presets (GLOBAL, per-user)
    # ------------------------------
    def _load_char_presets(self, user_hash):
        """Load global presets list for this user.

        Storage migration:
        - Old format: { "<character_hash>": [preset, ...], ... }
        - New format: [preset, ...] (global across all characters)
        """
        raw = self.core_api.data_manager.load_user_data(
            self.CHAR_PRESETS_FILENAME, user_hash, default_value=[], obfuscated=True
        )
        if isinstance(raw, list):
            return raw

        # Migrate legacy dict format -> a single merged list
        if isinstance(raw, dict):
            merged = []
            seen_ids = set()
            for v in raw.values():
                if not isinstance(v, list):
                    continue
                for p in v:
                    if not isinstance(p, dict):
                        continue
                    pid = str(p.get('id') or '').strip()
                    # Keep first occurrence per id; if no id, keep it (best-effort)
                    if pid:
                        if pid in seen_ids:
                            continue
                        seen_ids.add(pid)
                    merged.append(p)
            # Best-effort: persist migrated format so future loads are cheap.
            try:
                self.core_api.data_manager.save_user_data(
                    merged,
                    self.CHAR_PRESETS_FILENAME,
                    user_hash,
                    obfuscated=True,
                )
            except Exception:
                pass
            return merged

        return []

    def _save_char_presets(self, user_hash, presets):
        self.core_api.data_manager.save_user_data(
            presets if isinstance(presets, list) else [],
            self.CHAR_PRESETS_FILENAME,
            user_hash,
            obfuscated=True,
        )

    def _load_char_preset_favourites_root(self, user_hash):
        root = self.core_api.data_manager.load_user_data(
            self.CHAR_PRESET_FAVOURITES_FILENAME, user_hash, default_value={}, obfuscated=True
        )
        return root if isinstance(root, dict) else {}

    def _save_char_preset_favourites_root(self, user_hash, root):
        self.core_api.data_manager.save_user_data(
            root, self.CHAR_PRESET_FAVOURITES_FILENAME, user_hash, obfuscated=True
        )

    def _load_char_view_settings(self, user_hash):
        settings = self.core_api.data_manager.load_user_data(
            self.CHAR_VIEW_SETTINGS_FILENAME, user_hash, default_value={}, obfuscated=True
        )
        return settings if isinstance(settings, dict) else {}

    def _save_char_view_settings(self, user_hash, settings):
        self.core_api.data_manager.save_user_data(
            settings, self.CHAR_VIEW_SETTINGS_FILENAME, user_hash, obfuscated=True
        )

    # ------------------------------
    # State / State group / State group preset (GLOBAL, per-user)
    # ------------------------------
    def _load_char_state_groups(self, user_hash):
        groups = self.core_api.data_manager.load_user_data(
            getattr(self, 'CHAR_STATE_GROUPS_FILENAME', 'album_character_state_groups.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return groups if isinstance(groups, list) else []

    def _save_char_state_groups(self, user_hash, groups):
        self.core_api.data_manager.save_user_data(
            groups if isinstance(groups, list) else [],
            getattr(self, 'CHAR_STATE_GROUPS_FILENAME', 'album_character_state_groups.json'),
            user_hash,
            obfuscated=True,
        )

    def _load_char_states(self, user_hash):
        states = self.core_api.data_manager.load_user_data(
            getattr(self, 'CHAR_STATES_FILENAME', 'album_character_states.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return states if isinstance(states, list) else []

    def _save_char_states(self, user_hash, states):
        self.core_api.data_manager.save_user_data(
            states if isinstance(states, list) else [],
            getattr(self, 'CHAR_STATES_FILENAME', 'album_character_states.json'),
            user_hash,
            obfuscated=True,
        )

    def _load_char_state_group_presets(self, user_hash):
        presets = self.core_api.data_manager.load_user_data(
            getattr(self, 'CHAR_STATE_GROUP_PRESETS_FILENAME', 'album_character_state_group_presets.json'),
            user_hash,
            default_value=[],
            obfuscated=True,
        )
        return presets if isinstance(presets, list) else []

    def _save_char_state_group_presets(self, user_hash, presets):
        self.core_api.data_manager.save_user_data(
            presets if isinstance(presets, list) else [],
            getattr(self, 'CHAR_STATE_GROUP_PRESETS_FILENAME', 'album_character_state_group_presets.json'),
            user_hash,
            obfuscated=True,
        )

    # ------------------------------
    # Visual Novel mode: global background cache (per-user)
    # ------------------------------
    def _load_char_vn_backgrounds(self, user_hash):
        data = self.core_api.data_manager.load_user_data(
            getattr(self, 'CHAR_VN_BACKGROUNDS_FILENAME', 'album_character_vn_backgrounds.json'),
            user_hash,
            default_value={},
            obfuscated=True,
        )
        return data if isinstance(data, dict) else {}

    def _save_char_vn_backgrounds(self, user_hash, data):
        self.core_api.data_manager.save_user_data(
            data if isinstance(data, dict) else {},
            getattr(self, 'CHAR_VN_BACKGROUNDS_FILENAME', 'album_character_vn_backgrounds.json'),
            user_hash,
            obfuscated=True,
        )

    def _default_char_categories(self) -> list[dict]:
        # Keep legacy defaults for backwards compatibility
        return [
            {"name": "Outfits", "icon": "checkroom"},
            {"name": "Expression", "icon": "mood"},
            {"name": "Action", "icon": "directions_run"},
            {"name": "Context", "icon": "landscape"},
        ]

    def _sanitize_char_category_color(self, value):
        """Normalize optional category color.

        Accepted format: '#RRGGBB' (case-insensitive). Returns normalized uppercase hex.
        """
        if value is None:
            return None
        if not isinstance(value, str):
            value = str(value)
        v = value.strip()
        if not v:
            return None
        if len(v) != 7 or not v.startswith('#'):
            return None
        hex_part = v[1:]
        for ch in hex_part:
            if ch not in '0123456789abcdefABCDEF':
                return None
        return '#' + hex_part.upper()

    def _is_default_char_category_name(self, name: str) -> bool:
        if not isinstance(name, str):
            return False
        n = name.strip().lower()
        if not n:
            return False
        return any(str(c.get('name') or '').strip().lower() == n for c in self._default_char_categories())

    def _sanitize_char_categories(self, categories) -> list[dict]:
        if not isinstance(categories, list):
            return []
        out: list[dict] = []
        seen = set()
        for item in categories:
            if not isinstance(item, dict):
                continue
            name = str(item.get('name') or '').strip()
            icon = str(item.get('icon') or '').strip()
            color = self._sanitize_char_category_color(item.get('color'))
            # Optional: allow marking a category as the VN background category.
            is_bg = bool(item.get('is_bg') or item.get('isBg') or item.get('bg'))
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({
                'name': name,
                'icon': icon or 'label',
                'color': color,
                'is_bg': is_bg,
            })
        return out

    def _group_tag_groups_payload(self, groups):
        all_groups = {}
        flat_map = {g.get('id'): g for g in groups if isinstance(g, dict) and g.get('id')}
        for group in groups:
            if not isinstance(group, dict):
                continue
            category = group.get('category')
            if not category:
                continue
            all_groups.setdefault(category, []).append(group)
        return {"grouped": all_groups, "flat": flat_map}

    def _sanitize_selection(self, selection):
        """Normalize preset selection payload.

        Expected shape: { "CategoryName": "<group_id>" | None, ... }

        Notes:
        - We keep category keys as provided (trimmed) to preserve user-defined categories.
        - Values are normalized to string ids or None.
        - '__none__' is accepted and treated as None.
        """
        if not isinstance(selection, dict):
            return {}

        out: dict[str, str | None] = {}
        for k, v in selection.items():
            key = str(k or '').strip()
            if not key:
                continue
            gid = str(v or '').strip()
            if not gid or gid == '__none__':
                out[key] = None
            else:
                out[key] = gid
        return out

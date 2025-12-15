from __future__ import annotations

import hashlib
import os


class AlbumExternalPresetsMixin:
    """Load external album_preset/*.txt and expose them as read-only tag groups."""

    def _get_external_album_preset_dir(self) -> str:
        try:
            # DataManager.get_path joins relative path into data_cache
            return self.core_api.data_manager.get_path(self.EXTERNAL_ALBUM_PRESET_DIRNAME)
        except Exception:
            # Fallback: relative to CWD
            return os.path.join('data_cache', self.EXTERNAL_ALBUM_PRESET_DIRNAME)

    def _normalize_external_category(self, raw: str) -> str | None:
        if not isinstance(raw, str):
            return None
        s = raw.strip().strip('[]').strip().lower()
        mapping = {
            'outfit': 'Outfits',
            'outfits': 'Outfits',
            'expression': 'Expression',
            'expressions': 'Expression',
            'action': 'Action',
            'actions': 'Action',
            'context': 'Context',
            'background': 'Context',
        }
        return mapping.get(s)

    def _external_group_id(self, filename: str, category: str, group_name: str) -> str:
        # Stable deterministic id across restarts and file reorders.
        key = f"album_preset|{filename}|{category.lower()}|{group_name.strip().lower()}".encode('utf-8')
        digest = hashlib.sha1(key).hexdigest()[:24]
        return f"ext:{digest}"

    def _load_external_char_tag_groups(self) -> list[dict]:
        base_dir = self._get_external_album_preset_dir()
        try:
            os.makedirs(base_dir, exist_ok=True)
        except Exception:
            # If we cannot create it, still attempt to read
            pass

        if not os.path.isdir(base_dir):
            return []

        # De-dupe by (category, name) across all txt files; merge tags
        merged: dict[tuple[str, str], dict] = {}
        for fname in sorted(os.listdir(base_dir)):
            if not fname.lower().endswith('.txt'):
                continue
            full_path = os.path.join(base_dir, fname)
            if not os.path.isfile(full_path):
                continue
            try:
                with open(full_path, 'r', encoding='utf-8-sig') as f:
                    lines = f.read().splitlines()
            except Exception:
                continue

            current_category: str | None = None
            for raw_line in lines:
                line = (raw_line or '').strip()
                if not line:
                    continue
                if line.startswith('#') or line.startswith('//'):
                    continue

                if line.startswith('[') and line.endswith(']'):
                    current_category = self._normalize_external_category(line)
                    continue
                if not current_category:
                    continue

                # Parse: <group name>: <tags...>
                if ':' not in line:
                    continue
                name_part, tags_part = line.split(':', 1)
                group_name = name_part.strip()
                if not group_name:
                    continue
                tags = [t.strip() for t in tags_part.split(',') if t.strip()]
                if not tags:
                    continue

                # Group name is treated as case-sensitive (':o' and ':O' are different groups).
                key = (current_category, group_name)
                if key not in merged:
                    merged[key] = {
                        'id': self._external_group_id(fname, current_category, group_name),
                        'name': group_name,
                        'category': current_category,
                        'tags': [],
                    }
                # Merge tags, preserving order and uniqueness
                existing = merged[key]['tags']
                # Tags are case-sensitive (e.g. ':o' and ':O' are different).
                # Only trim whitespace for comparison.
                existing_set = set(str(t).strip() for t in existing)
                for t in tags:
                    tt = str(t).strip()
                    if tt in existing_set:
                        continue
                    existing.append(tt)
                    existing_set.add(tt)

        return list(merged.values())

    def _is_external_group_id(self, group_id: str) -> bool:
        return isinstance(group_id, str) and group_id.startswith('ext:')

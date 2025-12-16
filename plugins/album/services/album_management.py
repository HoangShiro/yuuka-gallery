from __future__ import annotations
import time
import os
from copy import deepcopy

class AlbumManagementMixin:
    """
    Mixin for Album management (custom albums, character albums, deletion, etc.)
    """

    def _load_custom_albums(self, user_hash):
        albums = self.core_api.data_manager.load_user_data(
            self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, default_value=[], obfuscated=True
        )
        return albums if isinstance(albums, list) else []

    def _save_custom_albums(self, user_hash, albums):
        self.core_api.data_manager.save_user_data(
            albums, self.ALBUM_CUSTOM_LIST_FILENAME, user_hash, obfuscated=True
        )

    def _delete_custom_album_entry(self, user_hash, character_hash):
        current_albums = self._load_custom_albums(user_hash)
        if not current_albums:
            return False
        filtered = [entry for entry in current_albums if entry.get("hash") != character_hash]
        if len(filtered) != len(current_albums):
            self._save_custom_albums(user_hash, filtered)
            return True
        return False

    def _delete_character_config_entry(self, character_hash):
        configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
        if character_hash in configs:
            del configs[character_hash]
            self.core_api.save_data(configs, self.ALBUM_CHAR_CONFIG_FILENAME)
            return True
        return False

    def _delete_character_images(self, user_hash, character_hash):
        """Remove all images and files associated with a character album."""
        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME,
            default_value={},
            obfuscated=True
        )
        user_images = images_data.get(user_hash, {})
        character_images = user_images.get(character_hash, [])
        if not character_images:
            return 0

        image_ids = [img.get("id") for img in character_images if img.get("id")]
        deleted_count = 0
        for image_id in image_ids:
            try:
                if self.core_api.image_service.delete_image_by_id(user_hash, image_id):
                    deleted_count += 1
            except Exception as err:  # noqa: BLE001
                print(f"[AlbumPlugin] Failed to delete image '{image_id}': {err}")
        return deleted_count

    def _delete_character_album(self, user_hash, character_hash):
        if not character_hash:
            return {"images_removed": 0, "config_removed": False, "custom_removed": False}
        images_removed = self._delete_character_images(user_hash, character_hash)
        config_removed = self._delete_character_config_entry(character_hash)
        custom_removed = self._delete_custom_album_entry(user_hash, character_hash)
        return {
            "images_removed": images_removed,
            "config_removed": config_removed,
            "custom_removed": custom_removed,
        }

    def _find_user_image(self, user_hash, image_id):
        """Locate an image metadata entry by id for the given user."""
        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME,
            default_value={},
            obfuscated=True
        )
        user_images = images_data.get(user_hash, {})
        for character_hash, items in user_images.items():
            for entry in items:
                if entry.get("id") == image_id:
                    return character_hash, entry
        return None, None

    def _update_custom_album_entry(self, user_hash, character_hash, display_name):
        """Thêm hoặc xóa entry album tùy thuộc vào việc tên có hợp lệ không."""
        current_albums = self._load_custom_albums(user_hash)
        trimmed_name = (display_name or "").strip()

        # Loại bỏ mọi entry trùng hash trước khi thêm lại (nếu cần)
        filtered = [entry for entry in current_albums if entry.get("hash") != character_hash]

        if trimmed_name:
            timestamp = int(time.time())
            existing = next((entry for entry in current_albums if entry.get("hash") == character_hash), None)
            if existing:
                existing["name"] = trimmed_name
                existing["updated_at"] = timestamp
                filtered.append(existing)
            else:
                filtered.append({
                    "hash": character_hash,
                    "name": trimmed_name,
                    "created_at": timestamp
                })

        if filtered != current_albums:
            self._save_custom_albums(user_hash, filtered)

    def _ensure_vn_background_album(self, user_hash):
        """Ensure a dedicated custom album named 'Background' exists for this user."""
        target_name = 'Background'
        try:
            existing = self._load_custom_albums(user_hash)
        except Exception:
            existing = []

        # Prefer an existing custom album with exact (case-insensitive) name match.
        try:
            for entry in existing:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get('name') or '').strip()
                if name.lower() != target_name.lower():
                    continue
                h = str(entry.get('hash') or '').strip()
                if h:
                    return h
        except Exception:
            pass

        # Create a deterministic-ish hash but avoid collisions with user's existing custom hashes.
        base_hash = 'album-custom-background'
        used = {str(e.get('hash') or '').strip() for e in existing if isinstance(e, dict) and str(e.get('hash') or '').strip()}
        candidate = base_hash
        if candidate in used:
            i = 2
            while f'{base_hash}-{i}' in used:
                i += 1
            candidate = f'{base_hash}-{i}'

        # Persist into user's custom album list so it appears in /albums even without images.
        try:
            self._update_custom_album_entry(user_hash, candidate, target_name)
        except Exception:
            # Best-effort; still return candidate so frontend can use it.
            pass

        # Initialize default generation config for this album on first creation.
        # Requirement: default size should be landscape ("Phong cảnh") for VN backgrounds.
        try:
            all_char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            if not isinstance(all_char_configs, dict):
                all_char_configs = {}

            existing_cfg = all_char_configs.get(candidate)
            if not isinstance(existing_cfg, dict) or not existing_cfg:
                landscape_w, landscape_h = 1216, 832
                cfg = dict(self.DEFAULT_CONFIG)
                cfg['width'] = landscape_w
                cfg['height'] = landscape_h
                cfg['hires_base_width'] = landscape_w
                cfg['hires_base_height'] = landscape_h
                all_char_configs[candidate] = self._sanitize_config(cfg)
                self.core_api.save_data(all_char_configs, self.ALBUM_CHAR_CONFIG_FILENAME)
        except Exception:
            # Best-effort: album still works even if config init fails.
            pass
        return candidate

    def _build_album_list_response(self, user_hash):
        """Kết hợp dữ liệu ảnh và cấu hình để trả về danh sách album đầy đủ."""
        custom_albums = self._load_custom_albums(user_hash)
        custom_map = {entry.get("hash"): entry for entry in custom_albums if entry.get("name")}

        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME, default_value={}, obfuscated=True
        )
        user_images_by_char = images_data.get(user_hash, {})
        char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)

        album_items = []

        for char_hash, images in user_images_by_char.items():
            if not images:
                continue

            # Ảnh đầu tiên (theo thứ tự lưu) sẽ được dùng làm cover
            first_image = images[0]
            cover_url = first_image.get("pv_url") or first_image.get("url")
            image_count = len(images)

            # Xác định tên hiển thị
            character_info = self.core_api.get_character_by_hash(char_hash)
            if character_info:
                display_name = character_info.get("name", char_hash)
                is_custom = False
            else:
                config_entry = char_configs.get(char_hash, {})
                display_name = str(config_entry.get("character", "")).strip()
                if not display_name:
                    custom_entry = custom_map.get(char_hash)
                    if custom_entry:
                        display_name = custom_entry.get("name", "").strip()
                    if not display_name:
                        gen_config = first_image.get("generationConfig", {}) or {}
                        display_name = str(gen_config.get("character", "")).strip()
                if not display_name:
                    display_name = char_hash
                is_custom = True

            album_items.append({
                "hash": char_hash,
                "name": display_name,
                "cover_url": cover_url,
                "image_count": image_count,
                "is_custom": is_custom
            })

        existing_hashes = {item["hash"] for item in album_items}

        # Thêm các custom album chưa có ảnh nhưng đã lưu cấu hình
        for entry in custom_albums:
            char_hash = entry.get("hash")
            display_name = (entry.get("name") or "").strip()
            if not char_hash or not display_name or char_hash in existing_hashes:
                continue
            album_items.append({
                "hash": char_hash,
                "name": display_name,
                "cover_url": None,
                "image_count": 0,
                "is_custom": True
            })

        album_items.sort(key=lambda item: item["name"].lower())
        return album_items

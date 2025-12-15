# --- MODIFIED FILE: plugins/album/backend.py ---
import time
import threading
import websocket
import json
import os
import uuid
import hashlib
import secrets
from copy import deepcopy

from flask import Blueprint, jsonify, request, abort

from .services.char_view import AlbumCharacterViewMixin
from .services.external_presets import AlbumExternalPresetsMixin
from .services.lora import AlbumLoraMixin

class AlbumPlugin(AlbumCharacterViewMixin, AlbumExternalPresetsMixin, AlbumLoraMixin):
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('album', __name__)
        
        # Yuuka: Các file config vẫn do plugin quản lý
        self.COMFYUI_CONFIG_FILENAME = "comfyui_config.json"
        self.ALBUM_CHAR_CONFIG_FILENAME = "album_character_configs.json"
        self.ALBUM_CUSTOM_LIST_FILENAME = "album_custom_list.json"

        # --- Character view (new viewMode: character) ---
        # Stored per-user in data_cache via DataManager.*_user_data(..., obfuscated=True)
        self.CHAR_TAG_GROUPS_FILENAME = "album_character_tags_group.json"
        self.CHAR_PRESETS_FILENAME = "album_character_presets.json"
        self.CHAR_PRESET_FAVOURITES_FILENAME = "album_character_preset_favourites.json"
        self.CHAR_VIEW_SETTINGS_FILENAME = "album_character_view_settings.json"
        self.CHAR_VN_BACKGROUNDS_FILENAME = "album_character_vn_backgrounds.json"

        # --- Character view: States (group tag groups across categories)
        self.CHAR_STATE_GROUPS_FILENAME = "album_character_state_groups.json"
        self.CHAR_STATES_FILENAME = "album_character_states.json"
        self.CHAR_STATE_GROUP_PRESETS_FILENAME = "album_character_state_group_presets.json"

        # External (manual) presets: read-only tag groups loaded from data_cache/album_preset/*.txt
        self.EXTERNAL_ALBUM_PRESET_DIRNAME = os.path.join('album_preset')
        
        self.DEFAULT_CONFIG = {
            "server_address": "127.0.0.1:8888", "ckpt_name": "waiNSFWIllustrious_v150.safetensors",
            "character": "", "expression": "smile", "action": "sitting", "outfits": "school uniform",
            "context": "1girl, classroom", "quality": "masterpiece, best quality, highres, amazing quality",
            "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
            "batch_size": 1, "height": 1216, "width": 832, "cfg": 2.2, "sampler_name": "dpmpp_sde",
            "scheduler": "beta", "steps": 12, "lora_name": "None", "lora_strength_model": 0.9,
            "lora_strength_clip": 1.0,
            "hires_enabled": False,
            "hires_stage1_denoise": 1.0,
            "hires_stage2_steps": 14,
            "hires_stage2_cfg": 2.4,
            "hires_stage2_sampler_name": "euler_ancestral",
            "hires_stage2_scheduler": "karras",
            "hires_stage2_denoise": 0.5,
            "hires_upscale_model": "4x-UltraSharp.pth",
            "hires_upscale_method": "bilinear",
            "hires_base_width": 0,
            "hires_base_height": 0,
            "lora_prompt_tags": [],
        }
        
        self.register_routes()

    def _generate_short_tag_group_id(self, existing_ids=None, length=8):
        """Generate a short, collision-resistant id for user-owned tag groups."""
        existing_ids = existing_ids or set()
        for _ in range(50):
            # token_hex yields [0-9a-f] and is URL-safe
            candidate = secrets.token_hex(max(4, length // 2))[:length]
            if candidate and candidate not in existing_ids:
                return candidate
        # Extremely unlikely fallback
        return uuid.uuid4().hex[:length]

    def _delete_character_images_by_tag_group_id(self, user_hash, group_id):
        """Delete all character-view images for this user that reference a given tag group id."""
        if not user_hash or not group_id:
            return 0

        images_data = self.core_api.read_data(
            self.core_api.image_service.IMAGE_DATA_FILENAME,
            default_value={},
            obfuscated=True
        )
        user_images = images_data.get(user_hash, {})
        if not isinstance(user_images, dict):
            return 0

        deleted_count = 0
        for _character_hash, items in list(user_images.items()):
            if not isinstance(items, list):
                continue
            for entry in list(items):
                if not isinstance(entry, dict):
                    continue
                gen_cfg = entry.get('generationConfig', {}) or {}
                if not isinstance(gen_cfg, dict):
                    continue

                # Only touch character-view images (or anything clearly using character grouping fields).
                is_character_view = (
                    str(gen_cfg.get('viewMode') or '').strip() == 'character'
                    or 'album_character_group_ids' in gen_cfg
                    or 'album_character_category_selections' in gen_cfg
                    or str(gen_cfg.get('album_character_preset_key') or '').startswith('g:')
                )
                if not is_character_view:
                    continue

                # New schema
                group_ids = gen_cfg.get('album_character_group_ids')
                if isinstance(group_ids, list) and any(str(gid).strip() == str(group_id) for gid in group_ids):
                    image_id = entry.get('id')
                    if image_id and self.core_api.image_service.delete_image_by_id(user_hash, image_id):
                        deleted_count += 1
                    continue

                # Legacy schema
                selections = gen_cfg.get('album_character_category_selections')
                if isinstance(selections, dict) and any(str(gid).strip() == str(group_id) for gid in selections.values()):
                    image_id = entry.get('id')
                    if image_id and self.core_api.image_service.delete_image_by_id(user_hash, image_id):
                        deleted_count += 1
                    continue

                preset_key = str(gen_cfg.get('album_character_preset_key') or '').strip()
                if preset_key.startswith('g:'):
                    gids = [p.strip() for p in preset_key[2:].split('|') if p.strip()]
                    if any(gid == str(group_id) for gid in gids):
                        image_id = entry.get('id')
                        if image_id and self.core_api.image_service.delete_image_by_id(user_hash, image_id):
                            deleted_count += 1

        return deleted_count

    def _cleanup_character_states_for_removed_tag_group_ids(self, user_hash, removed_group_ids):
        """Remove references to deleted tag group ids from character-view States.

        If a State becomes empty after cleanup, delete it.
        Any State-group preset pointing to a deleted state will be deleted.
        """
        try:
            removed = {str(gid).strip() for gid in (removed_group_ids or []) if str(gid).strip()}
        except Exception:
            removed = set()
        if not removed:
            return {"states_deleted": 0, "states_updated": 0, "presets_updated": 0}

        states = self._load_char_states(user_hash)
        presets = self._load_char_state_group_presets(user_hash)

        changed_states = False
        changed_presets = False
        states_deleted = 0
        states_updated = 0
        deleted_state_ids: set[str] = set()

        new_states: list[dict] = []
        for s in states:
            if not isinstance(s, dict):
                continue
            sid = str(s.get('id') or '').strip()
            tgids = s.get('tag_group_ids') or s.get('tagGroupIds') or s.get('group_ids') or []
            if not isinstance(tgids, list):
                tgids = []
            original = [str(x).strip() for x in tgids if str(x).strip()]
            filtered = [x for x in original if x not in removed]
            if filtered != original:
                changed_states = True
                if not filtered:
                    if sid:
                        deleted_state_ids.add(sid)
                    states_deleted += 1
                    continue
                s['tag_group_ids'] = filtered
                # Normalize legacy keys away
                for k in ('tagGroupIds', 'group_ids'):
                    if k in s:
                        try:
                            s.pop(k, None)
                        except Exception:
                            pass
                states_updated += 1
            new_states.append(s)

        new_presets = presets
        presets_removed = 0
        if deleted_state_ids and isinstance(presets, list):
            new_presets = []
            for p in presets:
                if not isinstance(p, dict):
                    continue
                st = str(p.get('state_id') or p.get('stateId') or '').strip()
                if st and st in deleted_state_ids:
                    presets_removed += 1
                    changed_presets = True
                    continue
                new_presets.append(p)

        if changed_states:
            self._save_char_states(user_hash, new_states)
        if changed_presets:
            self._save_char_state_group_presets(user_hash, new_presets)

        return {
            "states_deleted": int(states_deleted),
            "states_updated": int(states_updated),
            "presets_removed": int(presets_removed),
        }

    # (Moved character-view / external preset / LoRA helpers into mixins)

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

    def _safe_int(self, value, fallback):
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    def _safe_float(self, value, fallback):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    def _normalize_lora_tags(self, tags):
        if isinstance(tags, list):
            return [str(tag).strip() for tag in tags if str(tag).strip()]
        if tags is None:
            return []
        text = str(tags).strip()
        return [text] if text else []

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

    def register_routes(self):
        @self.blueprint.route('/characters_with_albums', methods=['GET'])
        def get_album_characters():
            """
            Yuuka: API này giờ chỉ trả về danh sách các character hash có ít nhất 1 ảnh.
            """
            user_hash = self.core_api.verify_token_and_get_user_hash()
            all_user_images = self.core_api.read_data("img_data.json", obfuscated=True)
            user_albums = all_user_images.get(user_hash, {})
            # Trả về danh sách các key (character_hash) nếu chúng có chứa ảnh
            return jsonify([char_hash for char_hash, images in user_albums.items() if images])

        @self.blueprint.route('/albums', methods=['GET'])
        def list_albums():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            albums = self._build_album_list_response(user_hash)
            return jsonify(albums)

        @self.blueprint.route('/comfyui/info', methods=['GET'])
        def comfyui_info():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            character_hash = request.args.get('character_hash')
            server_address = request.args.get('server_address')
            
            global_comfy_config = self.core_api.read_data(self.COMFYUI_CONFIG_FILENAME)
            char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            char_specific_config = char_configs.get(character_hash, {})
            
            latest_image_config = {}
            if character_hash:
                # Yuuka: Lấy ảnh từ service lõi
                images = self.core_api.image_service.get_images_by_character(user_hash, character_hash)
                if images:
                    latest_image_config = images[0]['generationConfig'] # Dữ liệu đã được sắp xếp
            
            final_config = { 
                **self.DEFAULT_CONFIG, 
                **self._sanitize_config(latest_image_config), 
                **self._sanitize_config(global_comfy_config), 
                **self._sanitize_config(char_specific_config) 
            }

            if not final_config.get('hires_base_width'):
                final_config['hires_base_width'] = final_config.get('width', 0)
            if not final_config.get('hires_base_height'):
                final_config['hires_base_height'] = final_config.get('height', 0)
            if final_config.get('hires_enabled'):
                try:
                    base_w = int(final_config.get('hires_base_width') or 0)
                    base_h = int(final_config.get('hires_base_height') or 0)
                except (TypeError, ValueError):
                    base_w = base_h = 0
                if not base_w or not base_h:
                    try:
                        base_w = max(1, int(int(final_config.get('width', 0)) / 2))
                        base_h = max(1, int(int(final_config.get('height', 0)) / 2))
                    except (TypeError, ValueError):
                        base_w, base_h = 0, 0
                final_config['hires_base_width'] = base_w
                final_config['hires_base_height'] = base_h

            target_address = (server_address or final_config.get('server_address', '127.0.0.1:8888')).strip()

            # Yuuka: comfyui fetch optimization v1.0
            if request.args.get('no_choices', 'false').lower() == 'true':
                # Provide a normalized LoRA chain view to help multi-select UIs
                norm_chain = self._normalize_lora_chain(final_config)
                lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
                return jsonify({
                    "last_config": final_config,
                    "normalized_lora_chain": norm_chain,
                    "lora_names": lora_names_simple,
                })

            try:
                all_choices = self.core_api.comfy_api_client.get_full_object_info(target_address)

                base_size_options = [
                    {"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"},
                    {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"},
                    {"name": "IL 1344x768", "value": "1344x768"},
                    {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}
                ]
                size_variants = []
                for option in base_size_options:
                    raw_value = option.get("value", "")
                    try:
                        base_width, base_height = map(int, raw_value.split("x"))
                    except (ValueError, AttributeError):
                        continue

                    base_entry = {
                        "name": option.get("name", f"{base_width}x{base_height}"),
                        "value": f"{base_width}x{base_height}",
                        "dataAttrs": {
                            "mode": "standard",
                            "baseWidth": str(base_width),
                            "baseHeight": str(base_height)
                        }
                    }
                    size_variants.append(base_entry)

                    hires_width = base_width * 2
                    hires_height = base_height * 2
                    hires_entry = {
                        "name": f"{option.get('name', f'{base_width}x{base_height}')} x2 ({hires_width}x{hires_height})",
                        "value": f"{hires_width}x{hires_height}",
                        "dataAttrs": {
                            "mode": "hires",
                            "baseWidth": str(base_width),
                            "baseHeight": str(base_height)
                        }
                    }
                    size_variants.append(hires_entry)

                all_choices["sizes"] = size_variants
                all_choices["checkpoints"] = [{"name": c, "value": c} for c in all_choices.get("checkpoints", [])]
                all_choices["samplers"] = [{"name": s, "value": s} for s in all_choices.get("samplers", [])]
                all_choices["schedulers"] = [{"name": s, "value": s} for s in all_choices.get("schedulers", [])]
                all_choices["hires_upscale_models"] = [{"name": m, "value": m} for m in all_choices.get("upscale_models", [])]
                hires_methods = all_choices.get("upscale_methods") or ["bilinear", "nearest", "nearest-exact", "bicubic", "lanczos", "area"]
                all_choices["hires_upscale_methods"] = [{"name": method, "value": method} for method in hires_methods]
                lora_names = all_choices.get("loras", [])
                lora_options = [{"name": "None", "value": "None"}]
                seen_loras = {"None"}
                for name in lora_names:
                    if not name or name in seen_loras:
                        continue
                    lora_options.append({"name": name, "value": name})
                    seen_loras.add(name)
                all_choices["loras"] = lora_options
                # Multi-LoRA capability hints for frontend
                all_choices["multi_lora_supported"] = True
                all_choices["lora_defaults"] = {
                    "lora_strength_model": self.DEFAULT_CONFIG.get("lora_strength_model", 0.9),
                    "lora_strength_clip": self.DEFAULT_CONFIG.get("lora_strength_clip", 1.0),
                }
                norm_chain = self._normalize_lora_chain(final_config)
                lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
                return jsonify({
                    "global_choices": all_choices,
                    "last_config": final_config,
                    "normalized_lora_chain": norm_chain,
                    "lora_names": lora_names_simple,
                })
            except Exception as e:
                abort(500, description=f"Failed to get info from ComfyUI: {e}")

        @self.blueprint.route('/images/<image_id>/hires', methods=['POST'])
        def start_image_hires(image_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            try:
                character_hash, image_entry = self._find_user_image(user_hash, image_id)
                if not image_entry:
                    abort(404, description="Image not found.")
                if not character_hash:
                    abort(400, description="Unable to resolve character for image.")

                generation_config = image_entry.get("generationConfig") or {}
                if not isinstance(generation_config, dict):
                    generation_config = {}
                generation_config = deepcopy(generation_config)

                hires_flag = generation_config.get("hires_enabled", False)
                if isinstance(hires_flag, str):
                    hires_flag = hires_flag.strip().lower() in ("1", "true", "yes")
                if hires_flag:
                    abort(400, description="Image is already a hires result.")

                original_width = self._safe_int(generation_config.get("width"), self.DEFAULT_CONFIG["width"])
                original_height = self._safe_int(generation_config.get("height"), self.DEFAULT_CONFIG["height"])
                if original_width <= 0 or original_height <= 0:
                    abort(400, description="Invalid base dimensions for source image.")

                server_address = generation_config.get("server_address") or self.DEFAULT_CONFIG["server_address"]
                image_url = image_entry.get("url", "")
                filename = os.path.basename(image_url) if image_url else ""
                if not filename:
                    abort(400, description="Missing source image file reference.")

                image_bytes, _ = self.core_api.get_user_image_data('imgs', filename)
                if not image_bytes:
                    abort(404, description="Source image file could not be loaded.")

                upload_basename = f"album_hires_{image_id.replace('-', '')}.png"
                try:
                    stored_name = self.core_api.comfy_api_client.upload_image_bytes(
                        image_bytes,
                        upload_basename,
                        server_address
                    )
                except ConnectionError as err:
                    abort(503, description=str(err))

                target_width = max(original_width * 2, original_width)
                target_height = max(original_height * 2, original_height)

                generation_config["_workflow_type"] = "hires_input_image"
                generation_config["_input_image_name"] = stored_name
                generation_config["_input_image_width"] = original_width
                generation_config["_input_image_height"] = original_height
                generation_config["hires_base_width"] = original_width
                generation_config["hires_base_height"] = original_height
                generation_config["hires_enabled"] = False
                generation_config["width"] = target_width
                generation_config["height"] = target_height
                generation_config["server_address"] = server_address
                generation_config["lora_prompt_tags"] = self._normalize_lora_tags(
                    generation_config.get("lora_prompt_tags")
                )
                generation_config["seed"] = self._safe_int(generation_config.get("seed"), 0)

                context = {"origin": "album.hires", "source_image_id": image_id}
                task_id, message = self.core_api.generation_service.start_generation_task(
                    user_hash,
                    character_hash,
                    generation_config,
                    context
                )
                if task_id:
                    return jsonify({"status": "started", "task_id": task_id, "message": message})
                return jsonify({"error": message}), 429

            except ConnectionError as err:
                abort(503, description=str(err))
            except Exception as e:
                abort(500, description=f"Failed to start hires generation: {e}")

        @self.blueprint.route('/comfyui/config', methods=['POST'])
        def save_comfyui_config():
            self.core_api.verify_token_and_get_user_hash()
            config_data = request.json
            if not config_data: abort(400, "Missing config data.")
            self.core_api.save_data(self._sanitize_config(config_data), self.COMFYUI_CONFIG_FILENAME)
            return jsonify({"status": "success"})

        # ------------------------------
        # Character view: tag groups CRUD (scene-compatible schema)
        # ------------------------------
        @self.blueprint.route('/character/tag_groups', methods=['GET'])
        def character_get_tag_groups():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            user_groups = self._load_char_tag_groups(user_hash)
            external_groups = self._load_external_char_tag_groups()

            def _norm_key(category_value, name_value) -> tuple[str, str]:
                # Category match is case-insensitive; group-name match is case-sensitive
                # (e.g. ':o' and ':O' must be treated as different groups).
                return (
                    str(category_value or '').strip().casefold(),
                    str(name_value or '').strip(),
                )

            # Return *all* user-owned groups (even if duplicates exist), while hiding
            # external groups that are overridden by a user group with same (category, name).
            cleaned_user_groups: list[dict] = []
            user_keys: set[tuple[str, str]] = set()
            for g in user_groups:
                if not isinstance(g, dict):
                    continue
                cat = str(g.get('category') or '').strip()
                name = str(g.get('name') or '').strip()
                gid = str(g.get('id') or '').strip()
                if not cat or not name or not gid:
                    continue

                # Normalize tags / negative_tags for frontend + downstream tooling.
                try:
                    tags = g.get('tags')
                    if not isinstance(tags, list):
                        tags = []
                    g['tags'] = [str(t).strip() for t in tags if str(t).strip()]

                    neg = g.get('negative_tags')
                    if not isinstance(neg, list):
                        neg = g.get('negativeTags')
                    if not isinstance(neg, list):
                        neg = []
                    g['negative_tags'] = [str(t).strip() for t in neg if str(t).strip()]
                    # Remove legacy key to avoid ambiguity.
                    if 'negativeTags' in g:
                        try:
                            del g['negativeTags']
                        except Exception:
                            pass
                except Exception:
                    pass
                cleaned_user_groups.append(g)
                user_keys.add(_norm_key(cat, name))

            cleaned_external_groups: list[dict] = []
            for g in external_groups:
                if not isinstance(g, dict):
                    continue
                cat = str(g.get('category') or '').strip()
                name = str(g.get('name') or '').strip()
                gid = str(g.get('id') or '').strip()
                if not cat or not name or not gid:
                    continue
                if _norm_key(cat, name) in user_keys:
                    continue

                # External groups may omit negative_tags; normalize to empty list.
                try:
                    tags = g.get('tags')
                    if not isinstance(tags, list):
                        tags = []
                    g['tags'] = [str(t).strip() for t in tags if str(t).strip()]
                    neg = g.get('negative_tags')
                    if not isinstance(neg, list):
                        neg = g.get('negativeTags')
                    if not isinstance(neg, list):
                        neg = []
                    g['negative_tags'] = [str(t).strip() for t in neg if str(t).strip()]
                    if 'negativeTags' in g:
                        try:
                            del g['negativeTags']
                        except Exception:
                            pass
                except Exception:
                    pass
                cleaned_external_groups.append(g)

            groups = cleaned_external_groups + cleaned_user_groups
            return jsonify(self._group_tag_groups_payload(groups))

        @self.blueprint.route('/character/tag_groups', methods=['POST'])
        def character_create_tag_group():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json or {}
            if not all(k in data for k in ['name', 'category', 'tags']):
                abort(400, "Missing fields.")
            name = str(data.get('name') or '').strip()
            category = str(data.get('category') or '').strip()
            tags = data.get('tags')
            negative_tags = data.get('negative_tags')
            if not isinstance(negative_tags, list):
                negative_tags = data.get('negativeTags')
            if not name or not category:
                abort(400, "Invalid fields.")
            if not isinstance(tags, list):
                abort(400, "Invalid tags format.")
            tags = [str(t).strip() for t in tags if str(t).strip()]
            if not tags:
                abort(400, "Tags cannot be empty.")

            if not isinstance(negative_tags, list):
                negative_tags = []
            negative_tags = [str(t).strip() for t in negative_tags if str(t).strip()]

            def _norm_key(category_value, name_value) -> tuple[str, str]:
                # Category match is case-insensitive; group-name match is case-sensitive.
                return (
                    str(category_value or '').strip().casefold(),
                    str(name_value or '').strip(),
                )

            groups = self._load_char_tag_groups(user_hash)
            requested_key = _norm_key(category, name)
            if any(
                isinstance(g, dict) and _norm_key(g.get('category'), g.get('name')) == requested_key
                for g in groups
            ):
                abort(409, f"Tag group '{name}' đã tồn tại trong category '{category}'.")

            existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
            existing_ids.discard('')

            new_group = {
                "id": self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                "name": name,
                "category": category,
                "tags": tags,
                "negative_tags": negative_tags,
            }
            groups.append(new_group)
            self._save_char_tag_groups(user_hash, groups)
            return jsonify(new_group), 201

        @self.blueprint.route('/character/tag_groups/reorder', methods=['POST'])
        def character_reorder_tag_groups():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json or {}
            category = str(data.get('category') or '').strip()
            ordered_ids = data.get('ordered_ids')

            if not category:
                abort(400, "Missing field: category")
            if not isinstance(ordered_ids, list):
                abort(400, "Missing field: ordered_ids")

            ordered_ids = [str(gid).strip() for gid in ordered_ids if str(gid).strip()]
            groups = self._load_char_tag_groups(user_hash)

            # Only re-order user-owned groups (external groups are not stored here)
            cat_groups = [g for g in groups if isinstance(g, dict) and g.get('category') == category]
            by_id = {g.get('id'): g for g in cat_groups if isinstance(g, dict) and g.get('id')}

            new_cat_order = []
            seen = set()
            for gid in ordered_ids:
                if gid in by_id and gid not in seen:
                    new_cat_order.append(by_id[gid])
                    seen.add(gid)

            # Keep any missing groups at the end, preserving original order
            for g in cat_groups:
                gid = g.get('id')
                if gid and gid not in seen:
                    new_cat_order.append(g)
                    seen.add(gid)

            # Rebuild list preserving the relative positions of other categories
            out = []
            inserted = False
            for g in groups:
                if isinstance(g, dict) and g.get('category') == category:
                    if not inserted:
                        out.extend(new_cat_order)
                        inserted = True
                    continue
                out.append(g)
            if not inserted:
                out.extend(new_cat_order)

            self._save_char_tag_groups(user_hash, out)
            return jsonify({"status": "success"})

        @self.blueprint.route('/character/tag_groups/<group_id>', methods=['PUT', 'DELETE'])
        def character_update_or_delete_tag_group(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            groups = self._load_char_tag_groups(user_hash)
            group = next((g for g in groups if g.get('id') == group_id), None)
            if not group:
                if self._is_external_group_id(group_id):
                    abort(403, "External tag groups are read-only.")
                abort(404, "Tag group not found.")

            if request.method == 'PUT':
                data = request.json or {}
                if not all(k in data for k in ['name', 'tags']):
                    abort(400, "Missing required fields: name, tags.")
                name = str(data.get('name') or '').strip()
                tags = data.get('tags')
                negative_tags = data.get('negative_tags')
                if not isinstance(negative_tags, list):
                    negative_tags = data.get('negativeTags')
                if not name:
                    abort(400, "Name cannot be empty.")
                if not isinstance(tags, list):
                    abort(400, "Invalid tags format.")
                tags = [str(t).strip() for t in tags if str(t).strip()]
                if not tags:
                    abort(400, "Tags cannot be empty.")

                if not isinstance(negative_tags, list):
                    negative_tags = []
                negative_tags = [str(t).strip() for t in negative_tags if str(t).strip()]

                def _norm_key(category_value, name_value) -> tuple[str, str]:
                    # Category match is case-insensitive; group-name match is case-sensitive.
                    return (
                        str(category_value or '').strip().casefold(),
                        str(name_value or '').strip(),
                    )

                old_tags = group.get('tags') if isinstance(group.get('tags'), list) else []
                old_tags = [str(t).strip() for t in old_tags if str(t).strip()]
                old_tags_norm = sorted({t for t in old_tags if t})
                new_tags_norm = sorted({t for t in tags if t})

                old_neg = group.get('negative_tags')
                if not isinstance(old_neg, list):
                    old_neg = group.get('negativeTags')
                if not isinstance(old_neg, list):
                    old_neg = []
                old_neg = [str(t).strip() for t in old_neg if str(t).strip()]
                old_neg_norm = sorted({t for t in old_neg if t})
                new_neg_norm = sorted({t for t in negative_tags if t})

                category = str(group.get('category') or '').strip()
                requested_key = _norm_key(category, name)
                if any(
                    isinstance(g, dict)
                    and str(g.get('id') or '').strip() != str(group_id).strip()
                    and _norm_key(g.get('category'), g.get('name')) == requested_key
                    for g in groups
                ):
                    abort(409, f"Tag group with name '{name}' already exists in category '{category}'.")
                group.update({"name": name, "tags": tags, "negative_tags": negative_tags})
                if 'negativeTags' in group:
                    try:
                        del group['negativeTags']
                    except Exception:
                        pass
                self._save_char_tag_groups(user_hash, groups)

                deleted_images = 0
                if old_tags_norm != new_tags_norm or old_neg_norm != new_neg_norm:
                    deleted_images = self._delete_character_images_by_tag_group_id(user_hash, str(group_id))

                payload = dict(group)
                if deleted_images:
                    payload['deleted_images'] = int(deleted_images)
                return jsonify(payload)

            # DELETE
            groups_after = [g for g in groups if g.get('id') != group_id]
            self._save_char_tag_groups(user_hash, groups_after)

            # Cleanup: remove references in saved presets selections
            presets = self._load_char_presets(user_hash)
            changed = False
            for preset in presets:
                if not isinstance(preset, dict):
                    continue
                sel = preset.get('selection')
                if not isinstance(sel, dict):
                    continue
                for cat, gid in list(sel.items()):
                    if gid == group_id:
                        sel[cat] = None
                        changed = True
            if changed:
                self._save_char_presets(user_hash, presets)

            # Cleanup: remove references in States + state-group presets
            try:
                self._cleanup_character_states_for_removed_tag_group_ids(user_hash, [group_id])
            except Exception:
                pass

            return jsonify({"status": "success"})

        @self.blueprint.route('/character/tag_groups/<group_id>/duplicate', methods=['POST'])
        def character_duplicate_tag_group(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            groups = self._load_char_tag_groups(user_hash)
            group = next((g for g in groups if g.get('id') == group_id), None)
            if not group:
                # Allow duplicating external groups into user-owned groups
                if self._is_external_group_id(group_id):
                    ext_groups = self._load_external_char_tag_groups()
                    group = next((g for g in ext_groups if g.get('id') == group_id), None)
                if not group:
                    abort(404, "Tag group not found.")

            base_name = str(group.get('name') or '').strip() or 'Untitled'
            category = str(group.get('category') or '').strip()
            tags = group.get('tags') if isinstance(group.get('tags'), list) else []
            negative_tags = group.get('negative_tags')
            if not isinstance(negative_tags, list):
                negative_tags = group.get('negativeTags')
            if not isinstance(negative_tags, list):
                negative_tags = []

            # Ensure unique name within category
            candidate = f"{base_name} (copy)"
            existing_names = {g.get('name') for g in groups if g.get('category') == category}
            if candidate in existing_names:
                i = 2
                while True:
                    candidate = f"{base_name} (copy {i})"
                    if candidate not in existing_names:
                        break
                    i += 1

            new_group = {
                "id": self._generate_short_tag_group_id(
                    existing_ids={str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)},
                    length=8
                ),
                "name": candidate,
                "category": category,
                "tags": [str(t).strip() for t in tags if str(t).strip()],
                "negative_tags": [str(t).strip() for t in negative_tags if str(t).strip()],
            }
            groups.append(new_group)
            self._save_char_tag_groups(user_hash, groups)
            return jsonify(new_group), 201

        # ------------------------------
        # Character view: State groups + States + State-group presets
        # ------------------------------
        @self.blueprint.route('/character/state_groups/reorder', methods=['POST'])
        def character_reorder_state_groups():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json or {}
            ordered_ids = data.get('ordered_ids')

            if not isinstance(ordered_ids, list):
                abort(400, 'Missing field: ordered_ids')

            ordered_ids = [str(x).strip() for x in ordered_ids if str(x).strip()]
            groups = self._load_char_state_groups(user_hash)
            if not isinstance(groups, list):
                groups = []

            # Ensure defaults exist so reordering never drops protected groups.
            defaults = [
                {'id': 'mood', 'name': 'Mood', 'icon': 'mood', 'color': '#FFFFFF', 'protected': True},
                {'id': 'outfits', 'name': 'Outfits', 'icon': 'checkroom', 'color': '#FFFFFF', 'protected': True},
                {'id': 'action', 'name': 'Action', 'icon': 'directions_run', 'color': '#FFFFFF', 'protected': True},
                {'id': 'context', 'name': 'Context', 'icon': 'landscape', 'color': '#FFFFFF', 'protected': True},
            ]

            cleaned: list[dict] = []
            by_id: dict[str, dict] = {}
            for g in groups:
                if not isinstance(g, dict):
                    continue
                gid = str(g.get('id') or '').strip()
                name = str(g.get('name') or '').strip()
                if not gid or not name:
                    continue
                if gid in by_id:
                    continue
                item = {
                    'id': gid,
                    'name': name,
                    'icon': str(g.get('icon') or '').strip() or 'label',
                    'color': self._sanitize_char_category_color(g.get('color')) or '#FFFFFF',
                    'protected': bool(g.get('protected') is True),
                }
                by_id[gid] = item
                cleaned.append(item)

            changed = False
            for d in defaults:
                gid = str(d['id']).strip()
                if gid in by_id:
                    if by_id[gid].get('protected') is not True:
                        by_id[gid]['protected'] = True
                        changed = True
                    continue
                cleaned.append(d.copy())
                by_id[gid] = cleaned[-1]
                changed = True

            if changed:
                groups = cleaned
            else:
                groups = cleaned

            by_id = {str(g.get('id') or '').strip(): g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip()}
            new_order: list[dict] = []
            seen: set[str] = set()
            for gid in ordered_ids:
                if gid in by_id and gid not in seen:
                    new_order.append(by_id[gid])
                    seen.add(gid)
            for g in groups:
                gid = str(g.get('id') or '').strip()
                if gid and gid not in seen:
                    new_order.append(g)
                    seen.add(gid)

            self._save_char_state_groups(user_hash, new_order)
            return jsonify({'status': 'success'})

        @self.blueprint.route('/character/state_groups', methods=['GET', 'POST'])
        def character_state_groups():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            groups = self._load_char_state_groups(user_hash)
            if not isinstance(groups, list):
                groups = []

            def _sanitize_icon(v):
                try:
                    s = str(v or '').strip()
                    return s or 'label'
                except Exception:
                    return 'label'

            def _sanitize_color(v):
                try:
                    c = self._sanitize_char_category_color(v)
                    return c or '#FFFFFF'
                except Exception:
                    return '#FFFFFF'

            def _ensure_default_state_groups(existing: list[dict]) -> list[dict]:
                """Ensure default protected state groups exist.

                Defaults are editable but not deletable.
                """
                defaults = [
                    {'id': 'mood', 'name': 'Mood', 'icon': 'mood', 'color': '#FFFFFF', 'protected': True},
                    {'id': 'outfits', 'name': 'Outfits', 'icon': 'checkroom', 'color': '#FFFFFF', 'protected': True},
                    {'id': 'action', 'name': 'Action', 'icon': 'directions_run', 'color': '#FFFFFF', 'protected': True},
                    {'id': 'context', 'name': 'Context', 'icon': 'landscape', 'color': '#FFFFFF', 'protected': True},
                ]
                by_id: dict[str, dict] = {}
                cleaned: list[dict] = []
                for g in existing:
                    if not isinstance(g, dict):
                        continue
                    gid = str(g.get('id') or '').strip()
                    name = str(g.get('name') or '').strip()
                    if not gid or not name:
                        continue
                    if gid in by_id:
                        continue
                    item = {
                        'id': gid,
                        'name': name,
                        'icon': _sanitize_icon(g.get('icon')),
                        'color': _sanitize_color(g.get('color')),
                        'protected': bool(g.get('protected') is True),
                    }
                    by_id[gid] = item
                    cleaned.append(item)

                # Inject/upgrade defaults (and mark as protected)
                changed = False
                for d in defaults:
                    gid = str(d['id']).strip()
                    if gid in by_id:
                        # Ensure protected flag is present
                        if by_id[gid].get('protected') is not True:
                            by_id[gid]['protected'] = True
                            changed = True
                        # Fill missing icon/color
                        if not str(by_id[gid].get('icon') or '').strip():
                            by_id[gid]['icon'] = d['icon']
                            changed = True
                        if not str(by_id[gid].get('color') or '').strip():
                            by_id[gid]['color'] = d['color']
                            changed = True
                        continue
                    cleaned.append(d.copy())
                    by_id[gid] = cleaned[-1]
                    changed = True

                if changed:
                    try:
                        self._save_char_state_groups(user_hash, cleaned)
                    except Exception:
                        pass
                return cleaned

            groups = _ensure_default_state_groups(groups)

            if request.method == 'GET':
                cleaned = []
                for g in groups:
                    if not isinstance(g, dict):
                        continue
                    gid = str(g.get('id') or '').strip()
                    name = str(g.get('name') or '').strip()
                    if gid and name:
                        cleaned.append({
                            'id': gid,
                            'name': name,
                            'icon': _sanitize_icon(g.get('icon')),
                            'color': _sanitize_color(g.get('color')),
                            'protected': bool(g.get('protected') is True),
                        })
                return jsonify(cleaned)

            data = request.json or {}
            name = str(data.get('name') or '').strip()
            if not name:
                abort(400, 'Missing field: name')

            # Enforce max total state groups (including defaults)
            try:
                if len([g for g in groups if isinstance(g, dict)]) >= 6:
                    abort(409, 'Max state group limit reached.')
            except Exception:
                pass

            # Unique (case-insensitive) by name
            for g in groups:
                if not isinstance(g, dict):
                    continue
                if str(g.get('name') or '').strip().casefold() == name.casefold():
                    abort(409, 'State group name already exists.')

            existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
            existing_ids.discard('')
            new_group = {
                'id': self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                'name': name,
                'icon': _sanitize_icon(data.get('icon')),
                'color': _sanitize_color(data.get('color')),
                'protected': False,
            }
            groups.append(new_group)
            self._save_char_state_groups(user_hash, groups)
            return jsonify(new_group), 201

        @self.blueprint.route('/character/state_groups/<group_id>', methods=['PUT', 'DELETE'])
        def character_state_group_update_or_delete(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()

            def _sanitize_icon(v):
                try:
                    s = str(v or '').strip()
                    return s or 'label'
                except Exception:
                    return 'label'

            def _sanitize_color(v):
                try:
                    c = self._sanitize_char_category_color(v)
                    return c or '#FFFFFF'
                except Exception:
                    return '#FFFFFF'

            groups = self._load_char_state_groups(user_hash)
            group = next((g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip()), None)
            if not group:
                abort(404, 'State group not found.')

            if request.method == 'PUT':
                data = request.json or {}
                name = str(data.get('name') or '').strip()
                if not name:
                    abort(400, 'Missing field: name')
                for g in groups:
                    if not isinstance(g, dict):
                        continue
                    if str(g.get('id') or '').strip() == str(group_id).strip():
                        continue
                    if str(g.get('name') or '').strip().casefold() == name.casefold():
                        abort(409, 'State group name already exists.')
                group['name'] = name
                # Optional icon/color updates
                if 'icon' in data:
                    group['icon'] = _sanitize_icon(data.get('icon'))
                if 'color' in data:
                    group['color'] = _sanitize_color(data.get('color'))
                self._save_char_state_groups(user_hash, groups)
                return jsonify({
                    'id': str(group.get('id') or '').strip(),
                    'name': name,
                    'icon': _sanitize_icon(group.get('icon')),
                    'color': _sanitize_color(group.get('color')),
                    'protected': bool(group.get('protected') is True),
                })

            # DELETE (cascade)
            if bool(group.get('protected') is True):
                abort(403, 'This state group cannot be deleted.')
            groups_after = [g for g in groups if not (isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip())]
            states = self._load_char_states(user_hash)
            presets = self._load_char_state_group_presets(user_hash)

            removed_state_ids: set[str] = set()
            states_after: list[dict] = []
            for s in states:
                if not isinstance(s, dict):
                    continue
                if str(s.get('group_id') or s.get('groupId') or '').strip() == str(group_id).strip():
                    sid = str(s.get('id') or '').strip()
                    if sid:
                        removed_state_ids.add(sid)
                    continue
                states_after.append(s)

            presets_after: list[dict] = []
            for p in presets:
                if not isinstance(p, dict):
                    continue
                if str(p.get('state_group_id') or p.get('stateGroupId') or '').strip() == str(group_id).strip():
                    continue
                # Also clear any dangling state ids (best-effort)
                st = str(p.get('state_id') or p.get('stateId') or '').strip()
                if st and st in removed_state_ids:
                    p['state_id'] = None
                    if 'stateId' in p:
                        try:
                            p.pop('stateId', None)
                        except Exception:
                            pass
                presets_after.append(p)

            self._save_char_state_groups(user_hash, groups_after)
            self._save_char_states(user_hash, states_after)
            self._save_char_state_group_presets(user_hash, presets_after)
            return jsonify({
                'status': 'success',
                'deleted_group_id': str(group_id),
                'states_removed': int(len(removed_state_ids)),
                'presets_removed': int(len(presets) - len(presets_after)),
            })

        @self.blueprint.route('/character/state_groups/<group_id>/duplicate', methods=['POST'])
        def character_state_group_duplicate(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            groups = self._load_char_state_groups(user_hash)
            group = next((g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip()), None)
            if not group:
                abort(404, 'State group not found.')
            base_name = str(group.get('name') or '').strip() or 'Untitled'
            existing_names = {str((g or {}).get('name') or '').strip() for g in groups if isinstance(g, dict)}

            candidate = f"{base_name} (copy)"
            if candidate in existing_names:
                i = 2
                while True:
                    candidate = f"{base_name} (copy {i})"
                    if candidate not in existing_names:
                        break
                    i += 1

            existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
            existing_ids.discard('')
            new_group = {
                'id': self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                'name': candidate,
            }
            groups.append(new_group)
            self._save_char_state_groups(user_hash, groups)
            return jsonify(new_group), 201

        @self.blueprint.route('/character/states', methods=['GET', 'POST'])
        def character_states():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            states = self._load_char_states(user_hash)
            if not isinstance(states, list):
                states = []

            if request.method == 'GET':
                cleaned = []
                for s in states:
                    if not isinstance(s, dict):
                        continue
                    sid = str(s.get('id') or '').strip()
                    name = str(s.get('name') or '').strip()
                    gid = str(s.get('group_id') or s.get('groupId') or '').strip()
                    tgids = s.get('tag_group_ids') or s.get('tagGroupIds') or s.get('group_ids') or []
                    if not isinstance(tgids, list):
                        tgids = []
                    tgids = [str(x).strip() for x in tgids if str(x).strip()]
                    if sid and name and gid:
                        cleaned.append({
                            'id': sid,
                            'name': name,
                            'group_id': gid,
                            'tag_group_ids': tgids,
                        })
                return jsonify(cleaned)

            data = request.json or {}
            name = str(data.get('name') or '').strip()
            group_id = str(data.get('group_id') or data.get('groupId') or '').strip()
            tag_group_ids = data.get('tag_group_ids') or data.get('tagGroupIds') or data.get('group_ids')
            if not name:
                abort(400, 'Missing field: name')
            if not group_id:
                abort(400, 'Missing field: group_id')
            if not isinstance(tag_group_ids, list):
                tag_group_ids = []
            tgids = []
            seen = set()
            for x in tag_group_ids:
                v = str(x).strip()
                if not v or v in seen:
                    continue
                seen.add(v)
                tgids.append(v)

            groups = self._load_char_state_groups(user_hash)
            if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                abort(404, 'State group not found.')

            # Unique name within same group (case-insensitive)
            for s in states:
                if not isinstance(s, dict):
                    continue
                if str(s.get('group_id') or s.get('groupId') or '').strip() != group_id:
                    continue
                if str(s.get('name') or '').strip().casefold() == name.casefold():
                    abort(409, 'State name already exists in this state group.')

            existing_ids = {str((s or {}).get('id') or '').strip() for s in states if isinstance(s, dict)}
            existing_ids.discard('')
            new_state = {
                'id': self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                'name': name,
                'group_id': group_id,
                'tag_group_ids': tgids,
            }
            states.append(new_state)
            self._save_char_states(user_hash, states)
            return jsonify(new_state), 201

        @self.blueprint.route('/character/states/reorder', methods=['POST'])
        def character_reorder_states():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json or {}
            group_id = str(data.get('group_id') or data.get('groupId') or '').strip()
            ordered_ids = data.get('ordered_ids')

            if not group_id:
                abort(400, 'Missing field: group_id')
            if not isinstance(ordered_ids, list):
                abort(400, 'Missing field: ordered_ids')

            ordered_ids = [str(x).strip() for x in ordered_ids if str(x).strip()]
            states = self._load_char_states(user_hash)
            if not isinstance(states, list):
                states = []

            # Ensure group exists (best-effort)
            try:
                groups = self._load_char_state_groups(user_hash)
                if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in (groups or [])):
                    abort(404, 'State group not found.')
            except Exception:
                pass

            group_states = [s for s in states if isinstance(s, dict) and str(s.get('group_id') or s.get('groupId') or '').strip() == group_id]
            by_id = {str(s.get('id') or '').strip(): s for s in group_states if isinstance(s, dict) and str(s.get('id') or '').strip()}

            new_group_order: list[dict] = []
            seen: set[str] = set()
            for sid in ordered_ids:
                if sid in by_id and sid not in seen:
                    new_group_order.append(by_id[sid])
                    seen.add(sid)
            for s in group_states:
                sid = str(s.get('id') or '').strip()
                if sid and sid not in seen:
                    new_group_order.append(s)
                    seen.add(sid)

            # Rebuild the full list preserving relative positions of other groups.
            out: list[dict] = []
            inserted = False
            for s in states:
                if isinstance(s, dict) and str(s.get('group_id') or s.get('groupId') or '').strip() == group_id:
                    if not inserted:
                        out.extend(new_group_order)
                        inserted = True
                    continue
                if isinstance(s, dict):
                    out.append(s)

            if not inserted:
                out.extend(new_group_order)

            self._save_char_states(user_hash, out)
            return jsonify({'status': 'success'})

        @self.blueprint.route('/character/states/<state_id>', methods=['PUT', 'DELETE'])
        def character_state_update_or_delete(state_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            states = self._load_char_states(user_hash)
            state = next((s for s in states if isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip()), None)
            if not state:
                abort(404, 'State not found.')

            if request.method == 'PUT':
                data = request.json or {}
                name = str(data.get('name') or state.get('name') or '').strip()
                group_id = str(data.get('group_id') or data.get('groupId') or state.get('group_id') or state.get('groupId') or '').strip()
                has_tag_group_ids = any(k in data for k in ('tag_group_ids', 'tagGroupIds', 'group_ids'))
                tag_group_ids = data.get('tag_group_ids') or data.get('tagGroupIds') or data.get('group_ids')
                if not name:
                    abort(400, 'Missing field: name')
                if not group_id:
                    abort(400, 'Missing field: group_id')

                groups = self._load_char_state_groups(user_hash)
                if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                    abort(404, 'State group not found.')

                # Unique name within target group (case-insensitive)
                for s in states:
                    if not isinstance(s, dict):
                        continue
                    if str(s.get('id') or '').strip() == str(state_id).strip():
                        continue
                    if str(s.get('group_id') or s.get('groupId') or '').strip() != group_id:
                        continue
                    if str(s.get('name') or '').strip().casefold() == name.casefold():
                        abort(409, 'State name already exists in this state group.')

                if has_tag_group_ids:
                    if not isinstance(tag_group_ids, list):
                        abort(400, 'Invalid field: tag_group_ids')
                    tgids = []
                    seen = set()
                    for x in tag_group_ids:
                        v = str(x).strip()
                        if not v or v in seen:
                            continue
                        seen.add(v)
                        tgids.append(v)

                    state['tag_group_ids'] = tgids
                    for k in ('tagGroupIds', 'group_ids'):
                        if k in state:
                            try:
                                state.pop(k, None)
                            except Exception:
                                pass

                state['name'] = name
                state['group_id'] = group_id
                if 'groupId' in state:
                    try:
                        state.pop('groupId', None)
                    except Exception:
                        pass
                self._save_char_states(user_hash, states)
                return jsonify({
                    'id': str(state.get('id') or '').strip(),
                    'name': name,
                    'group_id': group_id,
                    'tag_group_ids': state.get('tag_group_ids') if isinstance(state.get('tag_group_ids'), list) else [],
                })

            # DELETE
            states_after = [s for s in states if not (isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip())]
            self._save_char_states(user_hash, states_after)

            # Cleanup: delete presets that reference this state_id (presets cannot be empty)
            try:
                presets = self._load_char_state_group_presets(user_hash)
                if isinstance(presets, list):
                    before = len(presets)
                    presets_after = [
                        p for p in presets
                        if not (
                            isinstance(p, dict)
                            and str(p.get('state_id') or p.get('stateId') or '').strip() == str(state_id).strip()
                        )
                    ]
                    if len(presets_after) != before:
                        self._save_char_state_group_presets(user_hash, presets_after)
            except Exception:
                pass

            return jsonify({'status': 'success'})

        @self.blueprint.route('/character/states/<state_id>/duplicate', methods=['POST'])
        def character_state_duplicate(state_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            states = self._load_char_states(user_hash)
            state = next((s for s in states if isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip()), None)
            if not state:
                abort(404, 'State not found.')

            base_name = str(state.get('name') or '').strip() or 'Untitled'
            group_id = str(state.get('group_id') or state.get('groupId') or '').strip()
            tgids = state.get('tag_group_ids') if isinstance(state.get('tag_group_ids'), list) else []
            tgids = [str(x).strip() for x in tgids if str(x).strip()]

            existing_names = {
                str((s or {}).get('name') or '').strip()
                for s in states
                if isinstance(s, dict) and str((s or {}).get('group_id') or (s or {}).get('groupId') or '').strip() == group_id
            }
            candidate = f"{base_name} (copy)"
            if candidate in existing_names:
                i = 2
                while True:
                    candidate = f"{base_name} (copy {i})"
                    if candidate not in existing_names:
                        break
                    i += 1

            existing_ids = {str((s or {}).get('id') or '').strip() for s in states if isinstance(s, dict)}
            existing_ids.discard('')
            new_state = {
                'id': self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                'name': candidate,
                'group_id': group_id,
                'tag_group_ids': tgids,
            }
            states.append(new_state)
            self._save_char_states(user_hash, states)
            return jsonify(new_state), 201

        @self.blueprint.route('/character/state_groups/<group_id>/presets', methods=['GET', 'POST'])
        def character_state_group_presets(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            group_id = str(group_id or '').strip()
            if not group_id:
                abort(400, 'Missing state group id.')

            groups = self._load_char_state_groups(user_hash)
            if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                abort(404, 'State group not found.')

            presets = self._load_char_state_group_presets(user_hash)
            if not isinstance(presets, list):
                presets = []

            if request.method == 'GET':
                cleaned = []
                for p in presets:
                    if not isinstance(p, dict):
                        continue
                    if str(p.get('state_group_id') or p.get('stateGroupId') or '').strip() != group_id:
                        continue
                    pid = str(p.get('id') or '').strip()
                    name = str(p.get('name') or '').strip()
                    sid = str(p.get('state_id') or p.get('stateId') or '').strip()
                    cleaned.append({
                        'id': pid,
                        'name': name,
                        'state_group_id': group_id,
                        'state_id': sid if sid else None,
                    })
                return jsonify(cleaned)

            data = request.json or {}
            name = str(data.get('name') or '').strip()
            state_id = str(data.get('state_id') or data.get('stateId') or '').strip()
            if not name:
                abort(400, 'Missing field: name')

            # State-group preset cannot be empty -> must pick a state_id
            if not state_id:
                abort(400, 'Missing field: state_id')

            # Optional: validate state_id belongs to group
            states = self._load_char_states(user_hash)
            ok = any(
                isinstance(s, dict)
                and str(s.get('id') or '').strip() == state_id
                and str(s.get('group_id') or s.get('groupId') or '').strip() == group_id
                for s in states
            )
            if not ok:
                abort(400, 'Invalid state_id for this state group.')

            existing_ids = {str((p or {}).get('id') or '').strip() for p in presets if isinstance(p, dict)}
            existing_ids.discard('')
            new_preset = {
                'id': self._generate_short_tag_group_id(existing_ids=existing_ids, length=8),
                'name': name,
                'state_group_id': group_id,
                'state_id': state_id if state_id else None,
            }
            presets.append(new_preset)
            self._save_char_state_group_presets(user_hash, presets)
            return jsonify(new_preset), 201

        @self.blueprint.route('/character/state_groups/<group_id>/presets/<preset_id>', methods=['PUT', 'DELETE'])
        def character_state_group_preset_update_or_delete(group_id, preset_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            group_id = str(group_id or '').strip()
            preset_id = str(preset_id or '').strip()
            if not group_id or not preset_id:
                abort(400, 'Missing id.')

            presets = self._load_char_state_group_presets(user_hash)
            preset = next((p for p in presets if isinstance(p, dict) and str(p.get('id') or '').strip() == preset_id and str(p.get('state_group_id') or p.get('stateGroupId') or '').strip() == group_id), None)
            if not preset:
                abort(404, 'Preset not found.')

            if request.method == 'PUT':
                data = request.json or {}
                name = str(data.get('name') or preset.get('name') or '').strip()
                state_id = str(data.get('state_id') or data.get('stateId') or preset.get('state_id') or preset.get('stateId') or '').strip()
                if not name:
                    abort(400, 'Missing field: name')

                # State-group preset cannot be empty -> state_id is required
                if not state_id:
                    abort(400, 'Missing field: state_id')

                states = self._load_char_states(user_hash)
                ok = any(
                    isinstance(s, dict)
                    and str(s.get('id') or '').strip() == state_id
                    and str(s.get('group_id') or s.get('groupId') or '').strip() == group_id
                    for s in states
                )
                if not ok:
                    abort(400, 'Invalid state_id for this state group.')

                preset['name'] = name
                preset['state_group_id'] = group_id
                preset['state_id'] = state_id
                for k in ('stateGroupId', 'stateId'):
                    if k in preset:
                        try:
                            preset.pop(k, None)
                        except Exception:
                            pass
                self._save_char_state_group_presets(user_hash, presets)
                return jsonify({
                    'id': preset_id,
                    'name': name,
                    'state_group_id': group_id,
                    'state_id': state_id if state_id else None,
                })

            presets_after = [p for p in presets if not (isinstance(p, dict) and str(p.get('id') or '').strip() == preset_id and str(p.get('state_group_id') or p.get('stateGroupId') or '').strip() == group_id)]
            self._save_char_state_group_presets(user_hash, presets_after)
            return jsonify({'status': 'success'})

        # ------------------------------
        # Character view: presets + favourites + settings
        # ------------------------------
        @self.blueprint.route('/character/settings', methods=['GET', 'POST'])
        def character_view_settings():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            settings = self._load_char_view_settings(user_hash)
            if request.method == 'GET':
                categories = settings.get('categories')
                categories = self._sanitize_char_categories(categories)
                if not categories:
                    categories = self._default_char_categories()

                pregen_category_enabled = settings.get('pregen_category_enabled')
                if not isinstance(pregen_category_enabled, dict):
                    pregen_category_enabled = {}
                # Only keep keys that match current categories; default is enabled.
                pregen_category_enabled = {
                    str(c.get('name') or '').strip(): bool(pregen_category_enabled.get(str(c.get('name') or '').strip(), True))
                    for c in categories
                    if str(c.get('name') or '').strip()
                }

                pregen_group_enabled = settings.get('pregen_group_enabled')
                if not isinstance(pregen_group_enabled, dict):
                    pregen_group_enabled = {}
                # Keep as-is (keyed by group id); default is enabled.
                pregen_group_enabled = {
                    str(k): bool(v)
                    for k, v in pregen_group_enabled.items()
                    if str(k).strip()
                }
                return jsonify({
                    # Default enabled (user can disable in settings).
                    "pregen_enabled": bool(settings.get('pregen_enabled', True)),
                    # Default enabled (Visual Novel mode is ON by default).
                    "visual_novel_mode": bool(settings.get('visual_novel_mode', True)),
                    # Default OFF
                    "blur_background": bool(settings.get('blur_background', False)),
                    # Defaults for VN prompting
                    "character_layer_extra_tags": str(settings.get('character_layer_extra_tags') or 'simple background, gray background').strip(),
                    "background_layer_extra_tags": str(settings.get('background_layer_extra_tags') or '').strip(),
                    "categories": categories,
                    "pregen_category_enabled": pregen_category_enabled,
                    "pregen_group_enabled": pregen_group_enabled,
                })

            data = request.json or {}
            pregen_enabled = data.get('pregen_enabled', settings.get('pregen_enabled', True))
            if isinstance(pregen_enabled, str):
                pregen_enabled = pregen_enabled.strip().lower() in ('1', 'true', 'yes', 'on')
            settings['pregen_enabled'] = bool(pregen_enabled)

            # Optional: visual novel mode (default ON)
            if 'visual_novel_mode' in data:
                vnm = data.get('visual_novel_mode', settings.get('visual_novel_mode', True))
                if isinstance(vnm, str):
                    vnm = vnm.strip().lower() in ('1', 'true', 'yes', 'on')
                settings['visual_novel_mode'] = bool(vnm)

            # Optional: blur background (default OFF)
            if 'blur_background' in data:
                bb = data.get('blur_background', settings.get('blur_background', False))
                if isinstance(bb, str):
                    bb = bb.strip().lower() in ('1', 'true', 'yes', 'on')
                settings['blur_background'] = bool(bb)

            # Optional: VN extra tags
            if 'character_layer_extra_tags' in data or 'characterLayerExtraTags' in data:
                raw = data.get('character_layer_extra_tags', data.get('characterLayerExtraTags', settings.get('character_layer_extra_tags', '')))
                settings['character_layer_extra_tags'] = str(raw or '').strip()

            if 'background_layer_extra_tags' in data or 'backgroundLayerExtraTags' in data:
                raw = data.get('background_layer_extra_tags', data.get('backgroundLayerExtraTags', settings.get('background_layer_extra_tags', '')))
                settings['background_layer_extra_tags'] = str(raw or '').strip()

            # Optional: categories with icons
            if 'categories' in data:
                categories = self._sanitize_char_categories(data.get('categories'))
                settings['categories'] = categories

            # Optional: per-category auto toggle map
            if 'pregen_category_enabled' in data:
                m = data.get('pregen_category_enabled')
                if not isinstance(m, dict):
                    abort(400, 'Invalid field: pregen_category_enabled')
                settings['pregen_category_enabled'] = {
                    str(k).strip(): bool(v)
                    for k, v in m.items()
                    if str(k).strip()
                }

            # Optional: per-tag-group auto toggle map (keyed by group id)
            if 'pregen_group_enabled' in data:
                m = data.get('pregen_group_enabled')
                if not isinstance(m, dict):
                    abort(400, 'Invalid field: pregen_group_enabled')
                settings['pregen_group_enabled'] = {
                    str(k).strip(): bool(v)
                    for k, v in m.items()
                    if str(k).strip()
                }

            self._save_char_view_settings(user_hash, settings)
            categories = settings.get('categories')
            categories = self._sanitize_char_categories(categories)
            if not categories:
                categories = self._default_char_categories()

            # Return normalized toggle maps as well
            pregen_category_enabled = settings.get('pregen_category_enabled')
            if not isinstance(pregen_category_enabled, dict):
                pregen_category_enabled = {}
            pregen_category_enabled = {
                str(c.get('name') or '').strip(): bool(pregen_category_enabled.get(str(c.get('name') or '').strip(), True))
                for c in categories
                if str(c.get('name') or '').strip()
            }
            pregen_group_enabled = settings.get('pregen_group_enabled')
            if not isinstance(pregen_group_enabled, dict):
                pregen_group_enabled = {}
            pregen_group_enabled = {
                str(k): bool(v)
                for k, v in pregen_group_enabled.items()
                if str(k).strip()
            }
            return jsonify({
                "status": "success",
                "pregen_enabled": settings['pregen_enabled'],
                "visual_novel_mode": bool(settings.get('visual_novel_mode', True)),
                "blur_background": bool(settings.get('blur_background', False)),
                "character_layer_extra_tags": str(settings.get('character_layer_extra_tags') or 'simple background, gray background').strip(),
                "background_layer_extra_tags": str(settings.get('background_layer_extra_tags') or '').strip(),
                "categories": categories,
                "pregen_category_enabled": pregen_category_enabled,
                "pregen_group_enabled": pregen_group_enabled,
            })

        # ------------------------------
        # Character view: Visual Novel mode global backgrounds (per-user)
        # ------------------------------
        @self.blueprint.route('/character/vn/backgrounds/<path:group_id>', methods=['DELETE'])
        def character_vn_backgrounds_delete(group_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            gid = str(group_id or '').strip()
            if not gid:
                abort(400, 'Missing field: group_id')

            store = self._load_char_vn_backgrounds(user_hash)
            if not isinstance(store, dict):
                store = {}
            existed = gid in store
            store.pop(gid, None)
            self._save_char_vn_backgrounds(user_hash, store)
            return jsonify({'status': 'success', 'group_id': gid, 'deleted': bool(existed)})

        @self.blueprint.route('/character/vn/backgrounds', methods=['GET', 'POST', 'DELETE'])
        def character_vn_backgrounds():
            user_hash = self.core_api.verify_token_and_get_user_hash()

            if request.method == 'GET':
                store = self._load_char_vn_backgrounds(user_hash)
                if not isinstance(store, dict):
                    store = {}
                # Normalize payload
                normalized = {}
                for gid, entry in store.items():
                    key = str(gid or '').strip()
                    if not key:
                        continue
                    if isinstance(entry, dict):
                        url = str(entry.get('url') or '').strip()
                        pv_url = str(entry.get('pv_url') or entry.get('pvUrl') or '').strip()
                        album_hash = str(entry.get('album_hash') or entry.get('albumHash') or '').strip()
                        image_id = str(entry.get('image_id') or '').strip()
                        created_at = entry.get('createdAt')
                        normalized[key] = {
                            'url': url,
                            'pv_url': pv_url,
                            'album_hash': album_hash,
                            'image_id': image_id,
                            'createdAt': created_at,
                        }
                    else:
                        # Legacy: allow raw url
                        url = str(entry or '').strip()
                        normalized[key] = {'url': url, 'pv_url': '', 'album_hash': '', 'image_id': '', 'createdAt': None}
                return jsonify({'backgrounds': normalized})

            if request.method == 'DELETE':
                data = request.json or {}
                group_id = str(
                    request.args.get('group_id')
                    or request.args.get('groupId')
                    or data.get('group_id')
                    or data.get('groupId')
                    or ''
                ).strip()
                if not group_id:
                    abort(400, 'Missing field: group_id')
                store = self._load_char_vn_backgrounds(user_hash)
                if not isinstance(store, dict):
                    store = {}
                existed = group_id in store
                store.pop(group_id, None)
                self._save_char_vn_backgrounds(user_hash, store)
                return jsonify({'status': 'success', 'group_id': group_id, 'deleted': bool(existed)})

            data = request.json or {}
            group_id = str(data.get('group_id') or data.get('groupId') or '').strip()
            if not group_id:
                abort(400, 'Missing field: group_id')
            url = str(data.get('url') or data.get('image_url') or '').strip()
            pv_url = str(data.get('pv_url') or data.get('pvUrl') or data.get('preview_url') or '').strip()
            image_id = str(data.get('image_id') or data.get('imageId') or '').strip()
            album_hash = str(data.get('album_hash') or data.get('albumHash') or '').strip()
            created_at = data.get('createdAt')
            if not url:
                abort(400, 'Missing field: url')

            store = self._load_char_vn_backgrounds(user_hash)
            if not isinstance(store, dict):
                store = {}
            store[group_id] = {
                'url': url,
                'pv_url': pv_url,
                'album_hash': album_hash,
                'image_id': image_id,
                'createdAt': created_at,
            }
            self._save_char_vn_backgrounds(user_hash, store)
            return jsonify({'status': 'success', 'group_id': group_id, 'url': url})

        @self.blueprint.route('/character/vn/background_album', methods=['GET'])
        def character_vn_background_album():
            user_hash = self.core_api.verify_token_and_get_user_hash()
            bg_hash = self._ensure_vn_background_album(user_hash)
            return jsonify({'hash': bg_hash, 'name': 'Background'})

        @self.blueprint.route('/character/categories/<path:category_name>', methods=['DELETE'])
        def character_delete_category(category_name):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            name = str(category_name or '').strip()
            if not name:
                abort(400, 'Missing category name.')

            if self._is_default_char_category_name(name):
                abort(403, 'Default categories cannot be modified.')

            # Remove category from settings
            settings = self._load_char_view_settings(user_hash)
            cats = self._sanitize_char_categories(settings.get('categories'))
            if not cats:
                cats = self._default_char_categories()
            cats_after = [c for c in cats if str(c.get('name') or '').strip().lower() != name.lower()]
            settings['categories'] = cats_after

            # Remove per-category toggle entry
            cat_toggle = settings.get('pregen_category_enabled')
            if isinstance(cat_toggle, dict):
                # remove case-insensitive
                to_remove = None
                for k in list(cat_toggle.keys()):
                    if str(k).strip().lower() == name.lower():
                        to_remove = k
                        break
                if to_remove is not None:
                    cat_toggle.pop(to_remove, None)
                    settings['pregen_category_enabled'] = cat_toggle

            # Remove user-owned tag groups in this category
            groups = self._load_char_tag_groups(user_hash)
            before_count = len(groups)
            groups_after = [g for g in groups if str((g or {}).get('category') or '').strip().lower() != name.lower()]
            removed_groups = before_count - len(groups_after)
            if removed_groups:
                self._save_char_tag_groups(user_hash, groups_after)

            # Cleanup: remove removed tag-group ids from States + state-group presets.
            # (Only applies to user-owned groups removed here; external groups are unaffected.)
            try:
                if removed_groups:
                    removed_ids = {
                        str((g or {}).get('id') or '').strip()
                        for g in groups
                        if str((g or {}).get('category') or '').strip().lower() == name.lower()
                    }
                    removed_ids.discard('')
                    if removed_ids:
                        self._cleanup_character_states_for_removed_tag_group_ids(user_hash, list(removed_ids))
            except Exception:
                pass

            # Cleanup group-level toggle entries for removed groups
            group_toggle = settings.get('pregen_group_enabled')
            if removed_groups and isinstance(group_toggle, dict):
                removed_ids = {
                    str((g or {}).get('id') or '').strip()
                    for g in groups
                    if str((g or {}).get('category') or '').strip().lower() == name.lower()
                }
                removed_ids.discard('')
                if removed_ids:
                    for gid in removed_ids:
                        group_toggle.pop(gid, None)
                    settings['pregen_group_enabled'] = group_toggle

            # Cleanup: remove category key from saved presets selections
            presets = self._load_char_presets(user_hash)
            changed = False
            for preset in presets:
                if not isinstance(preset, dict):
                    continue
                sel = preset.get('selection')
                if not isinstance(sel, dict):
                    continue
                # remove key case-insensitive
                to_remove = None
                for k in list(sel.keys()):
                    if str(k).strip().lower() == name.lower():
                        to_remove = k
                        break
                if to_remove is not None:
                    sel.pop(to_remove, None)
                    changed = True
            if changed:
                self._save_char_presets(user_hash, presets)

            self._save_char_view_settings(user_hash, settings)
            return jsonify({
                'status': 'success',
                'removed_groups': removed_groups,
                'categories': cats_after,
            })

        @self.blueprint.route('/character/categories/<path:category_name>', methods=['PUT'])
        def character_update_category(category_name):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            old_name = str(category_name or '').strip()
            if not old_name:
                abort(400, 'Missing category name.')

            # Allow updating default categories (name + icon). DELETE still remains blocked.

            data = request.json or {}
            new_name = str(data.get('name') or '').strip()
            new_icon = str(data.get('icon') or '').strip() or 'label'
            has_color = 'color' in data
            new_color = self._sanitize_char_category_color(data.get('color')) if has_color else None

            if not new_name:
                abort(400, 'Missing field: name')

            settings = self._load_char_view_settings(user_hash)
            cats = self._sanitize_char_categories(settings.get('categories'))
            if not cats:
                cats = self._default_char_categories()

            # Ensure old exists
            old_exists = any(str(c.get('name') or '').strip().lower() == old_name.lower() for c in cats)
            if not old_exists:
                abort(404, 'Category not found.')

            # Disallow renaming to an existing different category (case-insensitive)
            for c in cats:
                cn = str(c.get('name') or '').strip()
                if not cn:
                    continue
                if cn.lower() == old_name.lower():
                    continue
                if cn.lower() == new_name.lower():
                    abort(409, 'Category name already exists.')

            cats_after: list[dict] = []
            for c in cats:
                cn = str(c.get('name') or '').strip()
                if cn.lower() == old_name.lower():
                    existing_color = c.get('color')
                    target_color = new_color if has_color else existing_color
                    cats_after.append({'name': new_name, 'icon': new_icon, 'color': target_color})
                else:
                    cats_after.append({
                        'name': cn,
                        'icon': str(c.get('icon') or '').strip() or 'label',
                        'color': c.get('color'),
                    })

            settings['categories'] = cats_after

            # Rename per-category toggle key (if exists)
            cat_toggle = settings.get('pregen_category_enabled')
            if isinstance(cat_toggle, dict) and old_name.lower() != new_name.lower():
                old_key = None
                for k in list(cat_toggle.keys()):
                    if str(k).strip().lower() == old_name.lower():
                        old_key = k
                        break
                if old_key is not None:
                    if new_name not in cat_toggle:
                        cat_toggle[new_name] = bool(cat_toggle.get(old_key, True))
                    cat_toggle.pop(old_key, None)
                    settings['pregen_category_enabled'] = cat_toggle

            # Update user-owned tag groups category field
            groups = self._load_char_tag_groups(user_hash)

            # Prevent category rename from creating duplicate (category, name) pairs.
            # This avoids later 409s when editing groups and keeps UI unambiguous.
            if old_name.lower() != new_name.lower():
                target_name_keys: set[str] = set()
                moving_groups: list[dict] = []

                for g in groups:
                    if not isinstance(g, dict):
                        continue
                    cat = str(g.get('category') or '').strip()
                    gn = str(g.get('name') or '').strip()
                    if not cat or not gn:
                        continue
                    if cat.lower() == old_name.lower():
                        moving_groups.append(g)
                        continue
                    if cat.lower() == new_name.lower():
                        target_name_keys.add(gn)

                conflicts: set[str] = set()
                for g in moving_groups:
                    gn = str(g.get('name') or '').strip()
                    if gn and gn in target_name_keys:
                        conflicts.add(gn)

                if conflicts:
                    conflict_list = ', '.join(sorted(conflicts))
                    abort(409, f"Cannot rename category because tag groups would conflict: {conflict_list}")

            changed_groups = False
            for g in groups:
                if not isinstance(g, dict):
                    continue
                cat = str(g.get('category') or '').strip()
                if cat.lower() == old_name.lower():
                    g['category'] = new_name
                    changed_groups = True
            if changed_groups:
                self._save_char_tag_groups(user_hash, groups)

            # Cleanup: rename category key in saved presets selections
            presets = self._load_char_presets(user_hash)
            changed = False
            for preset in presets:
                if not isinstance(preset, dict):
                    continue
                sel = preset.get('selection')
                if not isinstance(sel, dict):
                    continue
                # find key case-insensitive
                old_key = None
                for k in list(sel.keys()):
                    if str(k).strip().lower() == old_name.lower():
                        old_key = k
                        break
                if not old_key:
                    continue
                if new_name not in sel:
                    sel[new_name] = sel.get(old_key)
                sel.pop(old_key, None)
                changed = True
            if changed:
                self._save_char_presets(user_hash, presets)

            self._save_char_view_settings(user_hash, settings)
            return jsonify({
                'status': 'success',
                'categories': cats_after,
                'old_name': old_name,
                'name': new_name,
                'icon': new_icon,
                'color': (new_color if has_color else None),
            })

        @self.blueprint.route('/character/<character_hash>/presets', methods=['GET', 'POST'])
        def character_presets(character_hash):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            # Presets are global per-user (shared across all albums/characters)
            presets = self._load_char_presets(user_hash)
            if not isinstance(presets, list):
                presets = []

            if request.method == 'GET':
                favourites_root = self._load_char_preset_favourites_root(user_hash)
                settings = self._load_char_view_settings(user_hash)
                categories = self._sanitize_char_categories(settings.get('categories'))
                if not categories:
                    categories = self._default_char_categories()

                pregen_category_enabled = settings.get('pregen_category_enabled')
                if not isinstance(pregen_category_enabled, dict):
                    pregen_category_enabled = {}
                pregen_category_enabled = {
                    str(c.get('name') or '').strip(): bool(pregen_category_enabled.get(str(c.get('name') or '').strip(), True))
                    for c in categories
                    if str(c.get('name') or '').strip()
                }

                pregen_group_enabled = settings.get('pregen_group_enabled')
                if not isinstance(pregen_group_enabled, dict):
                    pregen_group_enabled = {}
                pregen_group_enabled = {
                    str(k): bool(v)
                    for k, v in pregen_group_enabled.items()
                    if str(k).strip()
                }
                return jsonify({
                    "presets": presets,
                    "favourites": favourites_root.get(character_hash, {}) if isinstance(favourites_root.get(character_hash, {}), dict) else {},
                    "settings": {
                        "pregen_enabled": bool(settings.get('pregen_enabled', True)),
                        "visual_novel_mode": bool(settings.get('visual_novel_mode', True)),
                        "blur_background": bool(settings.get('blur_background', False)),
                        "character_layer_extra_tags": str(settings.get('character_layer_extra_tags') or 'simple background, gray background').strip(),
                        "background_layer_extra_tags": str(settings.get('background_layer_extra_tags') or '').strip(),
                        "categories": categories,
                        "pregen_category_enabled": pregen_category_enabled,
                        "pregen_group_enabled": pregen_group_enabled,
                    },
                })

            data = request.json or {}
            name = str(data.get('name') or '').strip()
            selection = self._sanitize_selection(data.get('selection') or {})
            if not name:
                abort(400, "Missing preset name.")
            if not isinstance(selection, dict):
                abort(400, "Invalid selection.")
            if any(p.get('name') == name for p in presets if isinstance(p, dict)):
                abort(409, f"Preset '{name}' đã tồn tại.")

            now = int(time.time())
            preset = {
                "id": str(uuid.uuid4()),
                "name": name,
                "selection": selection,
                "created_at": now,
                "updated_at": now,
            }
            presets.append(preset)
            self._save_char_presets(user_hash, presets)
            return jsonify(preset), 201

        @self.blueprint.route('/character/<character_hash>/presets/<preset_id>', methods=['PUT', 'DELETE'])
        def character_preset_update_or_delete(character_hash, preset_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            presets = self._load_char_presets(user_hash)
            if not isinstance(presets, list):
                presets = []
            preset = next((p for p in presets if isinstance(p, dict) and p.get('id') == preset_id), None)
            if not preset:
                abort(404, "Preset not found.")

            if request.method == 'PUT':
                data = request.json or {}
                if 'name' in data:
                    new_name = str(data.get('name') or '').strip()
                    if not new_name:
                        abort(400, "Preset name cannot be empty.")
                    if any(p.get('id') != preset_id and p.get('name') == new_name for p in presets if isinstance(p, dict)):
                        abort(409, f"Preset '{new_name}' đã tồn tại.")
                    preset['name'] = new_name
                if 'selection' in data:
                    preset['selection'] = self._sanitize_selection(data.get('selection') or {})
                preset['updated_at'] = int(time.time())
                self._save_char_presets(user_hash, presets)
                return jsonify(preset)

            # DELETE
            presets_after = [p for p in presets if not (isinstance(p, dict) and p.get('id') == preset_id)]
            self._save_char_presets(user_hash, presets_after)

            # Cleanup favourites entry for this preset (across all characters)
            favourites_root = self._load_char_preset_favourites_root(user_hash)
            changed_fav = False
            for ch, fav_map in list(favourites_root.items()):
                if not isinstance(fav_map, dict):
                    continue
                if preset_id in fav_map:
                    fav_map.pop(preset_id, None)
                    favourites_root[ch] = fav_map
                    changed_fav = True
            if changed_fav:
                self._save_char_preset_favourites_root(user_hash, favourites_root)

            return jsonify({"status": "success"})

        @self.blueprint.route('/character/<character_hash>/presets/<preset_id>/duplicate', methods=['POST'])
        def character_preset_duplicate(character_hash, preset_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            presets = self._load_char_presets(user_hash)
            if not isinstance(presets, list):
                presets = []
            preset = next((p for p in presets if isinstance(p, dict) and p.get('id') == preset_id), None)
            if not preset:
                abort(404, "Preset not found.")

            base_name = str(preset.get('name') or '').strip() or 'Preset'
            candidate = f"{base_name} (copy)"
            existing_names = {p.get('name') for p in presets if isinstance(p, dict)}
            if candidate in existing_names:
                i = 2
                while True:
                    candidate = f"{base_name} (copy {i})"
                    if candidate not in existing_names:
                        break
                    i += 1

            now = int(time.time())
            new_preset = {
                "id": str(uuid.uuid4()),
                "name": candidate,
                "selection": self._sanitize_selection(preset.get('selection') or {}),
                "created_at": now,
                "updated_at": now,
            }
            presets.append(new_preset)
            self._save_char_presets(user_hash, presets)
            return jsonify(new_preset), 201

        @self.blueprint.route('/character/<character_hash>/presets/<preset_id>/favourite', methods=['POST'])
        def character_preset_set_favourite(character_hash, preset_id):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            data = request.json or {}
            image_id = str(data.get('image_id') or '').strip()
            if not image_id:
                abort(400, "Missing image_id.")

            favourites_root = self._load_char_preset_favourites_root(user_hash)
            fav_map = favourites_root.get(character_hash)
            if not isinstance(fav_map, dict):
                fav_map = {}
            fav_map[preset_id] = image_id
            favourites_root[character_hash] = fav_map
            self._save_char_preset_favourites_root(user_hash, favourites_root)
            return jsonify({"status": "success", "preset_id": preset_id, "image_id": image_id})

        @self.blueprint.route('/<character_hash>/config', methods=['POST'])
        def save_character_config(character_hash):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            config_data = request.json
            if not config_data:
                abort(400, "Missing config data.")

            all_char_configs = self.core_api.read_data(self.ALBUM_CHAR_CONFIG_FILENAME)
            sanitized_config = self._sanitize_config(config_data)
            all_char_configs[character_hash] = sanitized_config
            self.core_api.save_data(all_char_configs, self.ALBUM_CHAR_CONFIG_FILENAME)

            # Nếu đây là một nhân vật tùy chỉnh (không có trong database gốc) thì cập nhật danh sách album tùy chỉnh
            if not self.core_api.get_character_by_hash(character_hash):
                self._update_custom_album_entry(
                    user_hash,
                    character_hash,
                    sanitized_config.get("character", "")
                )

            return jsonify({"status": "success", "message": "Character-specific config saved."})
        

        @self.blueprint.route('/<character_hash>', methods=['DELETE'])
        def delete_character_album(character_hash):
            user_hash = self.core_api.verify_token_and_get_user_hash()
            if not character_hash:
                abort(400, "Missing character hash.")

            result = self._delete_character_album(user_hash, character_hash)
            status = "success"
            if (
                not result["images_removed"]
                and not result["config_removed"]
                and not result["custom_removed"]
            ):
                status = "not_found"
            return jsonify({
                "status": status,
                "images_removed": result["images_removed"],
                "config_removed": result["config_removed"],
                "custom_entry_removed": result["custom_removed"],
            })


        # --- Yuuka: TOÀN BỘ CÁC ROUTE VỀ GENERATE VÀ QUẢN LÝ ẢNH ĐÃ ĐƯỢC CHUYỂN SANG LÕI ---

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/album"

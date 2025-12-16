from flask import jsonify, request, abort
import time
import uuid

def register_routes(blueprint, plugin):
    @blueprint.route('/character/<character_hash>/presets', methods=['GET', 'POST'])
    def character_presets(character_hash):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        # Presets are global per-user (shared across all albums/characters)
        presets = plugin._load_char_presets(user_hash)
        if not isinstance(presets, list):
            presets = []

        if request.method == 'GET':
            favourites_root = plugin._load_char_preset_favourites_root(user_hash)
            settings = plugin._load_char_view_settings(user_hash)
            categories = plugin._sanitize_char_categories(settings.get('categories'))
            if not categories:
                categories = plugin._default_char_categories()

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
        selection = plugin._sanitize_selection(data.get('selection') or {})
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
        plugin._save_char_presets(user_hash, presets)
        return jsonify(preset), 201

    @blueprint.route('/character/<character_hash>/presets/<preset_id>', methods=['PUT', 'DELETE'])
    def character_preset_update_or_delete(character_hash, preset_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        presets = plugin._load_char_presets(user_hash)
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
                preset['selection'] = plugin._sanitize_selection(data.get('selection') or {})
            preset['updated_at'] = int(time.time())
            plugin._save_char_presets(user_hash, presets)
            return jsonify(preset)

        # DELETE
        presets_after = [p for p in presets if not (isinstance(p, dict) and p.get('id') == preset_id)]
        plugin._save_char_presets(user_hash, presets_after)

        # Cleanup favourites entry for this preset (across all characters)
        favourites_root = plugin._load_char_preset_favourites_root(user_hash)
        changed_fav = False
        for ch, fav_map in list(favourites_root.items()):
            if not isinstance(fav_map, dict):
                continue
            if preset_id in fav_map:
                fav_map.pop(preset_id, None)
                favourites_root[ch] = fav_map
                changed_fav = True
        if changed_fav:
            plugin._save_char_preset_favourites_root(user_hash, favourites_root)

        return jsonify({"status": "success"})

    @blueprint.route('/character/<character_hash>/presets/<preset_id>/duplicate', methods=['POST'])
    def character_preset_duplicate(character_hash, preset_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        presets = plugin._load_char_presets(user_hash)
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
            "selection": plugin._sanitize_selection(preset.get('selection') or {}),
            "created_at": now,
            "updated_at": now,
        }
        presets.append(new_preset)
        plugin._save_char_presets(user_hash, presets)
        return jsonify(new_preset), 201

    @blueprint.route('/character/<character_hash>/presets/<preset_id>/favourite', methods=['POST'])
    def character_preset_set_favourite(character_hash, preset_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json or {}
        image_id = str(data.get('image_id') or '').strip()
        if not image_id:
            abort(400, "Missing image_id.")

        favourites_root = plugin._load_char_preset_favourites_root(user_hash)
        fav_map = favourites_root.get(character_hash)
        if not isinstance(fav_map, dict):
            fav_map = {}
        fav_map[preset_id] = image_id
        favourites_root[character_hash] = fav_map
        plugin._save_char_preset_favourites_root(user_hash, favourites_root)
        return jsonify({"status": "success", "preset_id": preset_id, "image_id": image_id})

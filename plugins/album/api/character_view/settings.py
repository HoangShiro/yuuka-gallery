from flask import jsonify, request, abort

def register_routes(blueprint, plugin):
    # ------------------------------
    # Character view: presets + favourites + settings
    # ------------------------------
    @blueprint.route('/character/settings', methods=['GET', 'POST'])
    def character_view_settings():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        settings = plugin._load_char_view_settings(user_hash)
        if request.method == 'GET':
            categories = settings.get('categories')
            categories = plugin._sanitize_char_categories(categories)
            if not categories:
                categories = plugin._default_char_categories()

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
            categories = plugin._sanitize_char_categories(data.get('categories'))
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

        plugin._save_char_view_settings(user_hash, settings)
        categories = settings.get('categories')
        categories = plugin._sanitize_char_categories(categories)
        if not categories:
            categories = plugin._default_char_categories()

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

    @blueprint.route('/character/categories/<path:category_name>', methods=['DELETE'])
    def character_delete_category(category_name):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        name = str(category_name or '').strip()
        if not name:
            abort(400, 'Missing category name.')

        if plugin._is_default_char_category_name(name):
            abort(403, 'Default categories cannot be modified.')

        # Remove category from settings
        settings = plugin._load_char_view_settings(user_hash)
        cats = plugin._sanitize_char_categories(settings.get('categories'))
        if not cats:
            cats = plugin._default_char_categories()
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
        groups = plugin._load_char_tag_groups(user_hash)
        before_count = len(groups)
        groups_after = [g for g in groups if str((g or {}).get('category') or '').strip().lower() != name.lower()]
        removed_groups = before_count - len(groups_after)
        if removed_groups:
            plugin._save_char_tag_groups(user_hash, groups_after)

        # Cleanup: remove removed tag-group ids from States (state-group presets removed).
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
                    plugin._cleanup_character_states_for_removed_tag_group_ids(user_hash, list(removed_ids))
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
        presets = plugin._load_char_presets(user_hash)
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
            plugin._save_char_presets(user_hash, presets)

        plugin._save_char_view_settings(user_hash, settings)
        return jsonify({
            'status': 'success',
            'removed_groups': removed_groups,
            'categories': cats_after,
        })

    @blueprint.route('/character/categories/<path:category_name>', methods=['PUT'])
    def character_update_category(category_name):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        old_name = str(category_name or '').strip()
        if not old_name:
            abort(400, 'Missing category name.')

        # Allow updating default categories (name + icon). DELETE still remains blocked.

        data = request.json or {}
        new_name = str(data.get('name') or '').strip()
        new_icon = str(data.get('icon') or '').strip() or 'label'
        has_color = 'color' in data
        new_color = plugin._sanitize_char_category_color(data.get('color')) if has_color else None

        if not new_name:
            abort(400, 'Missing field: name')

        settings = plugin._load_char_view_settings(user_hash)
        cats = plugin._sanitize_char_categories(settings.get('categories'))
        if not cats:
            cats = plugin._default_char_categories()

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
        groups = plugin._load_char_tag_groups(user_hash)

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
            plugin._save_char_tag_groups(user_hash, groups)

        # Cleanup: rename category key in saved presets selections
        presets = plugin._load_char_presets(user_hash)
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
            plugin._save_char_presets(user_hash, presets)

        plugin._save_char_view_settings(user_hash, settings)
        return jsonify({
            'status': 'success',
            'categories': cats_after,
            'old_name': old_name,
            'name': new_name,
            'icon': new_icon,
            'color': (new_color if has_color else None),
        })

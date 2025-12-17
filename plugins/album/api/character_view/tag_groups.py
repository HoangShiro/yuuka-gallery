from flask import jsonify, request, abort
from ...utils import generate_short_tag_group_id

def register_routes(blueprint, plugin):
    # ------------------------------
    # Character view: tag groups CRUD (scene-compatible schema)
    # ------------------------------
    @blueprint.route('/character/tag_groups', methods=['GET'])
    def character_get_tag_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        user_groups = plugin._load_char_tag_groups(user_hash)
        external_groups = plugin._load_external_char_tag_groups()

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

            # Normalize animation presets (playlist). Keep duplicates + order.
            try:
                anim = g.get('animation_presets')
                if not isinstance(anim, list):
                    anim = g.get('animationPresets')
                if not isinstance(anim, list):
                    anim = []
                g['animation_presets'] = [str(x).strip() for x in anim if str(x).strip()]
                if 'animationPresets' in g:
                    try:
                        del g['animationPresets']
                    except Exception:
                        pass
            except Exception:
                pass

            # Normalize sound fx slots (playlist). Keep duplicates + order.
            try:
                s1 = g.get('sound_fx_1')
                if not isinstance(s1, list):
                    s1 = g.get('soundFx1')
                if not isinstance(s1, list):
                    s1 = []
                s1 = [str(x).strip() for x in s1 if str(x).strip()]

                s2 = g.get('sound_fx_2')
                if not isinstance(s2, list):
                    s2 = g.get('soundFx2')
                if not isinstance(s2, list):
                    s2 = []
                s2_raw = [str(x).strip() for x in s2 if str(x).strip()]

                # Enforce no-duplicate across slots (best-effort).
                s1_set = set(s1)
                s2_clean = [x for x in s2_raw if x not in s1_set]

                g['sound_fx_1'] = s1
                g['sound_fx_2'] = s2_clean
                for k in ('soundFx1', 'soundFx2'):
                    if k in g:
                        try:
                            del g[k]
                        except Exception:
                            pass

                # Normalize sound parallel toggles (defaults: fx1 False, fx2 True)
                p1 = g.get('sound_fx_1_parallel')
                if p1 is None:
                    p1 = g.get('soundFx1Parallel')
                p2 = g.get('sound_fx_2_parallel')
                if p2 is None:
                    p2 = g.get('soundFx2Parallel')

                def _to_bool(v, default=False):
                    if isinstance(v, bool):
                        return v
                    if isinstance(v, (int, float)):
                        return bool(v)
                    if isinstance(v, str):
                        s = v.strip().casefold()
                        if s in ('1', 'true', 'yes', 'y', 'on'):
                            return True
                        if s in ('0', 'false', 'no', 'n', 'off', ''):
                            return False
                    return default

                g['sound_fx_1_parallel'] = _to_bool(p1, default=False)
                g['sound_fx_2_parallel'] = _to_bool(p2, default=True)
                for k in ('soundFx1Parallel', 'soundFx2Parallel'):
                    if k in g:
                        try:
                            del g[k]
                        except Exception:
                            pass
            except Exception:
                # Keep schema stable for frontend.
                try:
                    g['sound_fx_1'] = []
                    g['sound_fx_2'] = []
                    g['sound_fx_1_parallel'] = False
                    g['sound_fx_2_parallel'] = True
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

            # External groups may omit animation presets; normalize to empty list.
            try:
                anim = g.get('animation_presets')
                if not isinstance(anim, list):
                    anim = g.get('animationPresets')
                if not isinstance(anim, list):
                    anim = []
                g['animation_presets'] = [str(x).strip() for x in anim if str(x).strip()]
                if 'animationPresets' in g:
                    try:
                        del g['animationPresets']
                    except Exception:
                        pass
            except Exception:
                pass

            # External groups may omit sound fx; normalize to empty lists.
            try:
                s1 = g.get('sound_fx_1')
                if not isinstance(s1, list):
                    s1 = g.get('soundFx1')
                if not isinstance(s1, list):
                    s1 = []
                s2 = g.get('sound_fx_2')
                if not isinstance(s2, list):
                    s2 = g.get('soundFx2')
                if not isinstance(s2, list):
                    s2 = []
                s1 = [str(x).strip() for x in s1 if str(x).strip()]
                s2_raw = [str(x).strip() for x in s2 if str(x).strip()]
                s1_set = set(s1)
                s2 = [x for x in s2_raw if x not in s1_set]
                g['sound_fx_1'] = s1
                g['sound_fx_2'] = s2
                for k in ('soundFx1', 'soundFx2'):
                    if k in g:
                        try:
                            del g[k]
                        except Exception:
                            pass

                # External groups may omit toggles; default.
                p1 = g.get('sound_fx_1_parallel')
                if p1 is None:
                    p1 = g.get('soundFx1Parallel')
                p2 = g.get('sound_fx_2_parallel')
                if p2 is None:
                    p2 = g.get('soundFx2Parallel')

                def _to_bool(v, default=False):
                    if isinstance(v, bool):
                        return v
                    if isinstance(v, (int, float)):
                        return bool(v)
                    if isinstance(v, str):
                        s = v.strip().casefold()
                        if s in ('1', 'true', 'yes', 'y', 'on'):
                            return True
                        if s in ('0', 'false', 'no', 'n', 'off', ''):
                            return False
                    return default

                g['sound_fx_1_parallel'] = _to_bool(p1, default=False)
                g['sound_fx_2_parallel'] = _to_bool(p2, default=True)
                for k in ('soundFx1Parallel', 'soundFx2Parallel'):
                    if k in g:
                        try:
                            del g[k]
                        except Exception:
                            pass
            except Exception:
                try:
                    g['sound_fx_1'] = []
                    g['sound_fx_2'] = []
                    g['sound_fx_1_parallel'] = False
                    g['sound_fx_2_parallel'] = True
                except Exception:
                    pass
            cleaned_external_groups.append(g)

        groups = cleaned_external_groups + cleaned_user_groups
        return jsonify(plugin._group_tag_groups_payload(groups))

    @blueprint.route('/character/tag_groups', methods=['POST'])
    def character_create_tag_group():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json or {}
        if not all(k in data for k in ['name', 'category', 'tags']):
            abort(400, "Missing fields.")
        name = str(data.get('name') or '').strip()
        category = str(data.get('category') or '').strip()
        tags = data.get('tags')
        negative_tags = data.get('negative_tags')
        if not isinstance(negative_tags, list):
            negative_tags = data.get('negativeTags')
        animation_presets = data.get('animation_presets')
        if not isinstance(animation_presets, list):
            animation_presets = data.get('animationPresets')

        sound_fx_1 = data.get('sound_fx_1')
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = data.get('soundFx1')
        sound_fx_2 = data.get('sound_fx_2')
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = data.get('soundFx2')
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

        # Animation presets (playlist): allow duplicates + preserve order.
        if not isinstance(animation_presets, list):
            animation_presets = []
        animation_presets = [str(x).strip() for x in animation_presets if str(x).strip()]

        # Sound fx presets (playlist): allow duplicates + preserve order.
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = []
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = []
        sfx1 = [str(x).strip() for x in sound_fx_1 if str(x).strip()]
        sfx2_raw = [str(x).strip() for x in sound_fx_2 if str(x).strip()]
        sfx1_set = set(sfx1)
        sfx2 = [x for x in sfx2_raw if x not in sfx1_set]

        sound_fx_1_parallel = data.get('sound_fx_1_parallel')
        if sound_fx_1_parallel is None:
            sound_fx_1_parallel = data.get('soundFx1Parallel')
        sound_fx_2_parallel = data.get('sound_fx_2_parallel')
        if sound_fx_2_parallel is None:
            sound_fx_2_parallel = data.get('soundFx2Parallel')

        def _to_bool(v, default=False):
            if isinstance(v, bool):
                return v
            if isinstance(v, (int, float)):
                return bool(v)
            if isinstance(v, str):
                s = v.strip().casefold()
                if s in ('1', 'true', 'yes', 'y', 'on'):
                    return True
                if s in ('0', 'false', 'no', 'n', 'off', ''):
                    return False
            return default

        p1 = _to_bool(sound_fx_1_parallel, default=False)
        p2 = _to_bool(sound_fx_2_parallel, default=True)

        def _norm_key(category_value, name_value) -> tuple[str, str]:
            # Category match is case-insensitive; group-name match is case-sensitive.
            return (
                str(category_value or '').strip().casefold(),
                str(name_value or '').strip(),
            )

        groups = plugin._load_char_tag_groups(user_hash)
        requested_key = _norm_key(category, name)
        if any(
            isinstance(g, dict) and _norm_key(g.get('category'), g.get('name')) == requested_key
            for g in groups
        ):
            abort(409, f"Tag group '{name}' đã tồn tại trong category '{category}'.")

        existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
        existing_ids.discard('')

        new_group = {
            "id": generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            "name": name,
            "category": category,
            "tags": tags,
            "negative_tags": negative_tags,
            "animation_presets": animation_presets,
            "sound_fx_1": sfx1,
            "sound_fx_2": sfx2,
            "sound_fx_1_parallel": p1,
            "sound_fx_2_parallel": p2,
        }
        groups.append(new_group)
        plugin._save_char_tag_groups(user_hash, groups)
        return jsonify(new_group), 201

    @blueprint.route('/character/tag_groups/reorder', methods=['POST'])
    def character_reorder_tag_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json or {}
        category = str(data.get('category') or '').strip()
        ordered_ids = data.get('ordered_ids')

        if not category:
            abort(400, "Missing field: category")
        if not isinstance(ordered_ids, list):
            abort(400, "Missing field: ordered_ids")

        ordered_ids = [str(gid).strip() for gid in ordered_ids if str(gid).strip()]
        groups = plugin._load_char_tag_groups(user_hash)

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

        plugin._save_char_tag_groups(user_hash, out)
        return jsonify({"status": "success"})

    @blueprint.route('/character/tag_groups/<group_id>', methods=['PUT', 'DELETE'])
    def character_update_or_delete_tag_group(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_char_tag_groups(user_hash)
        group = next((g for g in groups if g.get('id') == group_id), None)
        if not group:
            if plugin._is_external_group_id(group_id):
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

            # Optional animation presets update
            has_anim = any(k in data for k in ('animation_presets', 'animationPresets'))
            animation_presets = data.get('animation_presets')
            if not isinstance(animation_presets, list):
                animation_presets = data.get('animationPresets')

            # Optional sound fx update
            has_sfx = any(k in data for k in (
                'sound_fx_1', 'sound_fx_2', 'soundFx1', 'soundFx2',
                'sound_fx_1_parallel', 'sound_fx_2_parallel', 'soundFx1Parallel', 'soundFx2Parallel'
            ))
            sound_fx_1 = data.get('sound_fx_1')
            if not isinstance(sound_fx_1, list):
                sound_fx_1 = data.get('soundFx1')
            sound_fx_2 = data.get('sound_fx_2')
            if not isinstance(sound_fx_2, list):
                sound_fx_2 = data.get('soundFx2')
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

            if has_anim:
                if not isinstance(animation_presets, list):
                    abort(400, 'Invalid field: animation_presets')
                animation_presets = [str(x).strip() for x in animation_presets if str(x).strip()]

            if has_sfx:
                if not isinstance(sound_fx_1, list):
                    abort(400, 'Invalid field: sound_fx_1')
                if not isinstance(sound_fx_2, list):
                    abort(400, 'Invalid field: sound_fx_2')
                sfx1 = [str(x).strip() for x in sound_fx_1 if str(x).strip()]
                sfx2_raw = [str(x).strip() for x in sound_fx_2 if str(x).strip()]
                sfx1_set = set(sfx1)
                sfx2 = [x for x in sfx2_raw if x not in sfx1_set]

                def _to_bool(v, default=False):
                    if isinstance(v, bool):
                        return v
                    if isinstance(v, (int, float)):
                        return bool(v)
                    if isinstance(v, str):
                        s = v.strip().casefold()
                        if s in ('1', 'true', 'yes', 'y', 'on'):
                            return True
                        if s in ('0', 'false', 'no', 'n', 'off', ''):
                            return False
                    return default

                p1_raw = data.get('sound_fx_1_parallel')
                if p1_raw is None:
                    p1_raw = data.get('soundFx1Parallel')
                p2_raw = data.get('sound_fx_2_parallel')
                if p2_raw is None:
                    p2_raw = data.get('soundFx2Parallel')

                p1_default = bool(group.get('sound_fx_1_parallel') is True)
                p2_default = True if group.get('sound_fx_2_parallel') is None else bool(group.get('sound_fx_2_parallel') is True)
                p1 = _to_bool(p1_raw, default=p1_default)
                p2 = _to_bool(p2_raw, default=p2_default)

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
            if has_anim:
                group['animation_presets'] = animation_presets
                if 'animationPresets' in group:
                    try:
                        del group['animationPresets']
                    except Exception:
                        pass
            if has_sfx:
                group['sound_fx_1'] = sfx1
                group['sound_fx_2'] = sfx2
                group['sound_fx_1_parallel'] = p1
                group['sound_fx_2_parallel'] = p2
                for k in ('soundFx1', 'soundFx2', 'soundFx1Parallel', 'soundFx2Parallel'):
                    if k in group:
                        try:
                            del group[k]
                        except Exception:
                            pass
            if 'negativeTags' in group:
                try:
                    del group['negativeTags']
                except Exception:
                    pass
            plugin._save_char_tag_groups(user_hash, groups)

            deleted_images = 0
            if old_tags_norm != new_tags_norm or old_neg_norm != new_neg_norm:
                deleted_images = plugin._delete_character_images_by_tag_group_id(user_hash, str(group_id))

            payload = dict(group)
            if deleted_images:
                payload['deleted_images'] = int(deleted_images)
            return jsonify(payload)

        # DELETE
        groups_after = [g for g in groups if g.get('id') != group_id]
        plugin._save_char_tag_groups(user_hash, groups_after)

        # Cleanup: remove references in saved presets selections
        presets = plugin._load_char_presets(user_hash)
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
            plugin._save_char_presets(user_hash, presets)

        # Cleanup: remove references in States + state-group presets
        try:
            plugin._cleanup_character_states_for_removed_tag_group_ids(user_hash, [group_id])
        except Exception:
            pass

        return jsonify({"status": "success"})

    @blueprint.route('/character/tag_groups/<group_id>/duplicate', methods=['POST'])
    def character_duplicate_tag_group(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_char_tag_groups(user_hash)
        group = next((g for g in groups if g.get('id') == group_id), None)
        if not group:
            # Allow duplicating external groups into user-owned groups
            if plugin._is_external_group_id(group_id):
                ext_groups = plugin._load_external_char_tag_groups()
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

        animation_presets = group.get('animation_presets')
        if not isinstance(animation_presets, list):
            animation_presets = group.get('animationPresets')
        if not isinstance(animation_presets, list):
            animation_presets = []

        sound_fx_1 = group.get('sound_fx_1')
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = group.get('soundFx1')
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = []

        sound_fx_2 = group.get('sound_fx_2')
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = group.get('soundFx2')
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = []

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
            "id": generate_short_tag_group_id(
                existing_ids={str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)},
                length=8
            ),
            "name": candidate,
            "category": category,
            "tags": [str(t).strip() for t in tags if str(t).strip()],
            "negative_tags": [str(t).strip() for t in negative_tags if str(t).strip()],
            "animation_presets": [str(x).strip() for x in animation_presets if str(x).strip()],
            "sound_fx_1": [str(x).strip() for x in sound_fx_1 if str(x).strip()],
            "sound_fx_2": [
                str(x).strip() for x in sound_fx_2
                if str(x).strip() and str(x).strip() not in {str(y).strip() for y in sound_fx_1 if str(y).strip()}
            ],
            "sound_fx_1_parallel": bool(group.get('sound_fx_1_parallel') is True),
            "sound_fx_2_parallel": True if group.get('sound_fx_2_parallel') is None else bool(group.get('sound_fx_2_parallel') is True),
        }
        groups.append(new_group)
        plugin._save_char_tag_groups(user_hash, groups)
        return jsonify(new_group), 201

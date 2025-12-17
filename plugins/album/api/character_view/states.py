from flask import jsonify, request, abort
from ...utils import generate_short_tag_group_id

def register_routes(blueprint, plugin):
    # ------------------------------
    # Character view: State groups + States + State-group presets
    # ------------------------------
    @blueprint.route('/character/state_groups/reorder', methods=['POST'])
    def character_reorder_state_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json or {}
        ordered_ids = data.get('ordered_ids')

        if not isinstance(ordered_ids, list):
            abort(400, 'Missing field: ordered_ids')

        ordered_ids = [str(x).strip() for x in ordered_ids if str(x).strip()]
        groups = plugin._load_char_state_groups(user_hash)
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
                'color': plugin._sanitize_char_category_color(g.get('color')) or '#FFFFFF',
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

        plugin._save_char_state_groups(user_hash, new_order)
        return jsonify({'status': 'success'})

    @blueprint.route('/character/state_groups', methods=['GET', 'POST'])
    def character_state_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_char_state_groups(user_hash)
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
                c = plugin._sanitize_char_category_color(v)
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
                    plugin._save_char_state_groups(user_hash, cleaned)
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
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': name,
            'icon': _sanitize_icon(data.get('icon')),
            'color': _sanitize_color(data.get('color')),
            'protected': False,
        }
        groups.append(new_group)
        plugin._save_char_state_groups(user_hash, groups)
        return jsonify(new_group), 201

    @blueprint.route('/character/state_groups/<group_id>', methods=['PUT', 'DELETE'])
    def character_state_group_update_or_delete(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()

        def _sanitize_icon(v):
            try:
                s = str(v or '').strip()
                return s or 'label'
            except Exception:
                return 'label'

        def _sanitize_color(v):
            try:
                c = plugin._sanitize_char_category_color(v)
                return c or '#FFFFFF'
            except Exception:
                return '#FFFFFF'

        groups = plugin._load_char_state_groups(user_hash)
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
            plugin._save_char_state_groups(user_hash, groups)
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
        states = plugin._load_char_states(user_hash)
        presets = plugin._load_char_state_group_presets(user_hash)

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

        plugin._save_char_state_groups(user_hash, groups_after)
        plugin._save_char_states(user_hash, states_after)
        plugin._save_char_state_group_presets(user_hash, presets_after)
        return jsonify({
            'status': 'success',
            'deleted_group_id': str(group_id),
            'states_removed': int(len(removed_state_ids)),
            'presets_removed': int(len(presets) - len(presets_after)),
        })

    @blueprint.route('/character/state_groups/<group_id>/duplicate', methods=['POST'])
    def character_state_group_duplicate(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_char_state_groups(user_hash)
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
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': candidate,
        }
        groups.append(new_group)
        plugin._save_char_state_groups(user_hash, groups)
        return jsonify(new_group), 201

    @blueprint.route('/character/states', methods=['GET', 'POST'])
    def character_states():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        states = plugin._load_char_states(user_hash)
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

                anim = s.get('animation_presets')
                if not isinstance(anim, list):
                    anim = s.get('animationPresets')
                if not isinstance(anim, list):
                    anim = []
                anim = [str(x).strip() for x in anim if str(x).strip()]

                sfx1 = s.get('sound_fx_1')
                if not isinstance(sfx1, list):
                    sfx1 = s.get('soundFx1')
                if not isinstance(sfx1, list):
                    sfx1 = []
                sfx1 = [str(x).strip() for x in sfx1 if str(x).strip()]

                sfx2 = s.get('sound_fx_2')
                if not isinstance(sfx2, list):
                    sfx2 = s.get('soundFx2')
                if not isinstance(sfx2, list):
                    sfx2 = []
                sfx2_raw = [str(x).strip() for x in sfx2 if str(x).strip()]
                sfx1_set = set(sfx1)
                sfx2 = [x for x in sfx2_raw if x not in sfx1_set]

                p1 = s.get('sound_fx_1_parallel')
                if p1 is None:
                    p1 = s.get('soundFx1Parallel')
                p2 = s.get('sound_fx_2_parallel')
                if p2 is None:
                    p2 = s.get('soundFx2Parallel')

                def _to_bool(v, default=False):
                    if isinstance(v, bool):
                        return v
                    if isinstance(v, (int, float)):
                        return bool(v)
                    if isinstance(v, str):
                        sv = v.strip().casefold()
                        if sv in ('1', 'true', 'yes', 'y', 'on'):
                            return True
                        if sv in ('0', 'false', 'no', 'n', 'off', ''):
                            return False
                    return default

                p1 = _to_bool(p1, default=False)
                p2 = _to_bool(p2, default=True)

                if sid and name and gid:
                    cleaned.append({
                        'id': sid,
                        'name': name,
                        'group_id': gid,
                        'tag_group_ids': tgids,
                        'animation_presets': anim,
                        'sound_fx_1': sfx1,
                        'sound_fx_2': sfx2,
                        'sound_fx_1_parallel': p1,
                        'sound_fx_2_parallel': p2,
                    })
            return jsonify(cleaned)

        data = request.json or {}
        name = str(data.get('name') or '').strip()
        group_id = str(data.get('group_id') or data.get('groupId') or '').strip()
        tag_group_ids = data.get('tag_group_ids') or data.get('tagGroupIds') or data.get('group_ids')
        animation_presets = data.get('animation_presets')
        if not isinstance(animation_presets, list):
            animation_presets = data.get('animationPresets')

        sound_fx_1 = data.get('sound_fx_1')
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = data.get('soundFx1')
        sound_fx_2 = data.get('sound_fx_2')
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = data.get('soundFx2')

        sound_fx_1_parallel = data.get('sound_fx_1_parallel')
        if sound_fx_1_parallel is None:
            sound_fx_1_parallel = data.get('soundFx1Parallel')
        sound_fx_2_parallel = data.get('sound_fx_2_parallel')
        if sound_fx_2_parallel is None:
            sound_fx_2_parallel = data.get('soundFx2Parallel')
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

        # Animation presets (playlist): allow duplicates + preserve order.
        if not isinstance(animation_presets, list):
            animation_presets = []
        anim_list = [str(x).strip() for x in animation_presets if str(x).strip()]

        # Sound fx presets (playlist): allow duplicates + preserve order.
        if not isinstance(sound_fx_1, list):
            sound_fx_1 = []
        if not isinstance(sound_fx_2, list):
            sound_fx_2 = []
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
                sv = v.strip().casefold()
                if sv in ('1', 'true', 'yes', 'y', 'on'):
                    return True
                if sv in ('0', 'false', 'no', 'n', 'off', ''):
                    return False
            return default

        p1 = _to_bool(sound_fx_1_parallel, default=False)
        p2 = _to_bool(sound_fx_2_parallel, default=True)

        groups = plugin._load_char_state_groups(user_hash)
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
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': name,
            'group_id': group_id,
            'tag_group_ids': tgids,
            'animation_presets': anim_list,
            'sound_fx_1': sfx1,
            'sound_fx_2': sfx2,
            'sound_fx_1_parallel': p1,
            'sound_fx_2_parallel': p2,
        }
        states.append(new_state)
        plugin._save_char_states(user_hash, states)
        return jsonify(new_state), 201

    @blueprint.route('/character/states/reorder', methods=['POST'])
    def character_reorder_states():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json or {}
        group_id = str(data.get('group_id') or data.get('groupId') or '').strip()
        ordered_ids = data.get('ordered_ids')

        if not group_id:
            abort(400, 'Missing field: group_id')
        if not isinstance(ordered_ids, list):
            abort(400, 'Missing field: ordered_ids')

        ordered_ids = [str(x).strip() for x in ordered_ids if str(x).strip()]
        states = plugin._load_char_states(user_hash)
        if not isinstance(states, list):
            states = []

        # Ensure group exists (best-effort)
        try:
            groups = plugin._load_char_state_groups(user_hash)
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

        plugin._save_char_states(user_hash, out)
        return jsonify({'status': 'success'})

    @blueprint.route('/character/states/<state_id>', methods=['PUT', 'DELETE'])
    def character_state_update_or_delete(state_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        states = plugin._load_char_states(user_hash)
        state = next((s for s in states if isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip()), None)
        if not state:
            abort(404, 'State not found.')

        if request.method == 'PUT':
            data = request.json or {}
            name = str(data.get('name') or state.get('name') or '').strip()
            group_id = str(data.get('group_id') or data.get('groupId') or state.get('group_id') or state.get('groupId') or '').strip()
            has_tag_group_ids = any(k in data for k in ('tag_group_ids', 'tagGroupIds', 'group_ids'))
            tag_group_ids = data.get('tag_group_ids') or data.get('tagGroupIds') or data.get('group_ids')
            has_anim = any(k in data for k in ('animation_presets', 'animationPresets'))
            animation_presets = data.get('animation_presets')
            if not isinstance(animation_presets, list):
                animation_presets = data.get('animationPresets')

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
                abort(400, 'Missing field: name')
            if not group_id:
                abort(400, 'Missing field: group_id')

            groups = plugin._load_char_state_groups(user_hash)
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

            if has_anim:
                if not isinstance(animation_presets, list):
                    abort(400, 'Invalid field: animation_presets')
                anim_list = [str(x).strip() for x in animation_presets if str(x).strip()]
                state['animation_presets'] = anim_list
                if 'animationPresets' in state:
                    try:
                        state.pop('animationPresets', None)
                    except Exception:
                        pass

            if has_sfx:
                if not isinstance(sound_fx_1, list):
                    abort(400, 'Invalid field: sound_fx_1')
                if not isinstance(sound_fx_2, list):
                    abort(400, 'Invalid field: sound_fx_2')
                sfx1 = [str(x).strip() for x in sound_fx_1 if str(x).strip()]
                sfx2_raw = [str(x).strip() for x in sound_fx_2 if str(x).strip()]
                sfx1_set = set(sfx1)
                sfx2 = [x for x in sfx2_raw if x not in sfx1_set]

                p1_raw = data.get('sound_fx_1_parallel')
                if p1_raw is None:
                    p1_raw = data.get('soundFx1Parallel')
                p2_raw = data.get('sound_fx_2_parallel')
                if p2_raw is None:
                    p2_raw = data.get('soundFx2Parallel')

                def _to_bool(v, default=False):
                    if isinstance(v, bool):
                        return v
                    if isinstance(v, (int, float)):
                        return bool(v)
                    if isinstance(v, str):
                        sv = v.strip().casefold()
                        if sv in ('1', 'true', 'yes', 'y', 'on'):
                            return True
                        if sv in ('0', 'false', 'no', 'n', 'off', ''):
                            return False
                    return default

                p1_default = bool(state.get('sound_fx_1_parallel') is True)
                p2_default = True if state.get('sound_fx_2_parallel') is None else bool(state.get('sound_fx_2_parallel') is True)
                p1 = _to_bool(p1_raw, default=p1_default)
                p2 = _to_bool(p2_raw, default=p2_default)
                state['sound_fx_1'] = sfx1
                state['sound_fx_2'] = sfx2
                state['sound_fx_1_parallel'] = p1
                state['sound_fx_2_parallel'] = p2
                for k in ('soundFx1', 'soundFx2', 'soundFx1Parallel', 'soundFx2Parallel'):
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
            plugin._save_char_states(user_hash, states)
            return jsonify({
                'id': str(state.get('id') or '').strip(),
                'name': name,
                'group_id': group_id,
                'tag_group_ids': state.get('tag_group_ids') if isinstance(state.get('tag_group_ids'), list) else [],
                'animation_presets': state.get('animation_presets') if isinstance(state.get('animation_presets'), list) else [],
                'sound_fx_1': state.get('sound_fx_1') if isinstance(state.get('sound_fx_1'), list) else [],
                'sound_fx_2': state.get('sound_fx_2') if isinstance(state.get('sound_fx_2'), list) else [],
                'sound_fx_1_parallel': bool(state.get('sound_fx_1_parallel') is True),
                'sound_fx_2_parallel': True if state.get('sound_fx_2_parallel') is None else bool(state.get('sound_fx_2_parallel') is True),
            })

        # DELETE
        states_after = [s for s in states if not (isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip())]
        plugin._save_char_states(user_hash, states_after)

        # Cleanup: delete presets that reference this state_id (presets cannot be empty)
        try:
            presets = plugin._load_char_state_group_presets(user_hash)
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
                    plugin._save_char_state_group_presets(user_hash, presets_after)
        except Exception:
            pass

        return jsonify({'status': 'success'})

    @blueprint.route('/character/states/<state_id>/duplicate', methods=['POST'])
    def character_state_duplicate(state_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        states = plugin._load_char_states(user_hash)
        state = next((s for s in states if isinstance(s, dict) and str(s.get('id') or '').strip() == str(state_id).strip()), None)
        if not state:
            abort(404, 'State not found.')

        base_name = str(state.get('name') or '').strip() or 'Untitled'
        group_id = str(state.get('group_id') or state.get('groupId') or '').strip()
        tgids = state.get('tag_group_ids') if isinstance(state.get('tag_group_ids'), list) else []
        tgids = [str(x).strip() for x in tgids if str(x).strip()]

        anim = state.get('animation_presets')
        if not isinstance(anim, list):
            anim = state.get('animationPresets')
        if not isinstance(anim, list):
            anim = []
        anim = [str(x).strip() for x in anim if str(x).strip()]

        sfx1 = state.get('sound_fx_1')
        if not isinstance(sfx1, list):
            sfx1 = state.get('soundFx1')
        if not isinstance(sfx1, list):
            sfx1 = []
        sfx1 = [str(x).strip() for x in sfx1 if str(x).strip()]

        sfx2 = state.get('sound_fx_2')
        if not isinstance(sfx2, list):
            sfx2 = state.get('soundFx2')
        if not isinstance(sfx2, list):
            sfx2 = []
        sfx2_raw = [str(x).strip() for x in sfx2 if str(x).strip()]
        sfx1_set = set(sfx1)
        sfx2 = [x for x in sfx2_raw if x not in sfx1_set]

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
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': candidate,
            'group_id': group_id,
            'tag_group_ids': tgids,
            'animation_presets': anim,
            'sound_fx_1': sfx1,
            'sound_fx_2': sfx2,
            'sound_fx_1_parallel': bool(state.get('sound_fx_1_parallel') is True),
            'sound_fx_2_parallel': True if state.get('sound_fx_2_parallel') is None else bool(state.get('sound_fx_2_parallel') is True),
        }
        states.append(new_state)
        plugin._save_char_states(user_hash, states)
        return jsonify(new_state), 201

    @blueprint.route('/character/state_groups/<group_id>/presets', methods=['GET', 'POST'])
    def character_state_group_presets(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        group_id = str(group_id or '').strip()
        if not group_id:
            abort(400, 'Missing state group id.')

        groups = plugin._load_char_state_groups(user_hash)
        if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
            abort(404, 'State group not found.')

        presets = plugin._load_char_state_group_presets(user_hash)
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
        states = plugin._load_char_states(user_hash)
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
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': name,
            'state_group_id': group_id,
            'state_id': state_id if state_id else None,
        }
        presets.append(new_preset)
        plugin._save_char_state_group_presets(user_hash, presets)
        return jsonify(new_preset), 201

    @blueprint.route('/character/state_groups/<group_id>/presets/<preset_id>', methods=['PUT', 'DELETE'])
    def character_state_group_preset_update_or_delete(group_id, preset_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        group_id = str(group_id or '').strip()
        preset_id = str(preset_id or '').strip()
        if not group_id or not preset_id:
            abort(400, 'Missing id.')

        presets = plugin._load_char_state_group_presets(user_hash)
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

            states = plugin._load_char_states(user_hash)
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
            plugin._save_char_state_group_presets(user_hash, presets)
            return jsonify({
                'id': preset_id,
                'name': name,
                'state_group_id': group_id,
                'state_id': state_id if state_id else None,
            })

        presets_after = [p for p in presets if not (isinstance(p, dict) and str(p.get('id') or '').strip() == preset_id and str(p.get('state_group_id') or p.get('stateGroupId') or '').strip() == group_id)]
        plugin._save_char_state_group_presets(user_hash, presets_after)
        return jsonify({'status': 'success'})

from flask import jsonify, request, abort
import time

from ..utils import generate_short_tag_group_id


def register_routes(blueprint, plugin):
    # ------------------------------
    # Animation: preset groups
    # ------------------------------
    @blueprint.route('/animation/groups', methods=['GET', 'POST'])
    def animation_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_animation_groups(user_hash)
        if not isinstance(groups, list):
            groups = []

        if request.method == 'GET':
            cleaned = []
            for g in groups:
                if not isinstance(g, dict):
                    continue
                gid = str(g.get('id') or '').strip()
                name = str(g.get('name') or '').strip()
                if gid and name:
                    cleaned.append({'id': gid, 'name': name})
            return jsonify(cleaned)

        data = request.json or {}
        name = str(data.get('name') or '').strip()
        if not name:
            abort(400, 'Missing field: name')

        # Unique (case-insensitive) by name
        if any(isinstance(g, dict) and str(g.get('name') or '').strip().casefold() == name.casefold() for g in groups):
            abort(409, 'Animation group name already exists.')

        existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
        existing_ids.discard('')
        new_group = {
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': name,
            'created_at': int(time.time()),
            'updated_at': int(time.time()),
        }
        groups.append(new_group)
        plugin._save_animation_groups(user_hash, groups)
        return jsonify({'id': new_group['id'], 'name': new_group['name']}), 201

    @blueprint.route('/animation/groups/<group_id>', methods=['PUT', 'DELETE'])
    def animation_group_update_or_delete(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_animation_groups(user_hash)
        if not isinstance(groups, list):
            groups = []

        group = next((g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip()), None)
        if not group:
            abort(404, 'Animation group not found.')

        if request.method == 'PUT':
            data = request.json or {}
            name = str(data.get('name') or '').strip()
            if not name:
                abort(400, 'Missing field: name')
            # Unique by name excluding self
            for g in groups:
                if not isinstance(g, dict):
                    continue
                if str(g.get('id') or '').strip() == str(group_id).strip():
                    continue
                if str(g.get('name') or '').strip().casefold() == name.casefold():
                    abort(409, 'Animation group name already exists.')
            group['name'] = name
            group['updated_at'] = int(time.time())
            plugin._save_animation_groups(user_hash, groups)
            return jsonify({'id': str(group.get('id') or '').strip(), 'name': name})

        # DELETE: detach presets that point to this group
        groups_after = [g for g in groups if not (isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip())]
        plugin._save_animation_groups(user_hash, groups_after)

        presets = plugin._load_animation_presets(user_hash)
        changed = False
        for p in presets:
            if not isinstance(p, dict):
                continue
            if str(p.get('group_id') or '').strip() == str(group_id).strip():
                p['group_id'] = None
                changed = True
        if changed:
            plugin._save_animation_presets(user_hash, presets)

        return jsonify({'status': 'success'})

    @blueprint.route('/animation/groups/<group_id>/duplicate', methods=['POST'])
    def animation_group_duplicate(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_animation_groups(user_hash)
        if not isinstance(groups, list):
            groups = []
        group = next((g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip()), None)
        if not group:
            abort(404, 'Animation group not found.')

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
        now = int(time.time())
        new_group = {
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': candidate,
            'created_at': now,
            'updated_at': now,
        }
        groups.append(new_group)
        plugin._save_animation_groups(user_hash, groups)
        return jsonify({'id': new_group['id'], 'name': new_group['name']}), 201

    # ------------------------------
    # Animation: presets
    # ------------------------------
    @blueprint.route('/animation/presets', methods=['GET', 'POST'])
    def animation_presets():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        presets = plugin._load_animation_presets(user_hash)
        if not isinstance(presets, list):
            presets = []

        if request.method == 'GET':
            cleaned = []
            for p in presets:
                if not isinstance(p, dict):
                    continue
                key = str(p.get('key') or '').strip()
                if not key:
                    continue
                cleaned.append({
                    'key': key,
                    'timeline': p.get('timeline') if isinstance(p.get('timeline'), (list, dict)) else [],
                    'graph_type': str(p.get('graph_type') or '').strip(),
                    'group_id': (str(p.get('group_id') or '').strip() or None),
                    'created_at': int(p.get('created_at') or 0),
                    'updated_at': int(p.get('updated_at') or 0),
                })
            return jsonify(cleaned)

        data = request.json or {}
        key = plugin._sanitize_animation_key(data.get('key'))
        timeline = plugin._sanitize_animation_timeline(data.get('timeline'))
        graph_type = plugin._sanitize_animation_graph_type(data.get('graph_type') or data.get('graphType'))
        group_id = str(data.get('group_id') or data.get('groupId') or '').strip() or None

        if not key:
            abort(400, 'Missing field: key')
        if not graph_type:
            abort(400, 'Missing field: graph_type')

        if any(isinstance(p, dict) and str(p.get('key') or '').strip() == key for p in presets):
            abort(409, f"Animation preset '{key}' already exists.")

        if group_id:
            groups = plugin._load_animation_groups(user_hash)
            if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                abort(404, 'Animation group not found.')

        now = int(time.time())
        preset = {
            'key': key,
            'timeline': timeline,
            'graph_type': graph_type,
            'group_id': group_id,
            'created_at': now,
            'updated_at': now,
        }
        presets.append(preset)
        plugin._save_animation_presets(user_hash, presets)
        return jsonify(preset), 201

    @blueprint.route('/animation/presets/<path:preset_key>', methods=['PUT', 'DELETE'])
    def animation_preset_update_or_delete(preset_key):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        preset_key = str(preset_key or '').strip()
        presets = plugin._load_animation_presets(user_hash)
        if not isinstance(presets, list):
            presets = []

        preset = next((p for p in presets if isinstance(p, dict) and str(p.get('key') or '').strip() == preset_key), None)
        if not preset:
            abort(404, 'Animation preset not found.')

        if request.method == 'PUT':
            data = request.json or {}

            # Optional: rename key
            if 'key' in data:
                new_key = plugin._sanitize_animation_key(data.get('key'))
                if not new_key:
                    abort(400, 'Preset key cannot be empty.')
                if new_key != preset_key and any(isinstance(p, dict) and str(p.get('key') or '').strip() == new_key for p in presets):
                    abort(409, f"Animation preset '{new_key}' already exists.")
                preset['key'] = new_key
                preset_key = new_key

            if 'timeline' in data:
                preset['timeline'] = plugin._sanitize_animation_timeline(data.get('timeline'))

            if 'graph_type' in data or 'graphType' in data:
                gt = plugin._sanitize_animation_graph_type(data.get('graph_type') or data.get('graphType'))
                if not gt:
                    abort(400, 'graph_type cannot be empty.')
                preset['graph_type'] = gt

            if 'group_id' in data or 'groupId' in data:
                group_id = str(data.get('group_id') or data.get('groupId') or '').strip() or None
                if group_id:
                    groups = plugin._load_animation_groups(user_hash)
                    if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                        abort(404, 'Animation group not found.')
                preset['group_id'] = group_id

            preset['updated_at'] = int(time.time())
            plugin._save_animation_presets(user_hash, presets)
            return jsonify(preset)

        # DELETE
        presets_after = [p for p in presets if not (isinstance(p, dict) and str(p.get('key') or '').strip() == preset_key)]
        plugin._save_animation_presets(user_hash, presets_after)
        return jsonify({'status': 'success'})

    @blueprint.route('/animation/presets/<path:preset_key>/duplicate', methods=['POST'])
    def animation_preset_duplicate(preset_key):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        preset_key = str(preset_key or '').strip()
        presets = plugin._load_animation_presets(user_hash)
        if not isinstance(presets, list):
            presets = []
        preset = next((p for p in presets if isinstance(p, dict) and str(p.get('key') or '').strip() == preset_key), None)
        if not preset:
            abort(404, 'Animation preset not found.')

        base_key = str(preset.get('key') or '').strip() or 'preset'
        candidate = f"{base_key}_copy"
        existing_keys = {str((p or {}).get('key') or '').strip() for p in presets if isinstance(p, dict)}
        if candidate in existing_keys:
            i = 2
            while True:
                candidate = f"{base_key}_copy{i}"
                if candidate not in existing_keys:
                    break
                i += 1

        now = int(time.time())
        new_preset = {
            'key': candidate,
            'timeline': preset.get('timeline') if isinstance(preset.get('timeline'), (list, dict)) else [],
            'graph_type': str(preset.get('graph_type') or '').strip(),
            'group_id': (str(preset.get('group_id') or '').strip() or None),
            'created_at': now,
            'updated_at': now,
        }
        if not new_preset.get('graph_type'):
            new_preset['graph_type'] = 'linear'

        presets.append(new_preset)
        plugin._save_animation_presets(user_hash, presets)
        return jsonify(new_preset), 201

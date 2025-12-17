from flask import jsonify, request, abort, Response
import time
import uuid
import os

from ..utils import generate_short_tag_group_id


def _ext_from_filename(filename: str) -> str:
    try:
        base = os.path.basename(filename or '')
        _, ext = os.path.splitext(base)
        return (ext or '').lstrip('.').lower()
    except Exception:
        return ''


def register_routes(blueprint, plugin):
    # ------------------------------
    # Sound FX: groups
    # ------------------------------
    @blueprint.route('/sound_fx/groups', methods=['GET', 'POST'])
    def sound_fx_groups():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_sound_fx_groups(user_hash)
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

        if any(isinstance(g, dict) and str(g.get('name') or '').strip().casefold() == name.casefold() for g in groups):
            abort(409, 'Sound FX group name already exists.')

        existing_ids = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
        existing_ids.discard('')
        now = int(time.time())
        new_group = {
            'id': generate_short_tag_group_id(existing_ids=existing_ids, length=8),
            'name': name,
            'created_at': now,
            'updated_at': now,
        }
        groups.append(new_group)
        plugin._save_sound_fx_groups(user_hash, groups)
        return jsonify({'id': new_group['id'], 'name': new_group['name']}), 201

    @blueprint.route('/sound_fx/groups/<group_id>', methods=['PUT', 'DELETE'])
    def sound_fx_group_update_or_delete(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        groups = plugin._load_sound_fx_groups(user_hash)
        if not isinstance(groups, list):
            groups = []

        group = next((g for g in groups if isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip()), None)
        if not group:
            abort(404, 'Sound FX group not found.')

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
                    abort(409, 'Sound FX group name already exists.')
            group['name'] = name
            group['updated_at'] = int(time.time())
            plugin._save_sound_fx_groups(user_hash, groups)
            return jsonify({'id': str(group.get('id') or '').strip(), 'name': name})

        # DELETE: detach presets pointing to this group
        groups_after = [g for g in groups if not (isinstance(g, dict) and str(g.get('id') or '').strip() == str(group_id).strip())]
        plugin._save_sound_fx_groups(user_hash, groups_after)

        presets = plugin._load_sound_fx_presets(user_hash)
        changed = False
        for p in presets:
            if not isinstance(p, dict):
                continue
            if str(p.get('group_id') or '').strip() == str(group_id).strip():
                p['group_id'] = None
                changed = True
        if changed:
            plugin._save_sound_fx_presets(user_hash, presets)

        return jsonify({'status': 'success'})

    # ------------------------------
    # Sound FX: presets (upload + rename/group + delete)
    # ------------------------------
    @blueprint.route('/sound_fx/presets', methods=['GET', 'POST'])
    def sound_fx_presets():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        presets = plugin._load_sound_fx_presets(user_hash)
        if not isinstance(presets, list):
            presets = []

        if request.method == 'GET':
            cleaned = []
            for p in presets:
                if not isinstance(p, dict):
                    continue
                pid = str(p.get('id') or '').strip()
                name = str(p.get('name') or '').strip()
                ext = str(p.get('ext') or '').strip().lower()
                if not pid or not name or not ext:
                    continue
                cleaned.append({
                    'id': pid,
                    'name': name,
                    'group_id': (str(p.get('group_id') or '').strip() or None),
                    'ext': ext,
                    'mime': str(p.get('mime') or '').strip() or None,
                    'size': int(p.get('size') or 0),
                    'created_at': int(p.get('created_at') or 0),
                    'updated_at': int(p.get('updated_at') or 0),
                    'url': f"/api/plugin/album/sound_fx/file/{pid}",
                })
            return jsonify(cleaned)

        # POST: multipart upload
        if 'file' not in request.files:
            abort(400, 'Missing file field in multipart form.')
        file = request.files['file']
        if not file or not getattr(file, 'filename', None):
            abort(400, 'Empty filename.')

        ext = _ext_from_filename(file.filename)
        if ext not in ('wav', 'mp3', 'ogg'):
            abort(400, 'Unsupported audio type. Please upload .wav, .mp3, or .ogg.')

        raw = file.read()
        if not raw:
            abort(400, 'Empty file.')

        name = str(request.form.get('name') or '').strip()
        if not name:
            # default to filename without extension
            try:
                name = os.path.splitext(os.path.basename(file.filename))[0].strip() or 'Sound'
            except Exception:
                name = 'Sound'

        group_id = str(request.form.get('group_id') or request.form.get('groupId') or '').strip() or None
        if group_id:
            groups = plugin._load_sound_fx_groups(user_hash)
            if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                abort(404, 'Sound FX group not found.')

        mime = str(getattr(file, 'mimetype', '') or '').strip().lower() or None
        preset_id = str(uuid.uuid4())
        now = int(time.time())

        plugin._save_sound_fx_file(user_hash, preset_id, ext, raw)

        preset = {
            'id': preset_id,
            'name': name,
            'group_id': group_id,
            'ext': ext,
            'mime': mime,
            'size': int(len(raw)),
            'created_at': now,
            'updated_at': now,
        }
        presets.append(preset)
        plugin._save_sound_fx_presets(user_hash, presets)
        return jsonify({**preset, 'url': f"/api/plugin/album/sound_fx/file/{preset_id}"}), 201

    @blueprint.route('/sound_fx/presets/<preset_id>', methods=['PUT', 'DELETE'])
    def sound_fx_preset_update_or_delete(preset_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        presets = plugin._load_sound_fx_presets(user_hash)
        if not isinstance(presets, list):
            presets = []

        preset = next((p for p in presets if isinstance(p, dict) and str(p.get('id') or '').strip() == str(preset_id).strip()), None)
        if not preset:
            abort(404, 'Sound FX preset not found.')

        if request.method == 'PUT':
            data = request.json or {}
            if 'name' in data:
                name = str(data.get('name') or '').strip()
                if not name:
                    abort(400, 'name cannot be empty.')
                preset['name'] = name

            if 'group_id' in data or 'groupId' in data:
                group_id = str(data.get('group_id') or data.get('groupId') or '').strip() or None
                if group_id:
                    groups = plugin._load_sound_fx_groups(user_hash)
                    if not any(isinstance(g, dict) and str(g.get('id') or '').strip() == group_id for g in groups):
                        abort(404, 'Sound FX group not found.')
                preset['group_id'] = group_id

            preset['updated_at'] = int(time.time())
            plugin._save_sound_fx_presets(user_hash, presets)
            pid = str(preset.get('id') or '').strip()
            return jsonify({
                'id': pid,
                'name': str(preset.get('name') or '').strip(),
                'group_id': (str(preset.get('group_id') or '').strip() or None),
                'ext': str(preset.get('ext') or '').strip().lower(),
                'mime': str(preset.get('mime') or '').strip() or None,
                'size': int(preset.get('size') or 0),
                'created_at': int(preset.get('created_at') or 0),
                'updated_at': int(preset.get('updated_at') or 0),
                'url': f"/api/plugin/album/sound_fx/file/{pid}",
            })

        # DELETE
        ext = str(preset.get('ext') or '').strip().lower()
        if ext:
            try:
                plugin._delete_sound_fx_file(user_hash, str(preset_id), ext)
            except Exception:
                pass

        presets_after = [p for p in presets if not (isinstance(p, dict) and str(p.get('id') or '').strip() == str(preset_id).strip())]
        plugin._save_sound_fx_presets(user_hash, presets_after)
        return jsonify({'status': 'success'})

    @blueprint.route('/sound_fx/file/<preset_id>', methods=['GET'])
    def sound_fx_get_file(preset_id):
        # NOTE: <audio src> cannot send Authorization headers, so we also accept
        # a token via query string (?token=...) and validate it using CoreAPI.
        try:
            token_override = str(request.args.get('token') or '').strip() or None
        except Exception:
            token_override = None
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash(token_override=token_override)
        except Exception as e:
            abort(401, str(e) or 'Unauthorized')
        presets = plugin._load_sound_fx_presets(user_hash)
        if not isinstance(presets, list):
            presets = []
        preset = next((p for p in presets if isinstance(p, dict) and str(p.get('id') or '').strip() == str(preset_id).strip()), None)
        if not preset:
            abort(404, 'Sound FX preset not found.')

        ext = str(preset.get('ext') or '').strip().lower()
        if ext not in ('wav', 'mp3', 'ogg'):
            abort(404)

        data = plugin._load_sound_fx_file_bytes(user_hash, str(preset_id), ext)
        if not data:
            abort(404)

        mime = str(preset.get('mime') or '').strip().lower()
        if not mime:
            mime = {
                'wav': 'audio/wav',
                'mp3': 'audio/mpeg',
                'ogg': 'audio/ogg',
            }.get(ext, 'application/octet-stream')
        return Response(data, mimetype=mime)

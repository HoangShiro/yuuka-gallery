from flask import jsonify, request, abort, Response, current_app
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


def _normalize_group_id(value) -> str | None:
    try:
        v = str(value or '').strip()
        return v or None
    except Exception:
        return None


def _normalize_group_ids(preset: dict) -> list[str]:
    """Return unique, trimmed group ids for a preset.

    Backwards compatible with legacy `group_id` field.
    """
    ids: list[str] = []
    try:
        raw = preset.get('group_ids') if isinstance(preset, dict) else None
        if isinstance(raw, list):
            for x in raw:
                gid = _normalize_group_id(x)
                if gid:
                    ids.append(gid)
    except Exception:
        pass

    if not ids:
        try:
            legacy = _normalize_group_id((preset or {}).get('group_id'))
            if legacy:
                ids.append(legacy)
        except Exception:
            pass

    # Unique preserving order
    out: list[str] = []
    seen = set()
    for gid in ids:
        if gid in seen:
            continue
        seen.add(gid)
        out.append(gid)
    return out


def _validate_group_ids_exist(plugin, user_hash: str, group_ids: list[str]):
    if not group_ids:
        return
    groups = plugin._load_sound_fx_groups(user_hash)
    if not isinstance(groups, list):
        groups = []
    existing = {str((g or {}).get('id') or '').strip() for g in groups if isinstance(g, dict)}
    existing.discard('')
    for gid in group_ids:
        if gid not in existing:
            abort(404, 'Sound FX group not found.')


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
            gid = str(group_id).strip()
            group_ids = _normalize_group_ids(p)
            if gid in group_ids:
                p['group_ids'] = [x for x in group_ids if x != gid]
                p['group_id'] = (p['group_ids'][0] if p['group_ids'] else None)
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
                group_ids = _normalize_group_ids(p)
                cleaned.append({
                    'id': pid,
                    'name': name,
                    'group_id': (group_ids[0] if group_ids else None),
                    'group_ids': group_ids,
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
        group_ids = [group_id] if group_id else []
        _validate_group_ids_exist(plugin, user_hash, group_ids)

        mime = str(getattr(file, 'mimetype', '') or '').strip().lower() or None
        preset_id = str(uuid.uuid4())
        now = int(time.time())

        plugin._save_sound_fx_file(user_hash, preset_id, ext, raw)

        preset = {
            'id': preset_id,
            'name': name,
            'group_id': (group_ids[0] if group_ids else None),
            'group_ids': group_ids,
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
            # Supports two modes:
            # - JSON body: rename / group assignment
            # - multipart/form-data: overwrite audio file (and optionally name)

            # multipart overwrite
            if 'file' in request.files:
                file = request.files.get('file')
                if not file or not getattr(file, 'filename', None):
                    abort(400, 'Empty filename.')

                ext = _ext_from_filename(file.filename)
                if ext not in ('wav', 'mp3', 'ogg'):
                    abort(400, 'Unsupported audio type. Please upload .wav, .mp3, or .ogg.')

                raw = file.read()
                if not raw:
                    abort(400, 'Empty file.')

                # Optional rename along with overwrite
                try:
                    name_form = str(request.form.get('name') or '').strip()
                except Exception:
                    name_form = ''
                if name_form:
                    preset['name'] = name_form

                # Replace file on disk (best-effort delete old ext)
                old_ext = str(preset.get('ext') or '').strip().lower()
                if old_ext and old_ext != ext:
                    try:
                        plugin._delete_sound_fx_file(user_hash, str(preset_id), old_ext)
                    except Exception:
                        pass
                plugin._save_sound_fx_file(user_hash, str(preset_id), ext, raw)

                preset['ext'] = ext
                preset['mime'] = str(getattr(file, 'mimetype', '') or '').strip().lower() or None
                preset['size'] = int(len(raw))
                preset['updated_at'] = int(time.time())

                plugin._save_sound_fx_presets(user_hash, presets)
                pid = str(preset.get('id') or '').strip()
                group_ids_out = _normalize_group_ids(preset)
                return jsonify({
                    'id': pid,
                    'name': str(preset.get('name') or '').strip(),
                    'group_id': (group_ids_out[0] if group_ids_out else None),
                    'group_ids': group_ids_out,
                    'ext': str(preset.get('ext') or '').strip().lower(),
                    'mime': str(preset.get('mime') or '').strip() or None,
                    'size': int(preset.get('size') or 0),
                    'created_at': int(preset.get('created_at') or 0),
                    'updated_at': int(preset.get('updated_at') or 0),
                    'url': f"/api/plugin/album/sound_fx/file/{pid}",
                })

            data = request.json or {}
            if 'name' in data:
                name = str(data.get('name') or '').strip()
                if not name:
                    abort(400, 'name cannot be empty.')
                preset['name'] = name

            # Multi-group support
            group_ids = _normalize_group_ids(preset)

            # Back-compat replace behavior
            if 'group_id' in data or 'groupId' in data:
                gid = _normalize_group_id(data.get('group_id') or data.get('groupId'))
                if gid:
                    _validate_group_ids_exist(plugin, user_hash, [gid])
                    group_ids = [gid]
                else:
                    group_ids = []

            # Preferred: explicit replace list
            if 'group_ids' in data or 'groupIds' in data:
                raw = data.get('group_ids') if 'group_ids' in data else data.get('groupIds')
                if raw is None:
                    group_ids = []
                elif not isinstance(raw, list):
                    abort(400, 'group_ids must be a list.')
                else:
                    next_ids = []
                    for x in raw:
                        gid = _normalize_group_id(x)
                        if gid:
                            next_ids.append(gid)
                    # unique
                    uniq = []
                    seen = set()
                    for gid in next_ids:
                        if gid in seen:
                            continue
                        seen.add(gid)
                        uniq.append(gid)
                    _validate_group_ids_exist(plugin, user_hash, uniq)
                    group_ids = uniq

            # Preferred: add/remove single group
            add_gid = _normalize_group_id(data.get('add_group_id') or data.get('addGroupId'))
            if add_gid:
                _validate_group_ids_exist(plugin, user_hash, [add_gid])
                if add_gid not in group_ids:
                    group_ids.append(add_gid)

            rem_gid = _normalize_group_id(data.get('remove_group_id') or data.get('removeGroupId'))
            if rem_gid:
                group_ids = [x for x in group_ids if x != rem_gid]

            preset['group_ids'] = group_ids
            preset['group_id'] = (group_ids[0] if group_ids else None)

            preset['updated_at'] = int(time.time())
            plugin._save_sound_fx_presets(user_hash, presets)
            pid = str(preset.get('id') or '').strip()
            group_ids_out = _normalize_group_ids(preset)
            return jsonify({
                'id': pid,
                'name': str(preset.get('name') or '').strip(),
                'group_id': (group_ids_out[0] if group_ids_out else None),
                'group_ids': group_ids_out,
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
            try:
                current_app.logger.warning('SoundFX file 404: preset not found (user=%s preset_id=%s)', user_hash, str(preset_id))
            except Exception:
                pass
            abort(404, 'Sound FX preset not found.')

        ext = str(preset.get('ext') or '').strip().lower()
        if ext not in ('wav', 'mp3', 'ogg'):
            try:
                current_app.logger.warning('SoundFX file 404: invalid ext (user=%s preset_id=%s ext=%s)', user_hash, str(preset_id), ext)
            except Exception:
                pass
            abort(404, 'Sound FX preset has unsupported ext.')

        data = plugin._load_sound_fx_file_bytes(user_hash, str(preset_id), ext)
        if not data:
            # Back-compat: older builds may store short ids in presets while the on-disk file
            # name uses a longer uuid. If the file is missing, try prefix match inside the
            # user's sfx directory (only when safe and unambiguous).
            try:
                pid = str(preset_id).strip()
            except Exception:
                pid = ''

            try_prefix_fallback = bool(pid) and len(pid) <= 16 and ('/' not in pid) and ('\\' not in pid)
            if try_prefix_fallback:
                try:
                    rel_dir = plugin._sound_fx_dir_rel(user_hash)
                    abs_dir = plugin.core_api.data_manager.get_path(rel_dir)
                    matches: list[str] = []
                    if os.path.isdir(abs_dir):
                        suffix = f'.{ext}'
                        for fn in os.listdir(abs_dir):
                            if not isinstance(fn, str):
                                continue
                            if fn.startswith(pid) and fn.lower().endswith(suffix):
                                matches.append(fn)
                    if len(matches) == 1:
                        rel_path = os.path.join(rel_dir, matches[0])
                        obf = plugin.core_api.data_manager.read_binary(rel_path)
                        if obf:
                            data = plugin.core_api.data_manager.deobfuscate_binary(obf)
                            try:
                                current_app.logger.info('SoundFX file served via prefix fallback (user=%s preset_id=%s matched=%s)', user_hash, pid, matches[0])
                            except Exception:
                                pass
                except Exception:
                    pass

        if not data:
            try:
                rel_dir = plugin._sound_fx_dir_rel(user_hash)
                rel_path = os.path.join(rel_dir, f"{str(preset_id).strip()}.{ext}")
                current_app.logger.warning('SoundFX file 404: bytes missing (user=%s preset_id=%s ext=%s rel=%s)', user_hash, str(preset_id), ext, rel_path)
            except Exception:
                pass
            abort(404, 'Sound FX file not found on disk.')

        mime = str(preset.get('mime') or '').strip().lower()
        if not mime:
            mime = {
                'wav': 'audio/wav',
                'mp3': 'audio/mpeg',
                'ogg': 'audio/ogg',
            }.get(ext, 'application/octet-stream')

        # Support HTTP Range requests so <audio> can seek reliably.
        # Without this, many browsers will refuse to play from a non-zero offset.
        total = len(data)
        range_header = str(request.headers.get('Range') or '').strip()
        if range_header.lower().startswith('bytes=') and total > 0:
            try:
                spec = range_header.split('=', 1)[1].strip()
                # Only support a single range: "start-end"
                if ',' in spec:
                    spec = spec.split(',', 1)[0].strip()
                start_s, end_s = (spec.split('-', 1) + [''])[:2]
                start = int(start_s) if start_s.strip() != '' else None
                end = int(end_s) if end_s.strip() != '' else None

                # bytes=-N (suffix)
                if start is None and end is not None:
                    n = max(0, int(end))
                    start = max(0, total - n)
                    end = total - 1

                if start is None:
                    start = 0
                if end is None or end >= total:
                    end = total - 1

                if start < 0:
                    start = 0
                if end < start:
                    end = start

                if start >= total:
                    resp = Response(status=416)
                    resp.headers['Content-Range'] = f'bytes */{total}'
                    resp.headers['Accept-Ranges'] = 'bytes'
                    return resp

                chunk = data[start:end + 1]
                resp = Response(chunk, status=206, mimetype=mime)
                resp.headers['Content-Range'] = f'bytes {start}-{end}/{total}'
                resp.headers['Accept-Ranges'] = 'bytes'
                resp.headers['Content-Length'] = str(len(chunk))
                return resp
            except Exception:
                # Fall back to full content
                pass

        resp = Response(data, mimetype=mime)
        resp.headers['Accept-Ranges'] = 'bytes'
        resp.headers['Content-Length'] = str(total)
        return resp

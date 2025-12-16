from flask import jsonify, request, abort

def register_routes(blueprint, plugin):
    # ------------------------------
    # Character view: Visual Novel mode global backgrounds (per-user)
    # ------------------------------
    @blueprint.route('/character/vn/backgrounds/<path:group_id>', methods=['DELETE'])
    def character_vn_backgrounds_delete(group_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        gid = str(group_id or '').strip()
        if not gid:
            abort(400, 'Missing field: group_id')

        store = plugin._load_char_vn_backgrounds(user_hash)
        if not isinstance(store, dict):
            store = {}
        existed = gid in store
        store.pop(gid, None)
        plugin._save_char_vn_backgrounds(user_hash, store)
        return jsonify({'status': 'success', 'group_id': gid, 'deleted': bool(existed)})

    @blueprint.route('/character/vn/backgrounds', methods=['GET', 'POST', 'DELETE'])
    def character_vn_backgrounds():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()

        if request.method == 'GET':
            store = plugin._load_char_vn_backgrounds(user_hash)
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
            store = plugin._load_char_vn_backgrounds(user_hash)
            if not isinstance(store, dict):
                store = {}
            existed = group_id in store
            store.pop(group_id, None)
            plugin._save_char_vn_backgrounds(user_hash, store)
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

        store = plugin._load_char_vn_backgrounds(user_hash)
        if not isinstance(store, dict):
            store = {}
        store[group_id] = {
            'url': url,
            'pv_url': pv_url,
            'album_hash': album_hash,
            'image_id': image_id,
            'createdAt': created_at,
        }
        plugin._save_char_vn_backgrounds(user_hash, store)
        return jsonify({'status': 'success', 'group_id': group_id, 'url': url})

    @blueprint.route('/character/vn/background_album', methods=['GET'])
    def character_vn_background_album():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        bg_hash = plugin._ensure_vn_background_album(user_hash)
        return jsonify({'hash': bg_hash, 'name': 'Background'})

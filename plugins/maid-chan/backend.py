# --- NEW FILE: plugins/maid-chan/backend.py ---
import os
import io
import math
from flask import Blueprint, request, jsonify, abort, Response
from werkzeug.exceptions import HTTPException
from PIL import Image, ImageSequence

from integrations import gemini_api
from integrations import openai as openai_integration

class MaidChanPlugin:
    """Backend for Maid-chan plugin (avatar upload + serving)."""
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('maid_chan', __name__)

        def _require_user():
            try:
                return self.core_api.verify_token_and_get_user_hash()
            except Exception as exc:
                # Raise to be handled by errorhandler below
                raise PermissionError(str(exc))

        @self.blueprint.errorhandler(PermissionError)
        def _handle_perm_error(err):
            return jsonify({"error": str(err)}), 401

        # Ensure all HTTP errors (e.g., abort(400, ...)) return JSON instead of HTML
        @self.blueprint.errorhandler(HTTPException)
        def _handle_http_errors(err: HTTPException):
            code = getattr(err, 'code', 500) or 500
            description = getattr(err, 'description', str(err))
            return jsonify({"error": description}), code

        # GET: serve maid avatar at root path (no plugin prefix)
        @self.blueprint.get('/user_image/maid_avatar/<filename>')
        def get_maid_avatar_image(filename):
            image_data, mimetype = self.core_api.get_user_image_data('maid_avatar', filename)
            if image_data:
                return Response(image_data, mimetype=mimetype)
            abort(404)

        # POST: upload maid avatar (multipart)
        # POST: upload maid avatar (kept at core-level API path)
        @self.blueprint.post('/api/maid/avatar')
        def upload_maid_avatar():
            user_hash = _require_user()

            if 'file' not in request.files:
                abort(400, "Missing file field in multipart form.")
            file = request.files['file']
            if not file.filename:
                abort(400, "Empty filename.")

            ctype = (file.mimetype or '').lower()
            # Accept PNG/JPEG/WebP/GIF (GIF will be processed as a static image using first frame)
            if not any(t in ctype for t in ['png', 'jpeg', 'jpg', 'webp', 'gif']):
                abort(400, "Unsupported image type. Please upload PNG/JPEG/WebP/GIF.")

            raw = file.read()
            try:
                src_img = Image.open(io.BytesIO(raw))
                target = 256

                def resize_center_crop(im: Image.Image, size=256) -> Image.Image:
                    # keep aspect, fill then center-crop
                    scale = max(size / im.width, size / im.height)
                    new_w, new_h = int(im.width * scale), int(im.height * scale)
                    im_resized = im.resize((new_w, new_h), Image.LANCZOS)
                    left = (new_w - size) // 2
                    top = (new_h - size) // 2
                    return im_resized.crop((left, top, left + size, top + size))

                is_gif = (src_img.format or '').upper() == 'GIF' or 'gif' in ctype
                if is_gif and getattr(src_img, 'is_animated', False):
                    # Preserve animation with improved color quality (global palette + dithering)
                    rgba_frames = []
                    durations = []
                    loop = src_img.info.get('loop', 0)
                    max_frames = 200  # safety cap
                    base = Image.new('RGBA', src_img.size)
                    count = 0
                    for frame in ImageSequence.Iterator(src_img):
                        if count >= max_frames:
                            break
                        frame_rgba = frame.convert('RGBA')
                        base = Image.alpha_composite(base, frame_rgba)
                        out = resize_center_crop(base, target)
                        rgba_frames.append(out)
                        durations.append(frame.info.get('duration', src_img.info.get('duration', 100)))
                        count += 1

                    if not rgba_frames:
                        # fallback to first frame static
                        img = resize_center_crop(src_img.convert('RGBA'), target)
                        buf = io.BytesIO()
                        img.save(buf, format='PNG')
                        processed_bytes = buf.getvalue()
                        out_ext = 'png'
                    else:
                        # Build a global palette from downscaled mosaic of frames
                        sample_frames = rgba_frames[:min(len(rgba_frames), 50)]
                        tile = 64
                        cols = min(10, len(sample_frames))
                        rows = int(math.ceil(len(sample_frames) / cols))
                        mosaic = Image.new('RGB', (cols * tile, rows * tile))
                        for i, fr in enumerate(sample_frames):
                            r = i // cols
                            c = i % cols
                            thumb = fr.resize((tile, tile), Image.LANCZOS).convert('RGB')
                            mosaic.paste(thumb, (c * tile, r * tile))

                        palette_img = mosaic.quantize(colors=256, method=Image.MEDIANCUT)
                        palette_list = palette_img.getpalette() or []
                        if len(palette_list) < 768:
                            palette_list = palette_list + [0] * (768 - len(palette_list))

                        # Reserve a transparent index (use 255)
                        trans_index = 255
                        palette_list[trans_index*3:trans_index*3+3] = [255, 0, 255]

                        pal_frames = []
                        for fr in rgba_frames:
                            alpha = fr.split()[-1]
                            rgb = fr.convert('RGB')
                            # Quantize using the global palette with dithering
                            p = rgb.quantize(palette=palette_img, dither=Image.FLOYDSTEINBERG)
                            p.putpalette(palette_list)
                            # Apply transparency mask -> set transparent pixels to trans_index
                            mask = alpha.point(lambda a: 255 if a < 128 else 0, mode='L')
                            if mask.getbbox():
                                p.paste(trans_index, mask)
                            p.info['transparency'] = trans_index
                            pal_frames.append(p)

                        buf = io.BytesIO()
                        pal_frames[0].save(
                            buf,
                            format='GIF',
                            save_all=True,
                            append_images=pal_frames[1:],
                            duration=durations,
                            loop=loop,
                            disposal=2,
                            optimize=False,
                            transparency=trans_index,
                        )
                        processed_bytes = buf.getvalue()
                        out_ext = 'gif'
                else:
                    # Static image path (or non-animated GIF): output PNG
                    img = resize_center_crop(src_img.convert('RGBA'), target)
                    buf = io.BytesIO()
                    img.save(buf, format='PNG')
                    processed_bytes = buf.getvalue()
                    out_ext = 'png'
            except Exception as e:
                abort(400, f"Failed to process image: {e}")

            maid_dir_rel = os.path.join('user_images', 'maid_avatar')
            abs_dir = self.core_api.data_manager.get_path(maid_dir_rel)
            os.makedirs(abs_dir, exist_ok=True)
            filename = f"{user_hash}.{out_ext}"
            rel_path = os.path.join(maid_dir_rel, filename)
            obf = self.core_api.data_manager.obfuscate_binary(processed_bytes)
            self.core_api.data_manager.save_binary(obf, rel_path)

            # Persist per-user setting
            settings_file = 'maid_settings.json'
            settings = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_settings = settings.setdefault(user_hash, {})
            user_settings['avatar_filename'] = filename
            self.core_api.data_manager.save_json(settings, settings_file, obfuscated=True)

            avatar_url = f"/user_image/maid_avatar/{filename}"
            return jsonify({"status": "success", "avatar_url": avatar_url})

        # --- Chat history endpoints for Maid-chan ---

        # Preferred route for plugins: /api/plugin/maid/chat/history
        @self.blueprint.get('/api/plugin/maid/chat/history')
        def maid_chat_history():
            """Return stored Maid-chan chat/event history for current user.

            Stored in obfuscated JSON under data_cache/maid_chat_history.json
            keyed by user_hash.
            """
            user_hash = _require_user()

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_items = data.get(user_hash) or []
            # Ensure list of dicts
            if not isinstance(user_items, list):
                user_items = []
            return jsonify({'items': user_items})

        # Preferred route for plugins: /api/plugin/maid/chat/append
        @self.blueprint.post('/api/plugin/maid/chat/append')
        def maid_chat_append():
            """Append a single chat/event item to user's Maid-chan history."""
            user_hash = _require_user()

            try:
                payload = request.get_json(silent=True) or {}
            except Exception:
                payload = {}

            message = payload.get('message') or {}
            if not isinstance(message, dict):
                abort(400, 'Invalid message payload.')

            # Normalise fields
            item = {
                'id': message.get('id'),
                'role': message.get('role') or 'user',
                'text': message.get('text') or '',
                'kind': message.get('kind') or 'chat',
                'timestamp': message.get('timestamp') or int(self.core_api.get_timestamp_ms()),
            }
            # Optional metadata (e.g., used_tools, selected_snapshot_index, etc.)
            meta = message.get('metadata')
            if isinstance(meta, dict):
                item['metadata'] = meta

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []
            user_items.append(item)
            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=True)

            return jsonify({'status': 'ok', 'item': item})

        @self.blueprint.post('/api/plugin/maid/chat/update')
        def maid_chat_update():
            """Update text for a single chat/event item in user's Maid-chan history.

            Body JSON:
            {
              "id": "message-id",
              "text": "new text"
            }
            """
            user_hash = _require_user()

            try:
                payload = request.get_json(force=True, silent=False) or {}
            except Exception:
                abort(400, description='Invalid JSON payload')

            msg_id = payload.get('id')
            if not msg_id:
                abort(400, description='Missing message id')

            new_text = payload.get('text')
            if new_text is None:
                abort(400, description='Missing text')

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []

            updated = None
            for it in user_items:
                if str(it.get('id')) == str(msg_id):
                    it['text'] = str(new_text)
                    updated = it
                    break

            if updated is None:
                abort(404, description='Message not found')

            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=True)

            return jsonify({'status': 'ok', 'item': updated})

        @self.blueprint.post('/api/plugin/maid/chat/snapshot')
        def maid_chat_snapshot():
            """Update snapshots for a specific assistant message.

            Body JSON:
            {
              "id": "message-id",
              "snapshots": ["text1", "text2", ...],
                            "active_index": 0,
                            "text": "optional-edited-text"
            }
            """
            user_hash = _require_user()

            try:
                payload = request.get_json(force=True, silent=False) or {}
            except Exception:
                abort(400, description='Invalid JSON payload')

            msg_id = payload.get('id')
            if not msg_id:
                abort(400, description='Missing message id')

            snapshots = payload.get('snapshots')
            if snapshots is not None and not isinstance(snapshots, list):
                abort(400, description='Invalid snapshots payload')

            active_index = payload.get('active_index')
            if active_index is not None:
                try:
                    active_index = int(active_index)
                except Exception:
                    abort(400, description='active_index must be an integer')
                if active_index < 0:
                    abort(400, description='active_index must be >= 0')

            # Optional direct text update for the currently active snapshot.
            # Frontend edit logic may send only `text` together with current
            # `active_index` instead of the full snapshots array.
            new_text = payload.get('text')
            used_tools = payload.get('used_tools')

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []

            updated = None
            for it in user_items:
                if str(it.get('id')) == str(msg_id):
                    # Ensure snapshots list exists if we are going to update text
                    snap_list = it.get('snapshots')
                    if snapshots is not None:
                        snap_list = list(snapshots)

                    # If a direct text update is requested for current snapshot,
                    # make sure the list and index are valid first.
                    if new_text is not None:
                        if snap_list is None:
                            # Initialise snapshots from existing text when absent
                            base_text = it.get('text') or ''
                            snap_list = [base_text]

                        idx = active_index if active_index is not None else None
                        # If active_index is not provided, prefer metadata value
                        if idx is None:
                            meta_existing = it.get('metadata') or {}
                            if 'selected_snapshot_index' in meta_existing:
                                try:
                                    idx = int(meta_existing['selected_snapshot_index'])
                                except Exception:
                                    idx = None
                        # Fallback to last index
                        if idx is None:
                            idx = len(snap_list) - 1 if snap_list else 0
                        if idx < 0:
                            idx = 0
                        if idx >= len(snap_list):
                            # Extend list with empty strings up to idx
                            snap_list.extend([''] * (idx + 1 - len(snap_list)))

                        snap_list[idx] = str(new_text)
                        snapshots = snap_list
                        # Keep selected index in sync with the edited snapshot
                        active_index = idx

                    if snap_list is not None:
                        it['snapshots'] = snap_list

                    if active_index is not None:
                        meta = it.get('metadata') or {}
                        meta['selected_snapshot_index'] = active_index
                        it['metadata'] = meta

                    # Optionally store used_tools reported by frontend regen
                    if isinstance(used_tools, list):
                        meta2 = it.get('metadata') or {}
                        meta2['used_tools'] = used_tools
                        it['metadata'] = meta2

                    # Always keep top-level text in sync with current active snapshot
                    if it.get('snapshots') and isinstance(it['snapshots'], list):
                        idx_for_text = active_index if active_index is not None else 0
                        if 0 <= idx_for_text < len(it['snapshots']):
                            it['text'] = it['snapshots'][idx_for_text]

                    updated = it
                    break

            if updated is None:
                abort(404, description='Message not found')

            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=True)

            return jsonify({'status': 'ok', 'item': updated})

        @self.blueprint.post('/api/plugin/maid/chat/delete')
        def maid_chat_delete():
            """Delete a chat item and all newer items from user's history.

            Body JSON:
            { "id": "..." }
            """
            user_hash = _require_user()

            try:
                payload = request.get_json(force=True, silent=False) or {}
            except Exception:
                abort(400, description='Invalid JSON payload')

            msg_id = payload.get('id')
            if not msg_id:
                abort(400, description='Missing message id')

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=True)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []

            # Remove the message and all messages after it (history is oldest -> newest)
            cut_index = None
            for i, it in enumerate(user_items):
                if str(it.get('id')) == str(msg_id):
                    cut_index = i
                    break

            if cut_index is None:
                # Nothing removed but keep data consistent
                new_items = user_items
            else:
                new_items = user_items[:cut_index]
            data[user_hash] = new_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=True)

            return jsonify({'status': 'ok', 'removed_id': msg_id, 'remaining': len(new_items)})

        # Backward compatible aliases (in case any existing JS calls old paths)
        @self.blueprint.get('/api/maid-chan/chat/history')
        def maid_chat_history_legacy():
            return maid_chat_history()

        @self.blueprint.post('/api/maid-chan/chat/append')
        def maid_chat_append_legacy():
            return maid_chat_append()

        @self.blueprint.route('/api/plugin/maid/models', methods=['GET', 'POST'])
        def list_models():
            """Return available LLM model ids for Maid-chan.

            Implementation mirrors chat plugin's /models endpoint so both
            providers behave identically.
            """
            user_hash = _require_user()

            # Reuse chat orchestrator settings when available, to keep a
            # single source of truth for provider/api_key overrides.
            base_settings: dict = {}
            try:
                orchestrator = getattr(self.core_api, 'chat_orchestrator', None)
                if orchestrator and hasattr(orchestrator, 'get_generation_settings'):
                    base_settings = orchestrator.get_generation_settings(user_hash) or {}
            except Exception:  # noqa: BLE001
                base_settings = {}

            payload = request.json or {} if request.method == 'POST' else {}

            provider = (payload.get('provider') or base_settings.get('provider') or 'openai').strip().lower()
            user_api_key = payload.get('api_key') or base_settings.get('api_key')
            overrides = payload.get('overrides') or base_settings.get('overrides') or {}

            try:
                if provider == 'gemini':
                    models = gemini_api.list_models(user_api_key=user_api_key)

                    def _is_text_capable(m: dict) -> bool:
                        methods = m.get('supported_generation_methods') or []
                        return any(method in methods for method in ('generateContent', 'create', 'text')) or not methods

                    models = [m for m in models if _is_text_capable(m)]
                    return jsonify({'models': models})

                # Default: OpenAI-compatible (same integration as chat plugin)
                models = openai_integration.list_models(
                    provider=provider,
                    user_api_key=user_api_key,
                    overrides=overrides,
                )
                return jsonify({'models': models})
            except Exception as exc:  # noqa: BLE001
                return jsonify({'error': str(exc)}), 400

        @self.blueprint.post('/api/plugin/maid/chat')
        def maid_chat():
            """Chat endpoint cho Maid-chan, đi qua AIService queue.

            Body JSON:
            {
              "provider": "openai" | "gemini" | ...,
              "model": "...",
              "api_key": "..." (optional),
              "messages": [{"role": "user"|"assistant"|"system", "content": "..."}, ...],
              "temperature": 0.7,
              "top_p": 1,
              "max_tokens": 512,
              "timeout": 60
            }
            """
            user_hash = _require_user()

            try:
                payload = request.get_json(silent=True) or {}
            except Exception:
                payload = {}

            provider = (payload.get('provider') or 'openai').strip().lower()
            model = payload.get('model') or None
            api_key = payload.get('api_key') or None
            messages = payload.get('messages') or []
            temperature = payload.get('temperature', 0.7)
            top_p = payload.get('top_p', 1)
            max_tokens = payload.get('max_tokens', 512)
            timeout = payload.get('timeout', 60)
            # Optional function-calling fields (primarily for Gemini):
            # tools: list of { name, description, parameters }
            # tool_mode: 'auto' | 'none' | 'any' (provider-specific)
            tools = payload.get('tools') or []
            tool_mode = payload.get('tool_mode') or None

            # Lấy orchestrator settings (nếu có) để reuse cấu hình chung
            provider_overrides = {}
            orchestrator = getattr(self.core_api, 'chat_orchestrator', None)
            if orchestrator and hasattr(orchestrator, 'get_generation_settings'):
                base = orchestrator.get_generation_settings(user_hash) or {}
                provider = (provider or base.get('provider') or 'openai').strip().lower()
                api_key = api_key or base.get('api_key')
                provider_overrides = base.get('overrides') or {}

            # Chuẩn bị payload cho AIService
            ai_payload = {
                'provider': provider,
                'operation': 'chat',
                'payload': {
                    'provider': provider,
                    'model': model,
                    'messages': messages,
                    'timeout': timeout,
                    'overrides': {
                        'temperature': temperature,
                        'top_p': top_p,
                        'max_tokens': max_tokens,
                    },
                    # Forward function-calling hints directly to AIService.
                    # Non-Gemini providers can safely ignore these fields.
                    'tools': tools,
                    'tool_mode': tool_mode,
                },
            }

            ai_service = getattr(self.core_api, 'ai_service', None)
            if ai_service is None:
                return jsonify({'error': 'AI service is not available.'}), 503

            try:
                result = ai_service.request(
                    provider=provider,
                    operation='chat',
                    payload=ai_payload['payload'],
                    user_hash=user_hash,
                    user_api_key=api_key,
                    provider_overrides=provider_overrides,
                    timeout=timeout,
                )
                # Minimal logging format requested: user last request, function_call (if any), model reply
                try:
                    last_user = None
                    for m in reversed(messages):
                        if isinstance(m, dict) and m.get('role') == 'user':
                            last_user = (m.get('content') or m.get('text'))
                            break
                    # Prepare fields
                    if isinstance(result, dict):
                        r_type = result.get('type')
                        fn_name = result.get('name') if r_type == 'tool_call' else None
                        fn_args = result.get('arguments') if r_type == 'tool_call' else None
                        reply_text = result.get('text') or result.get('message') or ''
                        # Serialize full response
                        try:
                            import json
                            full_dump = json.dumps(result, ensure_ascii=False, indent=2, default=str)
                        except Exception:
                            full_dump = str(result)
                        print('[MaidChat] user_last_request:', repr(last_user))
                        if fn_name:
                            print('[MaidChat] function_call:', fn_name, fn_args)
                        # model_reply line then two blank lines then full response dump
                        print('[MaidChat] model_reply:', repr(reply_text))
                        print()  # first blank line
                        print(full_dump)
                        print()  # second blank line
                    else:
                        print('[MaidChat] user_last_request:', repr(last_user))
                        print('[MaidChat] model_reply:', repr(result))
                        print()  # spacing
                        print(str(result))
                        print()
                except Exception:
                    pass
                return jsonify(result)
            except Exception as exc:  # noqa: BLE001
                import traceback, time
                trace = traceback.format_exc()
                ts = time.strftime('%Y-%m-%d %H:%M:%S')
                # Maintain concise error logging
                print(f"[MaidChat] error {ts} {exc.__class__.__name__}: {exc}")
                return jsonify({
                    'error': str(exc),
                    'error_type': exc.__class__.__name__,
                    'provider': provider,
                    'model': model,
                    'tool_names': [t.get('name') for t in tools if isinstance(t, dict)],
                    'trace': trace[-1000:],  # shorter trace
                }), 400

    def get_blueprint(self):
        # Mount at root so avatar URLs /user_image/maid_avatar/... remain stable
        # and models endpoint stays at /api/plugin/maid/models via absolute route.
        return self.blueprint, '/'

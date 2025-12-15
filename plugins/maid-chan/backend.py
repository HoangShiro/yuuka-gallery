# --- NEW FILE: plugins/maid-chan/backend.py ---
import os
import io
import math
import time
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

        # Local helper for current timestamp in milliseconds (CoreAPI has no get_timestamp_ms)
        def _ts_ms() -> int:
            try:
                # Prefer CoreAPI method if ever added
                if hasattr(self.core_api, 'get_timestamp_ms') and callable(getattr(self.core_api, 'get_timestamp_ms')):
                    return int(self.core_api.get_timestamp_ms())
            except Exception:
                pass
            return int(time.time() * 1000)

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
            # Debug mode: store plain JSON (no obfuscation) for maid chat history
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=False)
            user_items = data.get(user_hash) or []
            # Ensure list of dicts
            if not isinstance(user_items, list):
                user_items = []

            # Strip legacy top-level fields from assistant items (no conversion)
            cleaned = []
            for it in user_items:
                if isinstance(it, dict) and it.get('role') == 'assistant':
                    it = dict(it)
                    it.pop('text', None)
                    it.pop('timestamp', None)
                    it.pop('metadata', None)
                cleaned.append(it)

            return jsonify({'items': cleaned})

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

            # Build item according to role
            role = (message.get('role') or 'user').strip().lower()
            if role == 'assistant':
                snapshots = message.get('snapshots')
                if not (isinstance(snapshots, dict) and isinstance(snapshots.get('parts'), list)):
                    abort(400, description='Assistant message must include snapshots.parts and current_index')
                parts = []
                for p in snapshots.get('parts'):
                    if not isinstance(p, dict):
                        abort(400, description='Each snapshot part must be an object with text/timestamp')
                    part_entry = {
                        'text': str(p.get('text') or ''),
                        'tool_results_text': p.get('tool_results_text') if isinstance(p.get('tool_results_text'), str) else None,
                        'timestamp': int(p.get('timestamp') or _ts_ms()),
                        'imgs': p.get('imgs') if isinstance(p.get('imgs'), list) else []
                    }
                    # Optional per-part tool info array
                    if isinstance(p.get('tool_info'), list):
                        # Convert arguments/result to arrays (arguments_list/result_list) preserving existing list fields.
                        sanitized = []
                        for ti in p.get('tool_info'):
                            if not isinstance(ti, dict):
                                continue
                            entry = {
                                'name': ti.get('name'),
                                'type': ti.get('type'),
                                'pluginId': ti.get('pluginId'),
                                'stage': ti.get('stage')
                            }
                            # Prefer already-normalized arrays if provided; fall back to singular fields.
                            if 'arguments_list' in ti and isinstance(ti.get('arguments_list'), list):
                                args_val = ti.get('arguments_list')
                            else:
                                args_val = ti.get('arguments') if 'arguments' in ti else ti.get('args')
                            if 'result_list' in ti and isinstance(ti.get('result_list'), list):
                                res_val = ti.get('result_list')
                            else:
                                res_val = ti.get('result')
                            def _normalize_to_list(v):
                                if v is None:
                                    return []
                                if isinstance(v, list):
                                    return v
                                if isinstance(v, dict):
                                    return list(v.values())
                                return [v]
                            entry['arguments_list'] = _normalize_to_list(args_val)
                            entry['result_list'] = _normalize_to_list(res_val)
                            sanitized.append(entry)
                        if sanitized:
                            part_entry['tool_info'] = sanitized
                    parts.append(part_entry)
                try:
                    idx = int(snapshots.get('current_index') or 0)
                except Exception:
                    idx = 0
                idx = max(0, min(idx, max(0, len(parts)-1)))
                item = {
                    'id': message.get('id'),
                    'role': 'assistant',
                    'kind': message.get('kind') or 'chat',
                    'snapshots': { 'parts': parts, 'current_index': idx }
                }
                tc = message.get('tool_contents')
                if isinstance(tc, list):
                    item['tool_contents'] = tc
            else:
                item = {
                    'id': message.get('id'),
                    'role': role,
                    'text': message.get('text') or '',
                    'kind': message.get('kind') or 'chat',
                    'timestamp': message.get('timestamp') or int(_ts_ms()),
                }

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=False)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []
            user_items.append(item)
            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=False)

            return jsonify({'status': 'ok', 'item': item})

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
            if not (isinstance(snapshots, dict) and isinstance(snapshots.get('parts'), list)):
                abort(400, description='Invalid snapshots payload; expecting object with parts and current_index')

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
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=False)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []

            def _normalize_snapshot_entries(seq):
                norm = []
                for x in seq or []:
                    if isinstance(x, dict):
                        txt = str(x.get('text') or '')
                        entry = {
                            'text': txt,
                            'tool_results_text': x.get('tool_results_text') if isinstance(x.get('tool_results_text'), str) else None,
                            'timestamp': int(x.get('timestamp') or _ts_ms()),
                            'imgs': x.get('imgs') if isinstance(x.get('imgs'), list) else []
                        }
                        if isinstance(x.get('tool_info'), list):
                            sanitized = []
                            for ti in x.get('tool_info'):
                                if not isinstance(ti, dict):
                                    continue
                                entry2 = {
                                    'name': ti.get('name'),
                                    'type': ti.get('type'),
                                    'pluginId': ti.get('pluginId'),
                                    'stage': ti.get('stage')
                                }
                                # Support existing normalized arrays.
                                if 'arguments_list' in ti and isinstance(ti.get('arguments_list'), list):
                                    args_val = ti.get('arguments_list')
                                else:
                                    args_val = ti.get('arguments') if 'arguments' in ti else ti.get('args')
                                if 'result_list' in ti and isinstance(ti.get('result_list'), list):
                                    res_val = ti.get('result_list')
                                else:
                                    res_val = ti.get('result')
                                def _normalize_to_list(v):
                                    if v is None:
                                        return []
                                    if isinstance(v, list):
                                        return v
                                    if isinstance(v, dict):
                                        return list(v.values())
                                    return [v]
                                entry2['arguments_list'] = _normalize_to_list(args_val)
                                entry2['result_list'] = _normalize_to_list(res_val)
                                sanitized.append(entry2)
                            if sanitized:
                                entry['tool_info'] = sanitized
                        norm.append(entry)
                    else:
                        norm.append({'text': str(x), 'timestamp': int(_ts_ms())})
                return norm

            updated = None
            for it in user_items:
                if str(it.get('id')) == str(msg_id):
                    existing = it.get('snapshots')
                    # Normalize incoming snapshots parts
                    new_parts = _normalize_snapshot_entries(snapshots.get('parts') or [])
                    try:
                        idx = int(snapshots.get('current_index') or 0)
                    except Exception:
                        idx = 0
                    idx = max(0, min(idx, max(0, len(new_parts)-1)))
                    it['snapshots'] = { 'parts': new_parts, 'current_index': idx }
                    # Remove legacy top-level fields from assistant
                    if it.get('role') == 'assistant':
                        it.pop('text', None)
                        it.pop('timestamp', None)
                        it.pop('metadata', None)

                    updated = it
                    break

            if updated is None:
                abort(404, description='Message not found')

            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=False)

            return jsonify({'status': 'ok', 'item': updated})

        @self.blueprint.post('/api/plugin/maid/chat/update')
        def maid_chat_update():
            """Update a single chat item text.

            Used by the chat panel's inline edit on blur.
            - For `user` messages: updates top-level `text` and `timestamp`.
            - For `assistant` messages:
                * If snapshots exist, updates the active snapshot part's `text`
                  (or the part at `active_index` if provided).
                * If no snapshots exist (legacy), updates top-level `text`.

            Body JSON:
            { "id": "...", "text": "...", "active_index"?: int, "timestamp"?: int }
            """
            user_hash = _require_user()

            try:
                payload = request.get_json(force=True, silent=False) or {}
            except Exception:
                abort(400, description='Invalid JSON payload')

            msg_id = payload.get('id')
            if not msg_id:
                abort(400, description='Missing message id')

            new_text = str(payload.get('text') or '')
            try:
                active_index = int(payload.get('active_index')) if payload.get('active_index') is not None else None
            except Exception:
                abort(400, description='active_index must be an integer if provided')
            try:
                new_ts = int(payload.get('timestamp')) if payload.get('timestamp') is not None else int(_ts_ms())
            except Exception:
                new_ts = int(_ts_ms())

            settings_file = 'maid_chat_history.json'
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=False)
            user_items = data.get(user_hash)
            if not isinstance(user_items, list):
                user_items = []

            updated = None
            for it in user_items:
                if str(it.get('id')) != str(msg_id):
                    continue

                role = (it.get('role') or 'user').lower()
                if role == 'assistant':
                    snaps = it.get('snapshots') or {}
                    parts = snaps.get('parts') if isinstance(snaps, dict) else None
                    if isinstance(parts, list) and parts:
                        # Determine target index
                        idx = snaps.get('current_index') if active_index is None else active_index
                        try:
                            idx = int(idx or 0)
                        except Exception:
                            idx = 0
                        idx = max(0, min(idx, len(parts) - 1))
                        part = parts[idx] if isinstance(parts[idx], dict) else None
                        if part is None:
                            part = {'text': ''}
                            parts[idx] = part
                        part['text'] = new_text
                        # Only bump timestamp for the edited part
                        part['timestamp'] = new_ts
                        # Persist back
                        it['snapshots'] = {'parts': parts, 'current_index': idx}
                        # Ensure legacy assistant top-level fields are removed
                        it.pop('text', None)
                        it.pop('timestamp', None)
                        it.pop('metadata', None)
                    else:
                        # Legacy assistant without snapshots: update top-level
                        it['text'] = new_text
                        it['timestamp'] = new_ts
                else:
                    # user or other roles: plain text update
                    it['text'] = new_text
                    it['timestamp'] = new_ts

                updated = it
                break

            if updated is None:
                abort(404, description='Message not found')

            data[user_hash] = user_items
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=False)

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
            data = self.core_api.data_manager.read_json(settings_file, default_value={}, obfuscated=False)
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
            self.core_api.data_manager.save_json(data, settings_file, obfuscated=False)

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
            def _normalize_lm_base(url: str):
                if not url:
                    return url
                u = str(url).strip()
                if not u:
                    return u
                while u.endswith('/'):
                    u = u[:-1]
                if u.lower().endswith('/v1'):
                    u = u[:-3]
                if u.lower().endswith('/models'):
                    u = u[:-7]
                if u.lower().endswith('/v1'):
                    u = u[:-3]
                return f"{u}/v1"

            if overrides.get('base_url') and provider == 'lmstudio':
                overrides['base_url'] = _normalize_lm_base(overrides.get('base_url'))
            if provider == 'lmstudio' and not user_api_key:
                # LM Studio does not require a key; supply a placeholder for OpenAI clients
                user_api_key = 'lm-studio'

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

            # Merge client-provided overrides (e.g., LM Studio base_url)
            payload_overrides = payload.get('overrides') or {}
            def _normalize_lm_base(url: str):
                if not url:
                    return url
                u = str(url).strip()
                if not u:
                    return u
                while u.endswith('/'):
                    u = u[:-1]
                if u.lower().endswith('/v1'):
                    u = u[:-3]
                if u.lower().endswith('/models'):
                    u = u[:-7]
                if u.lower().endswith('/v1'):
                    u = u[:-3]
                return f"{u}/v1"

            if isinstance(payload_overrides, dict):
                provider_overrides.update(payload_overrides)
            if provider == 'lmstudio' and provider_overrides.get('base_url'):
                provider_overrides['base_url'] = _normalize_lm_base(provider_overrides.get('base_url'))

            # LM Studio often omits API keys; supply a placeholder
            if provider == 'lmstudio' and not api_key:
                api_key = 'lm-studio'

            # Build kwargs for OpenAI-compatible clients
            chat_kwargs = {
                'temperature': temperature,
                'top_p': top_p,
                'max_tokens': max_tokens,
            }

            # Structured outputs: Gemini consumes structured_output, OpenAI-style providers use response_format
            structured_output = payload.get('structured_output')
            if structured_output:
                if provider == 'gemini':
                    pass  # forwarded below
                else:
                    if isinstance(structured_output, dict):
                        schema = structured_output.get('schema') or structured_output
                    else:
                        schema = structured_output
                    if schema and isinstance(schema, dict):
                        chat_kwargs['response_format'] = {
                            'type': 'json_schema',
                            'json_schema': {
                                'name': 'maid_structured_output',
                                'schema': schema,
                                'strict': True,
                            }
                        }
                    else:
                        chat_kwargs['response_format'] = {'type': 'json_object'}

            # Chuẩn bị payload cho AIService
            ai_payload = {
                'provider': provider,
                'operation': 'chat',
                'payload': {
                    'provider': provider,
                    'model': model,
                    'messages': messages,
                    'timeout': timeout,
                    'kwargs': chat_kwargs,
                    # Forward function-calling hints directly to AIService.
                    # Non-Gemini providers can safely ignore these fields.
                    'tools': tools,
                    'tool_mode': tool_mode,
                    'structured_output': payload.get('structured_output'),
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
                    if isinstance(result, dict):
                        r_type = result.get('type')
                        fn_name = result.get('name') if r_type == 'tool_call' else None
                        fn_args = result.get('arguments') if r_type == 'tool_call' else None
                        reply_text = result.get('text') or result.get('message') or ''
                        try:
                            import json
                            full_dump = json.dumps(result, ensure_ascii=False, indent=2, default=str)
                        except Exception:
                            full_dump = str(result)
                        print('[MaidChat] user_last_request:', repr(last_user))
                        if fn_name:
                            print('[MaidChat] function_call:', fn_name, fn_args)
                        print('[MaidChat] model_reply:', repr(reply_text))
                        print()
                        print(full_dump)
                        print()
                    else:
                        try:
                            import json
                            def _coerce(obj):
                                try:
                                    return obj if isinstance(obj, (str, int, float, bool, type(None))) else obj.__dict__
                                except Exception:
                                    return str(obj)
                            if hasattr(result, 'model_dump_json'):
                                full_dump = result.model_dump_json(indent=2)
                            else:
                                full_dump = json.dumps(result, default=_coerce, ensure_ascii=False, indent=2)
                            print('[MaidChat] user_last_request:', repr(last_user))
                            print('[MaidChat] model_reply:', repr(str(result)))
                            print()
                            print(full_dump)
                            print()
                        except Exception:
                            print('[MaidChat] user_last_request:', repr(last_user))
                            print('[MaidChat] model_reply:', repr(str(result)))
                            print()
                            print(str(result))
                            print()
                except Exception:
                    pass

                # Normalize OpenAI/LM Studio ChatCompletion-like responses to Maid-chan schema
                def _extract_text_and_struct(res_dict: dict):
                    text_val = ''
                    struct_val = None
                    tool_calls = None
                    if not isinstance(res_dict, dict):
                        return text_val, struct_val, tool_calls
                    choices = res_dict.get('choices')
                    if isinstance(choices, list) and choices:
                        first = choices[0] or {}
                        msg = first.get('message') or {}
                        content = msg.get('content')
                        tool_calls = msg.get('tool_calls') if isinstance(msg.get('tool_calls'), list) else None
                        if isinstance(content, str):
                            raw = content.strip()
                            text_val = raw
                            try:
                                import json as _json
                                parsed = _json.loads(raw)
                                if isinstance(parsed, dict):
                                    if 'text' in parsed and isinstance(parsed['text'], str):
                                        text_val = parsed['text']
                                    struct_val = parsed
                            except Exception:
                                # Fallback for truncated JSON
                                import re
                                m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)', raw)
                                if m:
                                    try:
                                        import json as _json
                                        text_val = _json.loads(f'"{m.group(1)}"')
                                    except Exception:
                                        text_val = m.group(1)
                        elif isinstance(content, list):
                            text_parts = []
                            for part in content:
                                if isinstance(part, str):
                                    text_parts.append(part)
                                elif isinstance(part, dict) and isinstance(part.get('text'), str):
                                    text_parts.append(part['text'])
                            text_val = '\n'.join(text_parts)
                    return text_val, struct_val, tool_calls

                normalized = result
                try:
                    if isinstance(result, dict) and 'choices' in result:
                        txt, struct_out, tool_calls = _extract_text_and_struct(result)
                        normalized = {
                            'type': 'message',
                            'text': txt,
                            'content': txt,
                            'model': result.get('model'),
                            'finish_reason': (result.get('choices') or [{}])[0].get('finish_reason') if isinstance(result.get('choices'), list) and result.get('choices') else None,
                        }
                        if struct_out:
                            normalized['structured_output'] = struct_out
                        if tool_calls:
                            normalized['tool_calls'] = tool_calls
                except Exception:
                    normalized = result

                def _jsonable(obj):
                    try:
                        if isinstance(obj, (str, int, float, bool)) or obj is None:
                            return obj
                        if isinstance(obj, dict):
                            return {k: _jsonable(v) for k, v in obj.items()}
                        if isinstance(obj, (list, tuple)):
                            return [_jsonable(v) for v in obj]
                        if hasattr(obj, 'model_dump'):
                            return obj.model_dump()
                        if hasattr(obj, 'to_dict'):
                            try:
                                return obj.to_dict()
                            except Exception:
                                pass
                        if hasattr(obj, '__dict__'):
                            return _jsonable(obj.__dict__)
                        return str(obj)
                    except Exception:
                        return str(obj)

                return jsonify(_jsonable(normalized))

            except Exception as exc:  # noqa: BLE001
                import traceback, time
                trace = traceback.format_exc()
                ts = time.strftime('%Y-%m-%d %H:%M:%S')
                print(f"[MaidChat] error {ts} {exc.__class__.__name__}: {exc}")
                return jsonify({
                    'error': str(exc),
                    'error_type': exc.__class__.__name__,
                    'provider': provider,
                    'model': model,
                    'tool_names': [t.get('name') for t in tools if isinstance(t, dict)],
                    'trace': trace[-1000:],  # shorter trace
                }), 400

        # --- Logic UI presets: save to data_cache/ai_logic_presets/<preset_name>.json ---
        @self.blueprint.post('/api/plugin/maid/logic/preset/save')
        def maid_logic_preset_save():
            """Autosave a Logic UI preset to server cache.

            Body JSON:
            {"preset_id": "p123", "preset_name": "My Flow", "graph": { nodes:[], edges:[] }, "client_ts": 1234567890}
            Writes to: data_cache/ai_logic_presets/<safe_preset_name>.json
            """
            # Require auth (same as other Maid endpoints)
            _ = _require_user()

            try:
                payload = request.get_json(force=True, silent=False) or {}
            except Exception:
                abort(400, description='Invalid JSON payload')

            preset_id = str(payload.get('preset_id') or '').strip()
            preset_name = str(payload.get('preset_name') or '').strip()
            graph = payload.get('graph')
            client_ts = payload.get('client_ts')

            if not isinstance(graph, dict):
                abort(400, description='Missing or invalid graph object')

            # Sanitize filename from name; fallback to id; final fallback to 'preset'
            base = preset_name or preset_id or 'preset'
            # Replace invalid filename characters with underscore
            import re
            base = re.sub(r'[\\/:*?"<>|]+', '_', base).strip()
            if not base:
                base = 'preset'

            # Ensure target directory exists
            rel_dir = os.path.join('ai_logic_presets')
            abs_dir = self.core_api.data_manager.get_path(rel_dir)
            os.makedirs(abs_dir, exist_ok=True)

            rel_path = os.path.join(rel_dir, f"{base}.json")
            # Include minimal metadata for convenience
            to_save = {
                'preset_id': preset_id or None,
                'preset_name': preset_name or None,
                'client_ts': int(client_ts) if isinstance(client_ts, (int, float, str)) and str(client_ts).isdigit() else int(time.time() * 1000),
                'graph': graph,
            }
            ok = self.core_api.data_manager.save_json(to_save, rel_path, obfuscated=False)
            if not ok:
                abort(500, description='Failed to write preset file')

            return jsonify({
                'status': 'ok',
                'file': f"{base}.json",
                'path': f"/data_cache/ai_logic_presets/{base}.json",
            })

    def get_blueprint(self):
        # Mount at root so avatar URLs /user_image/maid_avatar/... remain stable
        # and models endpoint stays at /api/plugin/maid/models via absolute route.
        return self.blueprint, '/'

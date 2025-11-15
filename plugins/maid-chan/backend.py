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

    def get_blueprint(self):
        # Mount at root so avatar URLs /user_image/maid_avatar/... remain stable
        # and models endpoint stays at /api/plugin/maid/models via absolute route.
        return self.blueprint, '/'

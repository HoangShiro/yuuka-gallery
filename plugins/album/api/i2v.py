"""API routes for I2V (Image-to-Video) generation from album images."""
import os
import base64
import time
import uuid
import psutil
from flask import jsonify, request, abort


def register_routes(blueprint, plugin):

    MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB

    @blueprint.route('/<character_hash>/i2v/config', methods=['GET'])
    def get_i2v_config(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        config = plugin._get_i2v_config(character_hash)
        return jsonify(config)

    @blueprint.route('/<character_hash>/i2v/config', methods=['POST'])
    def save_i2v_config(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing config data.")
        saved = plugin._save_i2v_config(character_hash, data)
        return jsonify({"status": "success", "config": saved})

    @blueprint.route('/<character_hash>/i2v/upload', methods=['POST'])
    def upload_image_to_album(character_hash):
        """Upload an external image into the character album with empty prompt fields."""
        user_hash = plugin.core_api.verify_token_and_get_user_hash()

        if 'image' not in request.files:
            abort(400, description="Missing image file.")

        file = request.files['image']
        if not file or not file.filename:
            abort(400, description="No file selected.")

        # Validate file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        if file_size > MAX_UPLOAD_SIZE:
            abort(400, description="File size exceeds 20MB limit.")
        if file_size == 0:
            abort(400, description="Empty file.")

        # Read and validate image
        image_bytes = file.read()
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(image_bytes))
            img.verify()  # Validate it's a real image
        except Exception:
            abort(400, description="Invalid image file.")

        # Convert to base64 for save_image_metadata
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')

        # Save with empty generation config (uploaded, not generated)
        empty_config = {
            "character": "",
            "expression": "",
            "action": "",
            "outfits": "",
            "context": "",
            "quality": "",
            "negative": "",
            "prompt": "",
            "_source": "upload",
        }

        new_metadata = plugin.core_api.image_service.save_image_metadata(
            user_hash, character_hash, image_b64, empty_config
        )

        return jsonify({"status": "success", "image": new_metadata})

    @blueprint.route('/<character_hash>/i2v/video/<image_id>/settings', methods=['GET'])
    def get_i2v_video_settings(character_hash, image_id):
        """Load I2V prompt/settings for a specific video."""
        plugin.core_api.verify_token_and_get_user_hash()
        settings = plugin._get_i2v_video_settings(character_hash, image_id)
        return jsonify(settings)

    @blueprint.route('/<character_hash>/i2v/video/<image_id>/settings', methods=['POST'])
    def save_i2v_video_settings(character_hash, image_id):
        """Save I2V prompt/settings for a specific video."""
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing settings data.")
        saved = plugin._save_i2v_video_settings(character_hash, image_id, data)
        return jsonify({"status": "success", "settings": saved})

    @blueprint.route('/<character_hash>/i2v/sys_prompts', methods=['GET'])
    def get_i2v_sys_prompts(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        config = plugin._get_i2v_sys_prompts()
        return jsonify(config)

    @blueprint.route('/<character_hash>/i2v/sys_prompts', methods=['POST'])
    def save_i2v_sys_prompts(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing config data.")
        saved = plugin._save_i2v_sys_prompts(data)
        return jsonify({"status": "success", "config": saved})

    @blueprint.route('/<character_hash>/i2v/prompt_generate', methods=['POST'])
    def i2v_prompt_generate(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing data.")
        user_prompt = data.get("prompt", "")
        
        active = plugin._get_active_sys_prompts()
        sys_prompt_content = active["sys_prompt"]
        
        def generate():
            from integrations.openai import get_client
            try:
                client = get_client(provider="ollama")
                response = client.chat.completions.create(
                    model="deepseek-v3.1:671b-cloud",
                    messages=[
                        {"role": "system", "content": sys_prompt_content},
                        {"role": "user", "content": f"User's request or short description: {user_prompt}" if user_prompt else "Create a creative, high-quality prompt out of thin air."}
                    ],
                    stream=True
                )
                for chunk in response:
                    content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                    if content:
                        yield content
            except Exception as e:
                yield f"\n[Error: {e}]"
            finally:
                try:
                    import urllib.request, json
                    req = urllib.request.Request(
                        "http://localhost:11434/api/generate",
                        data=json.dumps({"model": "deepseek-v3.1:671b-cloud", "keep_alive": 0}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5) as res:
                        pass
                except:
                    pass

        from flask import Response, stream_with_context
        return Response(stream_with_context(generate()), mimetype='text/plain')

    @blueprint.route('/<character_hash>/i2v/image_caption', methods=['POST'])
    def i2v_image_caption(character_hash):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing data.")
            
        image_id = data.get("image_id")
        user_prompt = data.get("prompt", "")
        
        if not image_id:
            abort(400, description="Missing image_id.")
            
        try:
            found_char_hash, image_entry = plugin._find_user_image(user_hash, image_id)
        except Exception:
            found_char_hash, image_entry = None, None

        if not image_entry:
            abort(404, description="Image not found.")
            
        image_url = image_entry.get("url", "")
        filename = os.path.basename(image_url) if image_url else ""
        if not filename:
            abort(400, description="Missing source image file reference.")

        image_bytes, _ = plugin.core_api.get_user_image_data('imgs', filename)
        if not image_bytes:
            abort(404, description="Source image file could not be loaded.")
            
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')
        
        active = plugin._get_active_sys_prompts()
        sys_icap = active["sys_icap"]
        sys_prompt_content = active["sys_prompt"]
        
        def generate():
            from integrations.openai import get_client
            try:
                client = get_client(provider="ollama")
                yield "📷 Đang phân tích ảnh"
                
                # 1. Image Captioning calls local minicpm-v
                response_caption = client.chat.completions.create(
                    model="minicpm-v",
                    messages=[
                        {
                            "role": "user", 
                            "content": [
                                {"type": "text", "text": sys_icap},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}}
                            ]
                        }
                    ],
                    stream=True
                )
                
                image_caption = ""
                for chunk in response_caption:
                    content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                    if content:
                        image_caption += content

                # Unload minicpm-v
                try:
                    import urllib.request, json
                    req = urllib.request.Request(
                        "http://localhost:11434/api/generate",
                        data=json.dumps({"model": "minicpm-v", "keep_alive": 0}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5) as res:
                        pass
                except:
                    pass

                yield "\n\n✨ Đang tạo prompt..."
                
                # 2. Prompt Generation calls cloud deepseek
                combined_prompt = f"IMAGE CAPTION:\n{image_caption}\n\nUSER PROMPT ADDITION:\n{user_prompt}" if user_prompt else f"IMAGE CAPTION:\n{image_caption}"
                
                response_gen = client.chat.completions.create(
                    model="deepseek-v3.1:671b-cloud",
                    messages=[
                        {"role": "system", "content": sys_prompt_content},
                        {"role": "user", "content": combined_prompt}
                    ],
                    stream=True
                )

                first = True
                for chunk in response_gen:
                    content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                    if content:
                        if first:
                            yield "<CLEAR>"
                            first = False
                        yield content
                        
            except Exception as e:
                yield f"\n[Error: {e}]"
            finally:
                # Unload deepseek
                try:
                    import urllib.request, json
                    req = urllib.request.Request(
                        "http://localhost:11434/api/generate",
                        data=json.dumps({"model": "deepseek-v3.1:671b-cloud", "keep_alive": 0}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5) as res:
                        pass
                except:
                    pass

        from flask import Response, stream_with_context
        return Response(stream_with_context(generate()), mimetype='text/plain')

    @blueprint.route('/<character_hash>/i2v/start', methods=['POST'])
    def start_i2v_generation(character_hash):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing request data.")

        image_id = data.get('image_id')
        if not image_id:
            abort(400, description="Missing image_id.")

        # Locate the source image
        try:
            found_char_hash, image_entry = plugin._find_user_image(user_hash, image_id)
        except Exception:
            found_char_hash, image_entry = None, None

        if not image_entry:
            abort(404, description="Image not found.")
        if not found_char_hash:
            abort(400, description="Unable to resolve character for image.")

        # Load I2V settings for this album
        i2v_config = plugin._get_i2v_config(character_hash)

        # Get server address from album comfy config
        char_configs = plugin.core_api.read_data(plugin.ALBUM_CHAR_CONFIG_FILENAME)
        char_specific = char_configs.get(character_hash, {})
        global_comfy = plugin.core_api.read_data(plugin.COMFYUI_CONFIG_FILENAME)
        server_address = (
            char_specific.get('server_address')
            or global_comfy.get('server_address')
            or plugin.DEFAULT_CONFIG['server_address']
        ).strip()

        # Check memory and run yuuka_free_all_memory if > 80% 
        if psutil.virtual_memory().percent > 80:
            print("[I2V API] System RAM > 80%, attempting to run YuukaFreeAllMemory node...")
            try:
                memory_workflow = {
                    "1": {
                        "class_type": "YuukaFreeAllMemory",
                        "inputs": {"enable": True}
                    }
                }
                client_id = str(uuid.uuid4())
                res_mem = plugin.core_api.comfy_api_client.queue_prompt(memory_workflow, client_id, server_address)
                prompt_id = res_mem.get("prompt_id")
                if prompt_id:
                    for _ in range(20): # Tối đa 10s
                        history = plugin.core_api.comfy_api_client.get_history(prompt_id, server_address)
                        if prompt_id in history:
                            break
                        time.sleep(0.5)
            except Exception as e:
                print(f"[I2V API] Warning: Memory free workflow failed: {e}")
                
            time.sleep(1) # Đợi hệ điều hành cập nhật lại trạng thái RAM sau khi dọn dẹp
            if psutil.virtual_memory().percent > 90:
                abort(400, description="Hệ thống đang sử dụng quá nhiều RAM (>90%) sau khi dọn dẹp. Không thể chạy tác vụ I2V nặng lúc này, thiết bị của bạn có thể sẽ đơ nếu tiếp tục, vui lòng đóng bớt ứng dụng khác hoặc chờ một lát!")

        # Read image bytes and upload to ComfyUI as first/last frames
        image_url = image_entry.get("url", "")
        filename = os.path.basename(image_url) if image_url else ""
        if not filename:
            abort(400, description="Missing source image file reference.")

        image_bytes, _ = plugin.core_api.get_user_image_data('imgs', filename)
        if not image_bytes:
            abort(404, description="Source image file could not be loaded.")

        upload_basename = f"album_i2v_{image_id.replace('-', '')}.png"
        try:
            stored_name = plugin.core_api.comfy_api_client.upload_image_bytes(
                image_bytes,
                upload_basename,
                server_address
            )
        except ConnectionError as err:
            abort(503, description=str(err))

        # Map resolution preset to megapixel value
        resolution_map = {"480p": 0.4, "720p": 0.85}
        resolution_mp = resolution_map.get(
            i2v_config.get("resolution", "480p"), 0.4
        )

        # Build generation config for dasiwa_wan2_i2v workflow
        cfg_data = {
            "server_address": server_address,
            "_workflow_type": "dasiwa_wan2_i2v",
            "prompt": i2v_config.get("prompt", ""),
            "positive_prompt": i2v_config.get("prompt", ""),
            "seconds": int(i2v_config.get("seconds", 5)),
            "fps": int(i2v_config.get("fps", 16)),
            "enable_loop": i2v_config.get("enable_loop", True),
            "enable_interpolation": i2v_config.get("enable_interpolation", True),
            "resolution_mp": resolution_mp,
            "_first_frame_image_name": stored_name,
            "_last_frame_image_name": stored_name,
            "seed": 0,  # random seed
        }

        context = {
            "origin": "album.i2v",
            "source_image_id": image_id,
            "timeout_seconds": 900,  # 15-minute timeout
        }

        try:
            task_id, message = plugin.core_api.generation_service.start_generation_task(
                user_hash,
                character_hash,
                cfg_data,
                context
            )
            if task_id:
                return jsonify({"status": "started", "task_id": task_id, "message": message})
            return jsonify({"error": message}), 429
        except ConnectionError as err:
            abort(503, description=str(err))
        except Exception as e:
            abort(500, description=f"Failed to start I2V generation: {e}")


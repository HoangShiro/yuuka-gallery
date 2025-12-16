from flask import jsonify, request, abort
import os
from copy import deepcopy
from ..utils import safe_int, normalize_lora_tags

def register_routes(blueprint, plugin):
    @blueprint.route('/images/<image_id>/hires', methods=['POST'])
    def start_image_hires(image_id):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        try:
            character_hash, image_entry = plugin._find_user_image(user_hash, image_id)
            if not image_entry:
                abort(404, description="Image not found.")
            if not character_hash:
                abort(400, description="Unable to resolve character for image.")

            generation_config = image_entry.get("generationConfig") or {}
            if not isinstance(generation_config, dict):
                generation_config = {}
            generation_config = deepcopy(generation_config)

            hires_flag = generation_config.get("hires_enabled", False)
            if isinstance(hires_flag, str):
                hires_flag = hires_flag.strip().lower() in ("1", "true", "yes")
            if hires_flag:
                abort(400, description="Image is already a hires result.")

            original_width = safe_int(generation_config.get("width"), plugin.DEFAULT_CONFIG["width"])
            original_height = safe_int(generation_config.get("height"), plugin.DEFAULT_CONFIG["height"])
            if original_width <= 0 or original_height <= 0:
                abort(400, description="Invalid base dimensions for source image.")

            server_address = generation_config.get("server_address") or plugin.DEFAULT_CONFIG["server_address"]
            image_url = image_entry.get("url", "")
            filename = os.path.basename(image_url) if image_url else ""
            if not filename:
                abort(400, description="Missing source image file reference.")

            image_bytes, _ = plugin.core_api.get_user_image_data('imgs', filename)
            if not image_bytes:
                abort(404, description="Source image file could not be loaded.")

            upload_basename = f"album_hires_{image_id.replace('-', '')}.png"
            try:
                stored_name = plugin.core_api.comfy_api_client.upload_image_bytes(
                    image_bytes,
                    upload_basename,
                    server_address
                )
            except ConnectionError as err:
                abort(503, description=str(err))

            target_width = max(original_width * 2, original_width)
            target_height = max(original_height * 2, original_height)

            generation_config["_workflow_type"] = "hires_input_image"
            generation_config["_input_image_name"] = stored_name
            generation_config["_input_image_width"] = original_width
            generation_config["_input_image_height"] = original_height
            generation_config["hires_base_width"] = original_width
            generation_config["hires_base_height"] = original_height
            generation_config["hires_enabled"] = False
            generation_config["width"] = target_width
            generation_config["height"] = target_height
            generation_config["server_address"] = server_address
            generation_config["lora_prompt_tags"] = normalize_lora_tags(
                generation_config.get("lora_prompt_tags")
            )
            generation_config["seed"] = safe_int(generation_config.get("seed"), 0)

            context = {"origin": "album.hires", "source_image_id": image_id}
            task_id, message = plugin.core_api.generation_service.start_generation_task(
                user_hash,
                character_hash,
                generation_config,
                context
            )
            if task_id:
                return jsonify({"status": "started", "task_id": task_id, "message": message})
            return jsonify({"error": message}), 429

        except ConnectionError as err:
            abort(503, description=str(err))
        except Exception as e:
            abort(500, description=f"Failed to start hires generation: {e}")

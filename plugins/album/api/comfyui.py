from flask import jsonify, request, abort

def register_routes(blueprint, plugin):
    @blueprint.route('/comfyui/info', methods=['GET'])
    def comfyui_info():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        character_hash = request.args.get('character_hash')
        server_address = request.args.get('server_address')
        
        global_comfy_config = plugin.core_api.read_data(plugin.COMFYUI_CONFIG_FILENAME)
        char_configs = plugin.core_api.read_data(plugin.ALBUM_CHAR_CONFIG_FILENAME)
        char_specific_config = char_configs.get(character_hash, {})
        
        latest_image_config = {}
        if character_hash:
            # Yuuka: Lấy ảnh từ service lõi
            images = plugin.core_api.image_service.get_images_by_character(user_hash, character_hash)
            if images:
                latest_image_config = images[0]['generationConfig'] # Dữ liệu đã được sắp xếp
        
        final_config = { 
            **plugin.DEFAULT_CONFIG, 
            **plugin._sanitize_config(latest_image_config), 
            **plugin._sanitize_config(global_comfy_config), 
            **plugin._sanitize_config(char_specific_config) 
        }

        if not final_config.get('hires_base_width'):
            final_config['hires_base_width'] = final_config.get('width', 0)
        if not final_config.get('hires_base_height'):
            final_config['hires_base_height'] = final_config.get('height', 0)
        if final_config.get('hires_enabled'):
            try:
                base_w = int(final_config.get('hires_base_width') or 0)
                base_h = int(final_config.get('hires_base_height') or 0)
            except (TypeError, ValueError):
                base_w = base_h = 0
            if not base_w or not base_h:
                try:
                    base_w = max(1, int(int(final_config.get('width', 0)) / 2))
                    base_h = max(1, int(int(final_config.get('height', 0)) / 2))
                except (TypeError, ValueError):
                    base_w, base_h = 0, 0
            final_config['hires_base_width'] = base_w
            final_config['hires_base_height'] = base_h

        target_address = (server_address or final_config.get('server_address', '127.0.0.1:8888')).strip()

        # Yuuka: comfyui fetch optimization v1.0
        if request.args.get('no_choices', 'false').lower() == 'true':
            # Provide a normalized LoRA chain view to help multi-select UIs
            norm_chain = plugin._normalize_lora_chain(final_config)
            lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
            return jsonify({
                "last_config": final_config,
                "normalized_lora_chain": norm_chain,
                "lora_names": lora_names_simple,
            })

        try:
            all_choices = plugin.core_api.comfy_api_client.get_full_object_info(target_address)

            base_size_options = [
                {"name": "IL 832x1216 - Chân dung (Khuyến nghị)", "value": "832x1216"},
                {"name": "IL 1216x832 - Phong cảnh", "value": "1216x832"},
                {"name": "IL 1344x768", "value": "1344x768"},
                {"name": "IL 1024x1024 - Vuông", "value": "1024x1024"}
            ]
            size_variants = []
            for option in base_size_options:
                raw_value = option.get("value", "")
                try:
                    base_width, base_height = map(int, raw_value.split("x"))
                except (ValueError, AttributeError):
                    continue

                base_entry = {
                    "name": option.get("name", f"{base_width}x{base_height}"),
                    "value": f"{base_width}x{base_height}",
                    "dataAttrs": {
                        "mode": "standard",
                        "baseWidth": str(base_width),
                        "baseHeight": str(base_height)
                    }
                }
                size_variants.append(base_entry)

                hires_width = base_width * 2
                hires_height = base_height * 2
                hires_entry = {
                    "name": f"{option.get('name', f'{base_width}x{base_height}')} x2 ({hires_width}x{hires_height})",
                    "value": f"{hires_width}x{hires_height}",
                    "dataAttrs": {
                        "mode": "hires",
                        "baseWidth": str(base_width),
                        "baseHeight": str(base_height)
                    }
                }
                size_variants.append(hires_entry)

            all_choices["sizes"] = size_variants
            all_choices["checkpoints"] = [{"name": c, "value": c} for c in all_choices.get("checkpoints", [])]
            all_choices["samplers"] = [{"name": s, "value": s} for s in all_choices.get("samplers", [])]
            all_choices["schedulers"] = [{"name": s, "value": s} for s in all_choices.get("schedulers", [])]
            all_choices["hires_upscale_models"] = [{"name": m, "value": m} for m in all_choices.get("upscale_models", [])]
            hires_methods = all_choices.get("upscale_methods") or ["bilinear", "nearest", "nearest-exact", "bicubic", "lanczos", "area"]
            all_choices["hires_upscale_methods"] = [{"name": method, "value": method} for method in hires_methods]
            lora_names = all_choices.get("loras", [])
            lora_options = [{"name": "None", "value": "None"}]
            seen_loras = {"None"}
            for name in lora_names:
                if not name or name in seen_loras:
                    continue
                lora_options.append({"name": name, "value": name})
                seen_loras.add(name)
            all_choices["loras"] = lora_options
            # Multi-LoRA capability hints for frontend
            all_choices["multi_lora_supported"] = True
            all_choices["lora_defaults"] = {
                "lora_strength_model": plugin.DEFAULT_CONFIG.get("lora_strength_model", 0.9),
                "lora_strength_clip": plugin.DEFAULT_CONFIG.get("lora_strength_clip", 1.0),
            }
            norm_chain = plugin._normalize_lora_chain(final_config)
            lora_names_simple = [entry['lora_name'] for entry in norm_chain] if norm_chain else []
            return jsonify({
                "global_choices": all_choices,
                "last_config": final_config,
                "normalized_lora_chain": norm_chain,
                "lora_names": lora_names_simple,
            })
        except Exception as e:
            abort(500, description=f"Failed to get info from ComfyUI: {e}")

    @blueprint.route('/comfyui/config', methods=['POST'])
    def save_comfyui_config():
        plugin.core_api.verify_token_and_get_user_hash()
        config_data = request.json
        if not config_data: abort(400, "Missing config data.")
        plugin.core_api.save_data(plugin._sanitize_config(config_data), plugin.COMFYUI_CONFIG_FILENAME)
        return jsonify({"status": "success"})

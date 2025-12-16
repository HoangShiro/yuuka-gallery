from flask import jsonify, request, abort

def register_routes(blueprint, plugin):
    @blueprint.route('/<character_hash>/config', methods=['POST'])
    def save_character_config(character_hash):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        config_data = request.json
        if not config_data:
            abort(400, "Missing config data.")

        all_char_configs = plugin.core_api.read_data(plugin.ALBUM_CHAR_CONFIG_FILENAME)
        sanitized_config = plugin._sanitize_config(config_data)
        all_char_configs[character_hash] = sanitized_config
        plugin.core_api.save_data(all_char_configs, plugin.ALBUM_CHAR_CONFIG_FILENAME)

        # Nếu đây là một nhân vật tùy chỉnh (không có trong database gốc) thì cập nhật danh sách album tùy chỉnh
        if not plugin.core_api.get_character_by_hash(character_hash):
            plugin._update_custom_album_entry(
                user_hash,
                character_hash,
                sanitized_config.get("character", "")
            )

        return jsonify({"status": "success", "message": "Character-specific config saved."})

    @blueprint.route('/<character_hash>', methods=['DELETE'])
    def delete_character_album(character_hash):
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        if not character_hash:
            abort(400, "Missing character hash.")

        result = plugin._delete_character_album(user_hash, character_hash)
        status = "success"
        if (
            not result["images_removed"]
            and not result["config_removed"]
            and not result["custom_removed"]
        ):
            status = "not_found"
        return jsonify({
            "status": status,
            "images_removed": result["images_removed"],
            "config_removed": result["config_removed"],
            "custom_entry_removed": result["custom_removed"],
        })

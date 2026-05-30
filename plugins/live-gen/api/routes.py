from flask import Blueprint, jsonify, request

def setup_routes(blueprint, plugin):
    core_api = plugin.core_api
    config_service = plugin.config_service
    history_service = plugin.history_service

    @blueprint.route("/config", methods=["GET"])
    def get_config():
        user_hash = core_api.verify_token_and_get_user_hash()
        config = config_service.get_config()
        # Đọc dữ liệu Preferences cá nhân hóa của user
        prefs = core_api.data_manager.load_user_data("live_gen_user_prefs.json", user_hash, default_value={}, obfuscated=True)
        config["llm_user_preferences"] = prefs.get("user_preferences", "")
        return jsonify(config)

    @blueprint.route("/config", methods=["POST"])
    def save_config():
        user_hash = core_api.verify_token_and_get_user_hash()
        data = request.get_json(silent=True) or {}
        # Lưu các trường cấu hình chung
        config = config_service.save_config(data)
        # Lưu Preferences cá nhân hóa
        if "llm_user_preferences" in data:
            prefs = {"user_preferences": data["llm_user_preferences"]}
            core_api.data_manager.save_user_data(prefs, "live_gen_user_prefs.json", user_hash, obfuscated=True)
            config["llm_user_preferences"] = data["llm_user_preferences"]
        else:
            # Gộp lại Preferences hiện tại vào config trả về
            prefs = core_api.data_manager.load_user_data("live_gen_user_prefs.json", user_hash, default_value={}, obfuscated=True)
            config["llm_user_preferences"] = prefs.get("user_preferences", "")
        return jsonify({"status": "success", "config": config})

    @blueprint.route("/llm/models", methods=["GET"])
    def get_llm_models():
        core_api.verify_token_and_get_user_hash()
        provider = request.args.get("provider", "gemini")
        api_key = request.args.get("api_key", "")
        domain = request.args.get("domain", "")
        
        overrides = {}
        if domain:
            overrides["base_url"] = domain
            
        try:
            models = core_api.ai_service.list_models(
                provider=provider,
                user_api_key=api_key if api_key else None,
                provider_overrides=overrides if overrides else None
            )
            return jsonify({"status": "success", "models": models})
        except Exception as err:
            return jsonify({"error": str(err)}), 400

    @blueprint.route("/llm/generate", methods=["POST"])
    def generate_llm_prompt():
        user_hash = core_api.verify_token_and_get_user_hash()
        data = request.get_json(silent=True) or {}
        prompt = data.get("prompt", "")
        
        try:
            suggested_tags = plugin.llm_service.generate_prompt_completion(user_hash, prompt)
            return jsonify({"status": "success", "text": suggested_tags})
        except Exception as err:
            return jsonify({"error": str(err)}), 500

    @blueprint.route("/llm/analyze", methods=["POST"])
    def analyze_llm_preferences():
        user_hash = core_api.verify_token_and_get_user_hash()
        try:
            summary = plugin.llm_service.analyze_user_preferences(user_hash)
            return jsonify({"status": "success", "preferences": summary})
        except Exception as err:
            return jsonify({"error": str(err)}), 500

    @blueprint.route("/comfy-info", methods=["GET"])
    def get_comfy_info():
        core_api.verify_token_and_get_user_hash()
        config = config_service.get_config()
        server_address = config.get("server_address", "127.0.0.1:8888")
        try:
            info = core_api.comfy_api_client.get_full_object_info(server_address)
            return jsonify(info)
        except Exception as err:
            return jsonify({"error": str(err)}), 500

    @blueprint.route("/history", methods=["GET"])
    def get_history_images():
        user_hash = core_api.verify_token_and_get_user_hash()
        images = history_service.get_history_images(user_hash)
        return jsonify({"status": "success", "images": images})

    @blueprint.route("/favorites", methods=["GET"])
    def get_favorites_images():
        user_hash = core_api.verify_token_and_get_user_hash()
        images = history_service.get_favorites_images(user_hash)
        return jsonify({"status": "success", "images": images})

    @blueprint.route("/favorite", methods=["POST"])
    def add_favorite():
        user_hash = core_api.verify_token_and_get_user_hash()
        data = request.get_json(silent=True) or {}
        image_url = data.get("imageUrl")
        if not image_url:
            return jsonify({"error": "Thiếu imageUrl"}), 400
            
        res = history_service.add_favorite(user_hash, image_url)
        if res.get("status") == "error":
            return jsonify({"error": res.get("message")}), res.get("code", 400)
            
        return jsonify(res)

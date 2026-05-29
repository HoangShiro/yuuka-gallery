from flask import Blueprint, jsonify, request

def setup_routes(blueprint, plugin):
    core_api = plugin.core_api
    config_service = plugin.config_service
    history_service = plugin.history_service

    @blueprint.route("/config", methods=["GET"])
    def get_config():
        core_api.verify_token_and_get_user_hash()
        return jsonify(config_service.get_config())

    @blueprint.route("/config", methods=["POST"])
    def save_config():
        core_api.verify_token_and_get_user_hash()
        data = request.get_json(silent=True) or {}
        config = config_service.save_config(data)
        return jsonify({"status": "success", "config": config})

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

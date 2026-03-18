import os
import json
import shutil
from flask import jsonify, request

# data_cache filename for emotion rules
DATA_CACHE_FILENAME = "chat_emotion_rules.json"

def _get_data_cache_path(plugin):
    """Returns the path to the emotion rules in data_cache, copying default if needed."""
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_path = os.path.join(plugin_dir, "static", "js", "emotion_engine", "rules.json")

    app_root = os.path.dirname(os.path.dirname(plugin_dir))
    data_cache_dir = os.path.join(app_root, "data_cache")
    cache_path = os.path.join(data_cache_dir, DATA_CACHE_FILENAME)

    if not os.path.exists(cache_path) and os.path.exists(default_path):
        os.makedirs(data_cache_dir, exist_ok=True)
        shutil.copy2(default_path, cache_path)
        print(f"[Plugin:Chat] Copied default emotion rules to {cache_path}")

    return cache_path

def register_routes(blueprint, plugin):
    @blueprint.route('/emotion/rules', methods=['GET'])
    def get_rules():
        try:
            plugin.core_api.verify_token_and_get_user_hash()
            cache_path = _get_data_cache_path(plugin)

            if not os.path.exists(cache_path):
                return jsonify({"error": "rules.json not found"}), 404

            with open(cache_path, "r", encoding="utf-8") as f:
                rules = json.load(f)
            return jsonify(rules)
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/emotion/rules', methods=['POST'])
    def save_rules():
        try:
            plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            if not data:
                return jsonify({"error": "No data provided"}), 400

            cache_path = _get_data_cache_path(plugin)
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)

            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)

            return jsonify({"status": "success"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

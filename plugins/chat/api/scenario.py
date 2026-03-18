from flask import jsonify, request


def register_routes(blueprint, plugin):
    @blueprint.route('/scenarios', methods=['GET'])
    def get_all_scenarios():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = plugin.get_all_scenarios(user_hash)
            return jsonify({"status": "success", "scenes": data.get("scenes", {}), "rules": data.get("rules", {})})
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/scenarios/scenes', methods=['POST'])
    @blueprint.route('/scenarios/scenes/<scene_id>', methods=['POST', 'PUT'])
    def save_scene(scene_id=None):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            result = plugin.save_scene(user_hash, data, scene_id)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/scenarios/scenes/<scene_id>', methods=['DELETE'])
    def delete_scene(scene_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            success = plugin.delete_scene(user_hash, scene_id)
            if success:
                return jsonify({"status": "success"})
            return jsonify({"error": "Scene not found"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/scenarios/rules', methods=['POST'])
    @blueprint.route('/scenarios/rules/<rule_id>', methods=['POST', 'PUT'])
    def save_rule(rule_id=None):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            result = plugin.save_rule(user_hash, data, rule_id)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/scenarios/rules/<rule_id>', methods=['DELETE'])
    def delete_rule(rule_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            success = plugin.delete_rule(user_hash, rule_id)
            if success:
                return jsonify({"status": "success"})
            return jsonify({"error": "Cannot delete default rules or rule not found"}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/scenarios/rules/<rule_id>/reset', methods=['POST'])
    def reset_rule(rule_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            result = plugin.reset_rule(user_hash, rule_id)
            if result:
                return jsonify({"status": "success", "data": result})
            return jsonify({"error": "Rule is not a default rule or not found"}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 400

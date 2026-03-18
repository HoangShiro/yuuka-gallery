from flask import jsonify, request

def register_routes(blueprint, plugin):
    @blueprint.route('/personas', methods=['GET'])
    def get_personas():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            personas = plugin.get_all_personas(user_hash)
            return jsonify(personas)
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/personas/<persona_type>', methods=['POST'])
    @blueprint.route('/personas/<persona_type>/<persona_id>', methods=['POST', 'PUT'])
    def save_persona(persona_type, persona_id=None):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            result = plugin.save_persona(user_hash, persona_type, persona_id, data)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/personas/<persona_type>/<persona_id>', methods=['DELETE'])
    def delete_persona(persona_type, persona_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            success = plugin.delete_persona(user_hash, persona_type, persona_id)
            if success:
                return jsonify({"status": "success"})
            return jsonify({"error": "Persona not found"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 400

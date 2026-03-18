from flask import jsonify, request


def register_routes(blueprint, plugin):
    @blueprint.route('/group_sessions', methods=['GET'])
    def get_all_group_sessions():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            sessions = plugin.get_all_group_sessions(user_hash)
            return jsonify({"sessions": sessions})
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/group_sessions/<group_id>', methods=['GET'])
    def get_group_session(group_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            session = plugin.get_group_session(user_hash, group_id)
            if session is None:
                return jsonify({"error": "Group session not found"}), 404
            return jsonify({"session": session})
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/group_sessions', methods=['POST'])
    def create_group_session():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json or {}

            name = data.get("name", "")
            if not name or not name.strip():
                return jsonify({"error": "Name cannot be empty"}), 400

            member_hashes = data.get("member_hashes", [])
            if len(member_hashes) < 2:
                return jsonify({"error": "At least 2 members are required"}), 400

            result = plugin.save_group_session(user_hash, None, data)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/group_sessions/<group_id>', methods=['PUT'])
    def update_group_session(group_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            existing = plugin.get_group_session(user_hash, group_id)
            if existing is None:
                return jsonify({"error": "Group session not found"}), 404

            data = request.json or {}

            # Validate member_hashes if provided in the update
            if "member_hashes" in data:
                new_members = data["member_hashes"]
                current_members = existing.get("member_hashes", [])

                # Adding members: check max 5
                if len(new_members) > len(current_members):
                    if len(new_members) > 5:
                        return jsonify({"error": "Cannot exceed 5 members"}), 400

                # Removing members: check min 2
                if len(new_members) < len(current_members):
                    if len(new_members) < 2:
                        return jsonify({"error": "Cannot have fewer than 2 members"}), 400

            # Merge existing data with updates
            merged = {**existing, **data}
            merged["id"] = group_id

            result = plugin.save_group_session(user_hash, group_id, merged)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/group_sessions/<group_id>', methods=['DELETE'])
    def delete_group_session(group_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            success = plugin.delete_group_session(user_hash, group_id)
            if success:
                return jsonify({"status": "success"})
            return jsonify({"error": "Group session not found"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 400

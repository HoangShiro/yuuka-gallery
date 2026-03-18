from flask import jsonify, request

def register_routes(blueprint, plugin):
    @blueprint.route('/sessions', methods=['GET'])
    def get_all_sessions():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            personas = plugin.get_all_personas(user_hash)
            char_hashes = list(personas.get("characters", {}).keys())
            
            all_sessions = []
            for char_hash in char_hashes:
                sessions = plugin.get_character_sessions(user_hash, char_hash)
                for session_id, session_data in sessions.items():
                    messages = session_data.get("messages", [])
                    last_msg = ""
                    for m in reversed(messages):
                        if m.get("role") != "system":
                            if "snapshots" in m:
                                active_idx = m.get("activeIndex", -1)
                                try:
                                    snap = m["snapshots"][active_idx]
                                    if isinstance(snap, list) and len(snap) > 0:
                                        last_msg = snap[0]
                                    else:
                                        last_msg = snap if isinstance(snap, str) else ""
                                except IndexError:
                                    last_msg = ""
                            else:
                                last_msg = m.get("content", "")
                            break
                    all_sessions.append({
                        "id": session_id,
                        "char_hash": char_hash,
                        "updated_at": session_data.get("updated_at", 0),
                        "last_message": last_msg
                    })
                    
            # Merge group sessions
            group_sessions = plugin.get_all_group_sessions(user_hash)
            for group_id, session_data in group_sessions.items():
                messages = session_data.get("messages", [])
                last_msg = ""
                for m in reversed(messages):
                    if m.get("role") != "system":
                        if "snapshots" in m:
                            active_idx = m.get("activeIndex", -1)
                            try:
                                snap = m["snapshots"][active_idx]
                                if isinstance(snap, list) and len(snap) > 0:
                                    last_msg = snap[0]
                                else:
                                    last_msg = snap if isinstance(snap, str) else ""
                            except IndexError:
                                last_msg = ""
                        else:
                            last_msg = m.get("content", "")
                        break
                all_sessions.append({
                    "id": group_id,
                    "is_group": True,
                    "name": session_data.get("name", ""),
                    "avatar": session_data.get("avatar", ""),
                    "member_hashes": session_data.get("member_hashes", []),
                    "updated_at": session_data.get("updated_at", 0),
                    "last_message": last_msg
                })

            all_sessions.sort(key=lambda x: x["updated_at"], reverse=True)
            return jsonify({"sessions": all_sessions})
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/sessions/<char_hash>', methods=['GET'])
    def get_character_sessions(char_hash):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            sessions = plugin.get_character_sessions(user_hash, char_hash)
            return jsonify({"sessions": sessions})
        except Exception as e:
            return jsonify({"error": str(e)}), 401
            
    @blueprint.route('/sessions/<char_hash>/<session_id>', methods=['GET'])
    def get_session(char_hash, session_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            session = plugin.get_session(user_hash, char_hash, session_id)
            if session:
                return jsonify({"session": session})
            return jsonify({"error": "Session not found"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/sessions/<char_hash>', methods=['POST'])
    @blueprint.route('/sessions/<char_hash>/<session_id>', methods=['POST', 'PUT'])
    def save_session(char_hash, session_id=None):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            result = plugin.save_session(user_hash, char_hash, session_id, data)
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/sessions/<char_hash>/<session_id>', methods=['DELETE'])
    def delete_session(char_hash, session_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            success = plugin.delete_session(user_hash, char_hash, session_id)
            if success:
                return jsonify({"status": "success"})
            return jsonify({"error": "Session not found"}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 400

from flask import jsonify, request

def register_routes(blueprint, plugin):
    @blueprint.route('/items', methods=['GET'])
    def get_items():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = plugin.core_api.data_manager.load_user_data(
                plugin.CHAT_ITEMS_FILENAME,
                user_hash,
                default_value={"items": []},
                obfuscated=False
            )
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 401

    @blueprint.route('/items', methods=['POST'])
    def save_item():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            item_data = request.json
            
            data = plugin.core_api.data_manager.load_user_data(
                plugin.CHAT_ITEMS_FILENAME,
                user_hash,
                default_value={"items": []},
                obfuscated=False
            )
            
            items = data.get("items", [])
            updated = False
            for idx, item in enumerate(items):
                if item.get("id") == item_data.get("id"):
                    items[idx] = item_data
                    updated = True
                    break
            
            if not updated:
                items.append(item_data)
                
            data["items"] = items
            
            plugin.core_api.data_manager.save_user_data(
                data,
                plugin.CHAT_ITEMS_FILENAME,
                user_hash,
                obfuscated=False
            )
            
            return jsonify({"status": "success", "item": item_data})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    @blueprint.route('/items/<item_id>', methods=['DELETE'])
    def delete_item(item_id):
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = plugin.core_api.data_manager.load_user_data(
                plugin.CHAT_ITEMS_FILENAME,
                user_hash,
                default_value={"items": []},
                obfuscated=False
            )
            data["items"] = [i for i in data.get("items", []) if i.get("id") != item_id]
            plugin.core_api.data_manager.save_user_data(
                data,
                plugin.CHAT_ITEMS_FILENAME,
                user_hash,
                obfuscated=False
            )
            return jsonify({"status": "success"})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

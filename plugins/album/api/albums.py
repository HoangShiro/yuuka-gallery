from flask import jsonify, request, abort

def register_routes(blueprint, plugin):
    @blueprint.route('/characters_with_albums', methods=['GET'])
    def get_album_characters():
        """
        Yuuka: API này giờ chỉ trả về danh sách các character hash có ít nhất 1 ảnh.
        """
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        all_user_images = plugin.core_api.read_data("img_data.json", obfuscated=True)
        user_albums = all_user_images.get(user_hash, {})
        # Trả về danh sách các key (character_hash) nếu chúng có chứa ảnh
        return jsonify([char_hash for char_hash, images in user_albums.items() if images])

    @blueprint.route('/albums', methods=['GET'])
    def list_albums():
        user_hash = plugin.core_api.verify_token_and_get_user_hash()
        albums = plugin._build_album_list_response(user_hash)
        return jsonify(albums)



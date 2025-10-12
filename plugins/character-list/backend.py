#--- MODIFIED FILE: plugins/character-list/backend.py ---
from flask import Blueprint, jsonify, request

class CharacterListPlugin:
    """
    Backend cho plugin Character List.
    Xử lý việc lưu và tải danh sách Favourite/Blacklist của người dùng.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('character-list', __name__)
        
        @self.blueprint.route('/lists', methods=['GET', 'POST'])
        def handle_user_lists():
            try:
                user_hash = self.core_api.verify_token_and_get_user_hash()
            except Exception as e:
                return jsonify({"error": str(e)}), 401
            
            filename = "core_lists.json"

            if request.method == 'GET':
                default_lists = {"favourites": [], "blacklist": []}
                # Yuuka: Sửa lại để dùng hàm load_user_data mới và bật mã hóa
                lists = self.core_api.data_manager.load_user_data(
                    filename, 
                    user_hash, 
                    default_value=default_lists, 
                    obfuscated=True
                )
                return jsonify(lists)

            if request.method == 'POST':
                data = request.json
                if 'favourites' in data and 'blacklist' in data:
                    # Yuuka: Sửa lại để dùng hàm save_user_data mới và bật mã hóa
                    self.core_api.data_manager.save_user_data(
                        data, 
                        filename, 
                        user_hash,
                        obfuscated=True
                    )
                    return jsonify({"status": "success", "message": "Lists updated."})
                return jsonify({"error": "Invalid data format"}), 400
        
        # Yuuka: auth rework v1.1 - Route để thêm token vào whitelist
        @self.blueprint.route('/whitelist/add', methods=['POST'])
        def add_to_whitelist():
            try:
                # Chỉ user đã được xác thực (tức là đã trong whitelist) mới có quyền này
                self.core_api.verify_token_and_get_user_hash()
                
                data = request.json
                token_to_add = data.get('token')
                if not token_to_add:
                    return jsonify({"error": "Missing 'token' in request body."}), 400
                
                # Logic xử lý được chuyển vào CoreAPI để tập trung quản lý
                success, message = self.core_api.add_token_to_whitelist(token_to_add)
                
                if success:
                    return jsonify({"status": "success", "message": message})
                else:
                    return jsonify({"status": "noop", "message": message})
                    
            except Exception as e:
                return jsonify({"error": str(e)}), 401


        print("[Plugin:CharacterList] Backend initialized with API routes.")

    def get_blueprint(self):
        """
        Cung cấp blueprint và prefix cho PluginManager.
        """
        return self.blueprint, "/api/plugin/character-list"
from flask import Blueprint, jsonify

class SettingsPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('settings', __name__)
        
        # Có thể thêm các endpoint lưu settings tập trung tại đây nếu cần
        
        print("[Plugin:Settings] Backend initialized.")

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/settings"

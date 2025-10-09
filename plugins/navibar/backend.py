# --- NEW FILE: plugins/navibar/backend.py ---
from flask import Blueprint

class NavibarPlugin:
    """
    Backend cho plugin Navibar.
    Không có logic đặc biệt, chỉ cần tồn tại để được PluginManager tải lên.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        print("[Plugin:Navibar] Backend initialized (placeholder).")

    def get_blueprint(self):
        """
        Plugin này không cần route API riêng.
        """
        return None, None
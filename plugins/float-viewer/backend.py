# --- MODIFIED FILE: plugins/float-viewer/backend.py ---
import time
from flask import Blueprint, jsonify

class FloatViewerPlugin:
    """
    Backend cho plugin Float Viewer.
    Plugin này không còn cần endpoint riêng vì dữ liệu ảnh đã được
    Lõi cung cấp qua API chung (/api/core/images).
    Nó chỉ tồn tại để tuân thủ kiến trúc plugin của Yuuka-Web.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('float_viewer', __name__)
        print("[Plugin:FloatViewer] Backend loaded (no-op).")

    def get_blueprint(self):
        """
        Cung cấp blueprint và prefix cho PluginManager.
        """
        return None, None
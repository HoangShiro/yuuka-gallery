# --- NEW FILE: plugins/simple-viewer/backend.py ---

class SimpleViewerPlugin:
    """
    Backend cho plugin Simple Viewer.
    Plugin này hoàn toàn là frontend, nên backend không thực hiện hành động gì.
    Nó chỉ tồn tại để tuân thủ kiến trúc plugin của Yuuka-Web.
    """
    def __init__(self, core_api):
        """
        Khởi tạo plugin.
        
        Args:
            core_api: Đối tượng CoreAPI để tương tác với Lõi.
        """
        self.core_api = core_api
        print("[Plugin:SimpleViewer] Backend loaded (no-op).")

    def get_blueprint(self):
        """
        Plugin này không có route API riêng, nên không cần Blueprint.
        
        Returns:
            Tuple: (None, None)
        """
        return None, None
# --- NEW FILE: plugins/flip-card/backend.py ---
class FlipCardPlugin:
    """
    Backend cho plugin Flip Card Minigame.
    Không cần logic phức tạp, chỉ cần tồn tại để được PluginManager tải lên.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        print("[Plugin:FlipCard] Backend initialized.")

    def get_blueprint(self):
        """
        Plugin này không cần route API riêng.
        """
        return None, None
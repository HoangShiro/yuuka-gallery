# --- NEW FILE: plugins/auth/backend.py ---
class AuthPlugin:
    """Backend placeholder for Auth plugin (may provide routes later)."""
    def __init__(self, core_api):
        self.core_api = core_api
        print("[Plugin:Auth] Backend initialized.")

    def get_blueprint(self):
        return None, None

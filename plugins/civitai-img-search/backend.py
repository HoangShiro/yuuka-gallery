from flask import Blueprint, jsonify


class CivitaiImgSearchPlugin:
    """
    Minimal backend for the Civitai Image Search plugin.

    Currently the plugin runs fully on the frontend using Civitai public API.
    This backend exists to fit the plugin architecture and for future expansion
    (e.g., caching, proxying, or authenticated operations).
    """

    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint("civitai_img_search", __name__)

        @self.blueprint.route("/health", methods=["GET"])
        def health():
            # Ensure authenticated user to keep consistent with other endpoints
            try:
                self.core_api.verify_token_and_get_user_hash()
            except Exception as exc:  # noqa: BLE001
                return jsonify({"ok": False, "error": str(exc)}), 401
            return jsonify({"ok": True})

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/civitai-img-search"

    def register_services(self):
        return None

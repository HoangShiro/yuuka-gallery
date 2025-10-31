from . import routes, services


class ChatPlugin:
    """
    Entry point for the Character Chat plugin backend.
    """

    def __init__(self, core_api):
        self.core_api = core_api
        self.orchestrator = services.ChatOrchestrator(core_api)
        self.blueprint = routes.create_blueprint(self)
        print("[Plugin:Chat] Backend initialized.")

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/chat"

    def register_services(self):
        """
        Allow other plugins to acquire orchestrator services in the future.
        """
        if not hasattr(self.core_api, "services"):
            self.core_api.services = {}
        self.core_api.services["chat"] = {
            "orchestrator": self.orchestrator,
        }

    def shutdown(self):
        print("[Plugin:Chat] Shutdown requested.")

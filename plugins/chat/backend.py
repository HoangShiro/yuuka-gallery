from flask import Blueprint

from .services.persona import ChatPersonaMixin
from .services.session import ChatSessionMixin
from .services.scenario import ChatScenarioMixin
from .services.group_session import GroupChatSessionMixin
from .api import personas, sessions, generate, emotion, action, items, scenario, scripting, group_sessions, group_generate

class ChatPlugin(
    ChatPersonaMixin,
    ChatSessionMixin,
    ChatScenarioMixin,
    GroupChatSessionMixin
):
    """
    Backend cho plugin Chat.
    Hỗ trợ multiple personas (characters và users) và chat sessions.
    """
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('chat', __name__)
        
        # Data files
        self.CHAT_PERSONAS_FILENAME = "chat_personas.json"
        self.CHAT_ITEMS_FILENAME = "chat_items.json"
        self.CHAT_SCENARIOS_FILENAME = "chat_scenarios.json"
        
        self.register_routes()
        print("[Plugin:Chat] Backend initialized with modular API routes.")

    def register_routes(self):
        personas.register_routes(self.blueprint, self)
        sessions.register_routes(self.blueprint, self)
        generate.register_routes(self.blueprint, self)
        emotion.register_routes(self.blueprint, self)
        action.register_routes(self.blueprint, self)
        items.register_routes(self.blueprint, self)
        scenario.register_routes(self.blueprint, self)
        scripting.register_routes(self.blueprint, self)
        group_sessions.register_routes(self.blueprint, self)
        group_generate.register_routes(self.blueprint, self)

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/chat"

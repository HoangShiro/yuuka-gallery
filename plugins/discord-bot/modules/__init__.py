from .base import BotModule
from .access import AccessModule
from .brain import BrainModule
from .channel import ChannelModule
from .chat import ChatModule
from .echo import EchoModule
from .message import MessageModule
from .ping import PingModule
from .voice import VoiceModule

AVAILABLE_MODULES = {
    PingModule.module_id: PingModule(),
    EchoModule.module_id: EchoModule(),
    AccessModule.module_id: AccessModule(),
    ChatModule.module_id: ChatModule(),
    MessageModule.module_id: MessageModule(),
    ChannelModule.module_id: ChannelModule(),
    VoiceModule.module_id: VoiceModule(),
    BrainModule.module_id: BrainModule(),
}

DEFAULT_MODULE_IDS = (PingModule.module_id,)

__all__ = [
    "BotModule",
    "AVAILABLE_MODULES",
    "DEFAULT_MODULE_IDS",
    "AccessModule",
    "PingModule",
    "EchoModule",
    "ChatModule",
    "MessageModule",
    "ChannelModule",
    "VoiceModule",
    "BrainModule",
]

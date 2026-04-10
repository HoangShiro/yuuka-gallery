from .base import BotModule
from .access import AccessModule
from .brain import BrainModule
from .channel import ChannelModule
from .chat import ChatModule
from .message import MessageModule
from .tts import TTSModule
from .voice import VoiceModule
from .play_music import PlayMusicModule
from .rag import RAGModule
from .image_gen import ImageGenModule

AVAILABLE_MODULES = {
    AccessModule.module_id: AccessModule(),
    ChatModule.module_id: ChatModule(),
    MessageModule.module_id: MessageModule(),
    ChannelModule.module_id: ChannelModule(),
    TTSModule.module_id: TTSModule(),
    VoiceModule.module_id: VoiceModule(),
    BrainModule.module_id: BrainModule(),
    PlayMusicModule.module_id: PlayMusicModule(),
    RAGModule.module_id: RAGModule(),
    ImageGenModule.module_id: ImageGenModule(),
}

DEFAULT_MODULE_IDS = ()

__all__ = [
    "BotModule",
    "AVAILABLE_MODULES",
    "DEFAULT_MODULE_IDS",
    "AccessModule",
    "ChatModule",
    "MessageModule",
    "ChannelModule",
    "TTSModule",
    "VoiceModule",
    "BrainModule",
    "PlayMusicModule",
    "RAGModule",
    "ImageGenModule",
]

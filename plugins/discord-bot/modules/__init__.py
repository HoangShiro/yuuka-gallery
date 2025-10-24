from .base import BotModule
from .echo import EchoModule
from .ping import PingModule

AVAILABLE_MODULES = {
    PingModule.module_id: PingModule(),
    EchoModule.module_id: EchoModule(),
}

DEFAULT_MODULE_IDS = (PingModule.module_id,)

__all__ = ["BotModule", "AVAILABLE_MODULES", "DEFAULT_MODULE_IDS", "PingModule", "EchoModule"]

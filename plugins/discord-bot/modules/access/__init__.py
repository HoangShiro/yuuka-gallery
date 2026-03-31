from __future__ import annotations

from modules.base import BotModule


class AccessModule(BotModule):
    module_id = "core.access"
    name = "Access Control"
    description = "Manage grouped bot policies registered by modules, including default toggles and per-bot overrides."
    module_type = "core"

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Central policy manager for grouped module permissions. Each enabled module can register policy toggles with defaults and optional settings such as allowed channel IDs.",
            "renderer": "policy-manager",
            "sections": [
                {
                    "title": "How it works",
                    "items": [
                        {"label": "Grouping", "value": "Policies are shown by functional group (chat, voice, moderation, etc.)."},
                        {"label": "Ownership", "value": "Each policy card shows which module registered it."},
                        {"label": "Defaults", "value": "Default toggle state is defined by the registering module."},
                    ],
                },
                {
                    "title": "Usage",
                    "text": "Open this module page after selecting modules for a bot, then toggle policies or edit supported settings such as comma-separated allowed channel IDs.",
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.access runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["AccessModule"]

from __future__ import annotations

from modules.base import BotModule


class BrainModule(BotModule):
    module_id = "core.brain"
    name = "Brain"
    description = "Coordinates app commands, message triggers, and lightweight Discord context before calling the chat bridge."
    module_type = "core"

    def get_dashboard_ui(self) -> dict:
        return {
            "renderer": "brain-abilities",
            "summary": "Acts as the orchestration layer that builds compact Discord context, hybrid memo state, and asks the configured chat bridge for replies.",
            "sections": [
                {
                    "title": "Commands",
                    "items": [
                        {"label": "Ask", "value": "/brain-ask or !ask <message>"},
                        {"label": "Summarize channel", "value": "/brain-summarize-channel"},
                        {"label": "Reply mode", "value": "/brain-decide-reply-mode"},
                    ],
                },
                {
                    "title": "Context",
                    "text": "Uses hybrid memo storage, selected facts, and module-registered abilities to build LLM-ready context.",
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.brain runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["BrainModule"]

from __future__ import annotations

from modules.base import BotModule


class MessageModule(BotModule):
    module_id = "core.message"
    name = "Message Tools"
    description = "Send and manage plain text, embed, and managed bot messages via Discord app commands."

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Provides slash commands for sending text, editing/deleting the bot's last managed message, and posting simple embeds.",
            "sections": [
                {
                    "title": "Commands",
                    "items": [
                        {"label": "Send text", "value": "/message-send"},
                        {"label": "Edit last", "value": "/message-edit-last"},
                        {"label": "Delete last", "value": "/message-delete-last"},
                        {"label": "Embed", "value": "/message-embed"},
                    ],
                },
                {
                    "title": "Notes",
                    "text": "This module is executed by the JS runtime and keeps lightweight managed-message state per channel.",
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.message runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["MessageModule"]

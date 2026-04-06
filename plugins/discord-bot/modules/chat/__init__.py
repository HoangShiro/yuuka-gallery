from __future__ import annotations

from modules.base import BotModule


class ChatModule(BotModule):
    module_id = "core.chat"
    name = "Character"
    description = "Routes Discord messages to Chat plugin session-based LLM replies."

    def get_policy_definitions(self) -> list[dict]:
        return [
            {
                "policy_id": "core.chat.natural_chat",
                "group_id": "chat",
                "group_name": "Chat",
                "title": "Natural chat in allowed channels",
                "description": "Allow the bot to reply naturally to normal messages in configured channels without requiring a slash command.",
                "default_enabled": False,
                "settings": {
                    "allowed_channel_ids": "",
                },
            },
            {
                "policy_id": "core.chat.message_commands",
                "group_id": "chat",
                "group_name": "Chat",
                "title": "Message chat commands",
                "description": "Allow message-based chat commands such as !chat and !chat-reset.",
                "default_enabled": True,
            },
            {
                "policy_id": "core.chat.app_command_reset",
                "group_id": "chat",
                "group_name": "Chat",
                "title": "App command reset",
                "description": "Allow utility reset through /chat-reset while keeping natural chat separate from app commands.",
                "default_enabled": True,
            },
        ]

    def get_dashboard_ui(self) -> dict:
        return {
            "renderer": "character-picker",
            "summary": "Bridged Discord messages to Chat plugin character persona.",
            "sections": [
                {
                    "title": "Required config",
                    "items": [
                        {"label": "Bridge URL", "value": "chat_bridge_url (optional)"},
                        {"label": "Bridge key", "value": "chat_bridge_key or CHAT_BRIDGE_KEY env"},
                        {"label": "Secondary language output", "value": "Send secondary translation as a second plain-text line in Discord channel"},
                    ],
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Dùng character bridge để trả lời theo persona và ngữ cảnh Discord.",
                "Có thể reset session chat hoặc xóa actor summary theo yêu cầu.",
            ],
            "tools": [
                {
                    "tool_id": "chat_reset_session",
                    "title": "Reset chat session",
                    "description": "Reset session chat theo ngữ cảnh channel/guild.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "chat_reset_actor_fact",
                    "title": "Reset actor facts",
                    "description": "Xóa summary/facts của actor khỏi bộ nhớ.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.chat runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["ChatModule"]

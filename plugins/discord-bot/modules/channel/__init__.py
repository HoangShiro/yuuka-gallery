from __future__ import annotations

from modules.base import BotModule


class ChannelModule(BotModule):
    module_id = "core.channel"
    name = "Channel Tools"
    description = "Create and manage Discord channels through guarded app commands."

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Adds slash commands for creating text channels and performing simple channel management operations with Discord permission checks.",
            "sections": [
                {
                    "title": "Commands",
                    "items": [
                        {"label": "Create text", "value": "/create-text"},
                        {"label": "Rename current", "value": "/rename-channel"},
                        {"label": "Lock current", "value": "/lock-channel"},
                        {"label": "Unlock current", "value": "/unlock-channel"},
                    ],
                },
                {
                    "title": "Permissions",
                    "text": "All actions require Discord Manage Channels permission and are enforced in the JS runtime before execution.",
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Quản lý text channel trong guild khi có quyền Manage Channels.",
            ],
            "tools": [
                {
                    "tool_id": "channel_create_text",
                    "title": "Create text channel",
                    "description": "Tạo text channel mới trong guild.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "channel_manage",
                    "title": "Rename/lock/unlock channel",
                    "description": "Đổi tên, khóa hoặc mở khóa channel hiện tại.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.channel runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["ChannelModule"]

from __future__ import annotations

from modules.base import BotModule


class VoiceModule(BotModule):
    module_id = "core.voice"
    name = "Voice Tools"
    description = "Tracks voice context and exposes MVP voice app commands for join/leave/status/speak workflows."

    def get_policy_definitions(self) -> list[dict]:
        return [
            {
                "policy_id": "core.voice.app_commands",
                "group_id": "voice",
                "group_name": "Voice",
                "title": "Voice app commands",
                "description": "Allow voice-related utility app commands such as join, leave, status, and speak placeholders.",
                "default_enabled": True,
            },
            {
                "policy_id": "core.voice.allowed_channels",
                "group_id": "voice",
                "group_name": "Voice",
                "title": "Allowed voice channels",
                "description": "Restrict voice workflows to selected voice channel IDs. Leave empty to allow any voice channel when the module policy is enabled.",
                "default_enabled": False,
                "settings": {
                    "allowed_channel_ids": "",
                },
            },
        ]

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": "Provides MVP voice controls focused on voice context tracking and future TTS/recording integration without adding heavy runtime complexity yet.",
            "sections": [
                {
                    "title": "Commands",
                    "items": [
                        {"label": "Join voice context", "value": "/join-voice"},
                        {"label": "Leave voice context", "value": "/leave-voice"},
                        {"label": "Voice status", "value": "/voice-status"},
                        {"label": "Speak placeholder", "value": "/voice-speak"},
                    ],
                },
                {
                    "title": "MVP scope",
                    "text": "Current implementation tracks voice facts and queued speak requests; direct audio playback/recording remains a later controlled phase.",
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.voice runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["VoiceModule"]

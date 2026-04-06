from __future__ import annotations

from modules.base import BotModule


class VoiceModule(BotModule):
    module_id = "core.voice"
    name = "Voice Tools"
    description = "Dual-channel voice engine (music + speak) with PCM mixing, auto-ducking, queue, pause/resume, skip, stop."

    def get_policy_definitions(self) -> list[dict]:
        return [
            {
                "policy_id": "core.voice.app_commands",
                "group_id": "voice",
                "group_name": "Voice",
                "title": "Voice app commands",
                "description": "Allow voice slash commands (join, leave, status, pause, resume, skip, stop).",
                "default_enabled": True,
            },
            {
                "policy_id": "core.voice.allowed_channels",
                "group_id": "voice",
                "group_name": "Voice",
                "title": "Allowed voice channels",
                "description": "Restrict to specific voice channel IDs. Empty = allow all.",
                "default_enabled": False,
                "settings": {
                    "allowed_channel_ids": "",
                },
            },
            {
                "policy_id": "core.voice.volumes",
                "group_id": "voice",
                "group_name": "Voice",
                "title": "Channel Volumes",
                "description": "Set base volume levels for channels (0-100%). Duck ratio automatically calculates relative to music_volume.",
                "default_enabled": True,
                "settings": {
                    "music_volume": 50,
                    "speak_volume": 100,
                },
            },
        ]

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": (
                "Dual-channel playback engine: Music and Speak run in parallel with PCM mixing. "
                "When Speak plays, Music auto-ducks volume (configurable). "
                "Any module can request playback via the event bus."
            ),
            "sections": [
                {
                    "title": "Slash Commands",
                    "items": [
                        {"label": "Join voice channel", "value": "/join-voice"},
                        {"label": "Leave voice channel", "value": "/leave-voice"},
                        {"label": "Voice & player status", "value": "/voice-status"},
                        {"label": "Pause (music|speak)", "value": "/voice-pause [channel]"},
                        {"label": "Resume (music|speak)", "value": "/voice-resume [channel]"},
                        {"label": "Skip (music|speak)", "value": "/voice-skip [channel]"},
                        {"label": "Stop (music|speak|all)", "value": "/voice-stop [channel]"},
                        {"label": "TTS placeholder", "value": "/voice-speak <text>"},
                    ],
                },
                {
                    "title": "Dual-Channel Architecture",
                    "text": (
                        "Two parallel audio channels mixed via PCM at 48kHz stereo:\n\n"
                        "• Music — For music, soundboard, sound effects\n"
                        "• Speak — For voice, TTS, announcements\n\n"
                        "When Speak plays, Music volume auto-ducks to 20% (default). "
                        "Set noDuck: true in metadata to disable ducking for a specific item."
                    ),
                },
                {
                    "title": "Event Bus API",
                    "text": (
                        "Request events (include channel: 'music'|'speak'):\n"
                        "• voice.play_requested — Enqueue audio (+ source, channel, noDuck?, metadata?)\n"
                        "• voice.pause_requested / voice.resume_requested\n"
                        "• voice.skip_requested / voice.stop_requested (channel: 'all' supported)\n"
                        "• voice.remove_requested — Remove item from queue\n"
                        "• voice.status_requested — Query status\n"
                        "• voice.set_duck_ratio — Set duck volume ratio (0-1)\n\n"
                        "Emitted events (include channel: 'music'|'speak'):\n"
                        "• voice.track_start / voice.track_end / voice.track_error\n"
                        "• voice.track_enqueued / voice.channel_empty"
                    ),
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Điều khiển voice queue theo 2 kênh music/speak.",
            ],
            "tools": [
                {
                    "tool_id": "voice_join",
                    "title": "Join voice channel",
                    "description": "Kết nối bot vào voice channel.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "voice_play",
                    "title": "Queue audio",
                    "description": "Đưa audio vào hàng chờ music hoặc speak.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "voice_control",
                    "title": "Control queue",
                    "description": "Pause/resume/skip/stop/leave voice channel.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "voice_set_volume",
                    "title": "Set volume",
                    "description": "Điều chỉnh âm lượng (0-100) của kênh music hoặc speak.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.voice runs in JS runtime (dual-channel PCM mixer).")


__all__ = ["VoiceModule"]

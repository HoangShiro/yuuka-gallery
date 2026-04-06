from __future__ import annotations

from modules.base import BotModule


class TTSModule(BotModule):
    module_id = "core.tts"
    name = "Text To Speech"
    description = "Streams sanitized reply sentences to a selectable TTS engine and dispatches audio to the Discord voice speak channel."

    def get_dashboard_ui(self) -> dict:
        return {
            "renderer": "tts-engine-picker",
            "summary": (
                "Converts chat replies into incremental speech for the voice speak channel. "
                "Supports multiple engines via API integration, starting with AivisSpeech."
            ),
            "sections": [
                {
                    "title": "Playback conditions",
                    "items": [
                        {"label": "Module enabled", "value": "Required"},
                        {"label": "Bot joined voice channel", "value": "Required"},
                        {"label": "Target user in same voice channel", "value": "Required"},
                    ],
                },
                {
                    "title": "Pipeline",
                    "text": (
                        "The TTS module receives sentence-sized reply segments from the chat pipeline, "
                        "sanitizes them, sends them to the selected engine, and enqueues the returned audio "
                        "to the voice module using the speak channel."
                    ),
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Có thể đọc phản hồi ra voice channel bằng TTS khi bot và người dùng đang ở cùng voice channel.",
            ],
            "tools": [
                {
                    "tool_id": "tts_speak",
                    "title": "Speak text in voice channel",
                    "description": "Tạo audio TTS và đưa vào speak channel của voice module.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.tts runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["TTSModule"]

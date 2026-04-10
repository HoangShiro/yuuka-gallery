from __future__ import annotations

from modules.base import BotModule

class PlayMusicModule(BotModule):
    module_id = "core.play-music"
    name = "Play Music"
    description = "Search, stream, and cache music from YouTube and 1000+ sources via yt-dlp."

    def get_policy_definitions(self) -> list[dict]:
        return [
            {
                "policy_id": "core.play_music.app_commands",
                "group_id": "music",
                "group_name": "Music Player",
                "title": "Music commands",
                "description": "Allow /play, /play-search, /play-queue etc.",
                "default_enabled": True,
            },
            {
                "policy_id": "core.play_music.cache",
                "group_id": "music",
                "group_name": "Music Player",
                "title": "Music cache settings",
                "description": "Configure local storage cache for downloaded music.",
                "default_enabled": True,
                "settings": {
                    "max_size_gb": 1,
                },
            },
            {
                "policy_id": "core.play_music.ytdlp",
                "group_id": "music",
                "group_name": "Music Player",
                "title": "yt-dlp settings",
                "description": "Configure yt-dlp options like SponsorBlock and cookies for age-restricted content.",
                "default_enabled": True,
                "settings": {
                    "sponsorblock_enabled": True,
                    "sponsorblock_categories": "sponsor,selfpromo,intro,outro,interaction",
                    "cookies_file": "",
                    "cookies_from_browser": "",
                },
            },
        ]

    def get_dashboard_ui(self) -> dict:
        return {
            "summary": (
                "Search, stream and play music from YouTube and other sources using yt-dlp. "
                "Caches tracks locally up to 1GB to save bandwidth on replays. "
                "Integrated with the dual-channel Voice Engine."
            ),
            "sections": [
                {
                    "title": "Slash Commands",
                    "items": [
                        {"label": "Play song", "value": "/play <query or url>"},
                        {"label": "Search music", "value": "/play-search <query>"},
                        {"label": "View queue", "value": "/play-queue"},
                        {"label": "Now playing", "value": "/play-now"},
                        {"label": "View cache stats", "value": "/play-cache"},
                        {"label": "Clear all cache", "value": "/play-cache-clear"},
                    ],
                },
                {
                    "title": "Requirements",
                    "text": (
                        "yt-dlp binary must be available in your system's PATH. "
                        "The module will attempt to use it to resolve tracks and download audio."
                    ),
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Sử dụng các công cụ âm nhạc khi người dùng muốn mở nhạc, tìm bài hát, hoặc xem danh sách hàng đợi (queue, now playing). Ví dụ: 'Mở bài nhạc chill lofi'",
            ],
            "tools": [
                {
                    "tool_id": "music_play",
                    "title": "Play or search music",
                    "description": "Đưa một bài hát từ text/url vào hàng đợi.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "music_queue",
                    "title": "View music queue",
                    "description": "Xem danh sách các bài hát trong hàng chờ.",
                    "default_enabled": True,
                },
                {
                    "tool_id": "music_now_playing",
                    "title": "View currently playing track",
                    "description": "Xem bài hát nào đang được phát.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.play-music runs in JS runtime via yt-dlp.")

__all__ = ["PlayMusicModule"]

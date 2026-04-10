from __future__ import annotations

from modules.base import BotModule


class ImageGenModule(BotModule):
    module_id = "core.image-gen"
    name = "Image Generation"
    description = "Generate images through the core ComfyUI pipeline while tracking queue and progress from the backend."

    def get_dashboard_ui(self) -> dict:
        return {
            "renderer": "image-gen-config",
            "summary": "Configure default ComfyUI image generation settings and expose the /img command inside Discord.",
            "sections": [
                {
                    "title": "Slash commands",
                    "items": [
                        {"label": "Generate image", "value": "/img"},
                        {"label": "Cancel current image task", "value": "/img-cancel"},
                        {"label": "Brain tool", "value": "image_generate"},
                    ],
                },
                {
                    "title": "Execution model",
                    "text": (
                        "This module delegates prompt execution to the core app generation service, "
                        "so queue position and progress come from the real ComfyUI backend state instead of local estimation."
                    ),
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Use the image generation tool when the user asks to create or render an image. Fill `prompt` with concise comma-separated booru-style tags only. Example: '1girl, silver hair, smile, school uniform, rooftop, sunset, masterpiece, best quality'. Leave `size` empty to use the configured default size. If the user explicitly asks for a framing, set `size` to portrait, landscape, square, or wide.",
            ],
            "tools": [
                {
                    "tool_id": "image_generate",
                    "title": "Generate image",
                    "description": "Queue an image generation job with only a booru-style prompt and an optional natural-language size preset. Example: 'Generate an image with prompt 1girl, blue hair, cafe, warm lighting, masterpiece, best quality' and optionally set size to portrait, landscape, square, or wide.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.image-gen runs in JS runtime and calls the core app generation service.")


__all__ = ["ImageGenModule"]

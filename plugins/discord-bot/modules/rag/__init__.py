from __future__ import annotations

from modules.base import BotModule


class RAGModule(BotModule):
    module_id = "core.rag"
    name = "RAG Search"
    description = "Provides Tavily-powered web retrieval for Brain tool calls and /search slash command."

    def get_dashboard_ui(self) -> dict:
        return {
            "renderer": "rag-search-config",
            "summary": "Configure Tavily API key and default retrieval depth for web search.",
            "sections": [
                {
                    "title": "Features",
                    "items": [
                        {"label": "Slash command", "value": "/search query:<text>"},
                        {"label": "Brain tool", "value": "rag_search_web"},
                        {"label": "Provider", "value": "Tavily Search API"},
                    ],
                },
                {
                    "title": "Configuration",
                    "items": [
                        {"label": "API key", "value": "tavily_api_key (set in this module UI)"},
                        {"label": "Default max results", "value": "tavily_max_results (1-10)"},
                    ],
                },
            ],
        }

    def get_brain_capabilities(self) -> dict:
        return {
            "instructions": [
                "Use the Tavily web search tool when the user asks for up-to-date facts, references, or external verification. Example: 'Find the latest news about Unreal Engine 5.6'.",
            ],
            "tools": [
                {
                    "tool_id": "rag_search_web",
                    "title": "Search web with Tavily",
                    "description": "Search the web and return concise cited snippets. Example: 'Search for official docs on Discord slash commands'.",
                    "default_enabled": True,
                },
            ],
        }

    def setup(self, bot, log) -> None:
        log.add("info", "core.rag runs in JS runtime and does not register Python discord.py handlers.")


__all__ = ["RAGModule"]

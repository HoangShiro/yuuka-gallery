"""Compatibility shim.

Implementation moved to `services/lora.py`.
"""

try:
    from .services.lora import AlbumLoraMixin
except ImportError:  # pragma: no cover
    from services.lora import AlbumLoraMixin


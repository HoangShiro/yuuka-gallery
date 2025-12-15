"""Compatibility shim.

Implementation moved to `services/external_presets.py`.
"""

try:
    from .services.external_presets import AlbumExternalPresetsMixin
except ImportError:  # pragma: no cover
    from services.external_presets import AlbumExternalPresetsMixin


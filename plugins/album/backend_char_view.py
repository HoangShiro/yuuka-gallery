"""Compatibility shim.

Historically the Album backend mixins lived at plugin root (e.g. backend_char_view.py).
The plugin loader imports the plugin as a package, so absolute imports like
`import backend_char_view` can break. The actual implementation now lives in
`services/char_view.py`.
"""

try:
    # Package import style (expected when PluginManager loads plugins)
    from .services.char_view import AlbumCharacterViewMixin
except ImportError:  # pragma: no cover
    # Fallback for environments that put the plugin folder directly on sys.path
    from services.char_view import AlbumCharacterViewMixin


# --- MODIFIED FILE: core/plugin_manager.py ---
import os
import json
import importlib
import sys

from .core_api import CoreAPI

class Plugin:
    def __init__(self, path, metadata, backend_instance):
        self.path = path
        self.metadata = metadata
        self.backend = backend_instance
        self.id = metadata.get('id', os.path.basename(path))

class PluginManager:
    def __init__(self, plugins_dir, app, data_manager):
        self.plugins_dir = plugins_dir
        self.app = app
        self.data_manager = data_manager
        self.core_api = CoreAPI(data_manager)
        self._plugins = {}

    def load_plugins(self):
        print("[PluginManager] Bắt đầu quét và tải plugins...")
        os.makedirs(self.plugins_dir, exist_ok=True)
        for entry in os.scandir(self.plugins_dir):
            if entry.is_dir():
                self._load_plugin_from_path(entry.path)

    def _load_plugin_from_path(self, path):
        plugin_id = os.path.basename(path)
        manifest_path = os.path.join(path, 'plugin.json')
        if not os.path.exists(manifest_path):
            return

        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            backend_entry = metadata.get('entry_points', {}).get('backend')
            if not backend_entry:
                raise ValueError("Plugin manifest is missing backend entry point.")
            
            module_name, class_name = backend_entry.split(':')
            full_module_path = f"plugins.{plugin_id}.{module_name}"
            
            module_spec = importlib.util.spec_from_file_location(
                full_module_path, 
                os.path.join(path, f"{module_name}.py")
            )
            if not module_spec or not module_spec.loader:
                raise ImportError(f"Unable to load module spec for '{full_module_path}'.")

            module = importlib.util.module_from_spec(module_spec)
            sys.modules[full_module_path] = module
            module_spec.loader.exec_module(module)
            
            plugin_class = getattr(module, class_name)
            backend_instance = plugin_class(self.core_api)

            if hasattr(backend_instance, 'register_services') and callable(getattr(backend_instance, 'register_services')):
                backend_instance.register_services()
            
            if hasattr(backend_instance, 'get_blueprint'):
                blueprint, url_prefix = backend_instance.get_blueprint()
                if blueprint:
                    self.app.register_blueprint(blueprint, url_prefix=url_prefix)
            
            self._plugins[plugin_id] = Plugin(path, metadata, backend_instance)
            print(f"  - Đã tải thành công plugin: '{metadata.get('name', plugin_id)}'")

        except Exception as e:
            if full_module_path in sys.modules:
                del sys.modules[full_module_path]
            print(f"[PluginManager] Error loading plugin '{path}': {e}")
            
    def get_plugin_by_id(self, plugin_id):
        return self._plugins.get(plugin_id)

    def get_active_plugins(self):
        return list(self._plugins.values())

    def get_frontend_assets(self):
        assets = {'js': [], 'css': [], 'js_modules': []}
        for plugin in self._plugins.values():
            if 'assets' in plugin.metadata:
                for js_file in plugin.metadata['assets'].get('js', []):
                    assets['js'].append(f"/plugins/{plugin.id}/static/{js_file}")
                for js_module_file in plugin.metadata['assets'].get('js_modules', []):
                    assets['js_modules'].append(f"/plugins/{plugin.id}/static/{js_module_file}")
                for css_file in plugin.metadata['assets'].get('css', []):
                    assets['css'].append(f"/plugins/{plugin.id}/static/{css_file}")
        return assets

    def get_ui_components(self):
        ui_data = []
        for plugin in sorted(self._plugins.values(), key=lambda p: p.metadata.get('ui', {}).get('order', 99)):
            if 'ui' in plugin.metadata:
                ui_data.append({
                    'id': plugin.id,
                    'name': plugin.metadata.get('name'),
                    'ui': plugin.metadata['ui'],
                    'entry_points': plugin.metadata.get('entry_points', {})
                })
        return ui_data

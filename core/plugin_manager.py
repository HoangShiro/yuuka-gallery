# --- MODIFIED FILE: core/plugin_manager.py ---
import os
import json
import importlib
import sys

from .core_api import CoreAPI

try:
    from colorama import Fore as _Fore, Style as _Style, init as _colorama_init

    _colorama_init()
    COLOR_GREEN = _Fore.GREEN
    COLOR_RED = _Fore.RED
    COLOR_RESET = _Style.RESET_ALL
except ImportError:
    COLOR_GREEN = "\033[92m"
    COLOR_RED = "\033[91m"
    COLOR_RESET = "\033[0m"


class Plugin:
    def __init__(self, path, metadata, backend_instance):
        self.path = path
        self.metadata = metadata
        self.backend = backend_instance
        self.id = metadata.get("id", os.path.basename(path))


class PluginManager:
    def __init__(self, plugins_dir, app, data_manager):
        self.plugins_dir = plugins_dir
        self.app = app
        self.data_manager = data_manager
        self.core_api = CoreAPI(data_manager)
        self._plugins = {}
        self._color_enabled = sys.stdout.isatty() or bool(os.environ.get("FORCE_COLOR"))

    def load_plugins(self):
        print("[PluginManager] Starting plugin discovery and initialization...")
        os.makedirs(self.plugins_dir, exist_ok=True)
        loaded_plugins = []
        failed_plugins = []

        for entry in os.scandir(self.plugins_dir):
            if entry.is_dir():
                result = self._load_plugin_from_path(entry.path)
                if not result:
                    continue
                success, display_name = result
                if success:
                    loaded_plugins.append(display_name)
                else:
                    failed_plugins.append(display_name)

        success_text = ", ".join(loaded_plugins) if loaded_plugins else "None"
        failure_text = ", ".join(failed_plugins) if failed_plugins else "None"
        success_text = self._color_text(success_text, COLOR_GREEN)
        failure_text = self._color_text(failure_text, COLOR_RED)
        print(f"[PluginManager] Loaded successfully: {success_text}")
        print(f"[PluginManager] Failed to load: {failure_text}")

    def _load_plugin_from_path(self, path):
        plugin_id = os.path.basename(path)
        manifest_path = os.path.join(path, "plugin.json")
        if not os.path.exists(manifest_path):
            print(f"[PluginManager] Skipping '{plugin_id}': missing plugin.json.")
            return False, plugin_id

        metadata = {}
        full_module_path = ""

        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

            display_name = metadata.get("name", plugin_id)
            backend_entry = metadata.get("entry_points", {}).get("backend")
            if not backend_entry:
                raise ValueError("Plugin manifest is missing backend entry point.")

            module_name, class_name = backend_entry.split(":")
            full_module_path = f"plugins.{plugin_id}.{module_name}"

            module_spec = importlib.util.spec_from_file_location(
                full_module_path,
                os.path.join(path, f"{module_name}.py"),
            )
            if not module_spec or not module_spec.loader:
                raise ImportError(f"Unable to load module spec for '{full_module_path}'.")

            module = importlib.util.module_from_spec(module_spec)
            sys.modules[full_module_path] = module
            module_spec.loader.exec_module(module)

            plugin_class = getattr(module, class_name)
            backend_instance = plugin_class(self.core_api)

            # Provide plugin with identifying info and task service access
            if not hasattr(backend_instance, "plugin_id"):
                backend_instance.plugin_id = plugin_id
            backend_instance.background_task_service = self.core_api.task_service

            if hasattr(backend_instance, "register_services") and callable(
                getattr(backend_instance, "register_services")
            ):
                backend_instance.register_services()

            if hasattr(backend_instance, "register_background_tasks") and callable(
                getattr(backend_instance, "register_background_tasks")
            ):
                backend_instance.register_background_tasks(self.core_api.task_service)

            if hasattr(backend_instance, "get_blueprint"):
                blueprint, url_prefix = backend_instance.get_blueprint()
                if blueprint:
                    self.app.register_blueprint(blueprint, url_prefix=url_prefix)

            self._plugins[plugin_id] = Plugin(path, metadata, backend_instance)
            #print(f"[PluginManager] Loaded plugin '{display_name}'.")
            return True, display_name

        except Exception as e:
            if full_module_path in sys.modules:
                del sys.modules[full_module_path]
            display_name = metadata.get("name", plugin_id) or plugin_id
            print(f"[PluginManager] Error loading plugin '{plugin_id}': {e}")
            return False, display_name

    def _color_text(self, text, color_code):
        if not text:
            return text
        if not self._color_enabled:
            return text
        return f"{color_code}{text}{COLOR_RESET}"

    def get_plugin_by_id(self, plugin_id):
        return self._plugins.get(plugin_id)

    def get_active_plugins(self):
        return list(self._plugins.values())

    def get_frontend_assets(self):
        assets = {"js": [], "css": [], "js_modules": []}
        for plugin in self._plugins.values():
            if "assets" in plugin.metadata:
                for js_file in plugin.metadata["assets"].get("js", []):
                    assets["js"].append(f"/plugins/{plugin.id}/static/{js_file}")
                for js_module_file in plugin.metadata["assets"].get("js_modules", []):
                    assets["js_modules"].append(f"/plugins/{plugin.id}/static/{js_module_file}")
                for css_file in plugin.metadata["assets"].get("css", []):
                    assets["css"].append(f"/plugins/{plugin.id}/static/{css_file}")
        return assets

    def get_ui_components(self):
        ui_data = []
        for plugin in sorted(
            self._plugins.values(), key=lambda p: p.metadata.get("ui", {}).get("order", 99)
        ):
            if "ui" in plugin.metadata:
                ui_data.append(
                    {
                        "id": plugin.id,
                        "name": plugin.metadata.get("name"),
                        "ui": plugin.metadata["ui"],
                        "entry_points": plugin.metadata.get("entry_points", {}),
                    }
                )
        return ui_data

    def get_background_task_status(self, plugin_id=None):
        return self.core_api.get_background_task_status(plugin_id)

    def shutdown_all(self):
        print("[PluginManager] Shutting down plugins and background tasks...")
        for plugin in self._plugins.values():
            try:
                self.core_api.stop_background_tasks_for_plugin(plugin.id)
            except Exception as task_err:
                print(f"[PluginManager] Warning: failed to stop tasks for '{plugin.id}': {task_err}")

            backend = plugin.backend
            if hasattr(backend, "shutdown") and callable(getattr(backend, "shutdown")):
                try:
                    backend.shutdown()
                except Exception as e:
                    print(f"[PluginManager] Warning: plugin '{plugin.id}' failed during shutdown: {e}")

        # Final sweep in case any background task remains registered without plugin metadata
        try:
            self.core_api.stop_all_background_tasks()
        except Exception as e:
            print(f"[PluginManager] Warning: residual background tasks detected during shutdown: {e}")

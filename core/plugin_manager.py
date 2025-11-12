# --- MODIFIED FILE: core/plugin_manager.py ---
import os
import json
import importlib
import sys
import time
import threading

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
        # Hot-reload bookkeeping
        self.module_name = None  # e.g. "main" from entry_points.backend "main:PluginBackend"
        self.full_module_path = None  # e.g. "plugins.pluginA.main"
        self.blueprint_name = None
        self.url_prefix = None
        self._files_snapshot = {}


class PluginManager:
    def __init__(self, plugins_dir, app, data_manager):
        self.plugins_dir = plugins_dir
        self.app = app
        self.data_manager = data_manager
        self.core_api = CoreAPI(data_manager)
        self._plugins = {}
        self._color_enabled = sys.stdout.isatty() or bool(os.environ.get("FORCE_COLOR"))
        # Hot-reload state
        self._lock = threading.RLock()
        self._watcher_thread = None
        self._watcher_stop_event = None

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

            blueprint_name = None
            url_prefix = None
            if hasattr(backend_instance, "get_blueprint"):
                blueprint, url_prefix = backend_instance.get_blueprint()
                if blueprint:
                    self.app.register_blueprint(blueprint, url_prefix=url_prefix)
                    try:
                        blueprint_name = getattr(blueprint, "name", None)
                    except Exception:
                        blueprint_name = None

            plugin_obj = Plugin(path, metadata, backend_instance)
            plugin_obj.module_name = module_name
            plugin_obj.full_module_path = full_module_path
            plugin_obj.blueprint_name = blueprint_name
            plugin_obj.url_prefix = url_prefix
            plugin_obj._files_snapshot = self._snapshot_plugin_files(path)

            self._plugins[plugin_id] = plugin_obj
            #print(f"[PluginManager] Loaded plugin '{display_name}'.")
            return True, display_name

        except Exception as e:
            if full_module_path in sys.modules:
                del sys.modules[full_module_path]
            display_name = metadata.get("name", plugin_id) or plugin_id
            print(f"[PluginManager] Error loading plugin '{plugin_id}': {e}")
            return False, display_name

    # -------------------- Hot-reload helpers --------------------
    def _snapshot_plugin_files(self, plugin_path):
        snapshot = {}
        try:
            for root, dirs, files in os.walk(plugin_path):
                for fname in files:
                    if not (fname.endswith('.py') or fname == 'plugin.json'):
                        continue
                    fpath = os.path.join(root, fname)
                    rel = os.path.relpath(fpath, plugin_path)
                    try:
                        stat = os.stat(fpath)
                        snapshot[rel.replace('\\', '/')] = (stat.st_mtime, stat.st_size)
                    except OSError:
                        # File may have been removed mid-walk
                        pass
        except Exception:
            pass
        return snapshot

    def _files_changed(self, plugin_obj):
        try:
            current = self._snapshot_plugin_files(plugin_obj.path)
            old = plugin_obj._files_snapshot or {}
            if current.keys() != old.keys():
                return True
            for k, v in current.items():
                if k not in old or old[k] != v:
                    return True
        except Exception:
            return True
        return False

    def _unregister_blueprint(self, blueprint_name):
        if not blueprint_name:
            return
        try:
            app = self.app
            if blueprint_name in app.blueprints:
                # Remove routes associated with the blueprint
                rules_to_remove = [r for r in list(app.url_map.iter_rules()) if r.endpoint.startswith(f"{blueprint_name}.")]
                for rule in rules_to_remove:
                    # Remove from url_map rules
                    try:
                        app.url_map._rules.remove(rule)
                    except ValueError:
                        pass
                    # Remove from rules_by_endpoint
                    lst = app.url_map._rules_by_endpoint.get(rule.endpoint)
                    if lst:
                        try:
                            lst.remove(rule)
                        except ValueError:
                            pass
                        if not lst:
                            app.url_map._rules_by_endpoint.pop(rule.endpoint, None)
                    # Remove view function
                    app.view_functions.pop(rule.endpoint, None)
                # Finally remove the blueprint registry entry
                app.blueprints.pop(blueprint_name, None)
        except Exception as e:
            print(f"[PluginManager] Warning: failed to unregister blueprint '{blueprint_name}': {e}")

    def _unload_plugin(self, plugin_id):
        with self._lock:
            plugin = self._plugins.get(plugin_id)
            if not plugin:
                return False
            print(f"[PluginManager] Unloading plugin '{plugin_id}'...")
            try:
                # Stop background tasks for this plugin
                try:
                    self.core_api.stop_background_tasks_for_plugin(plugin_id)
                except Exception as task_err:
                    print(f"[PluginManager] Warning: failed to stop tasks for '{plugin_id}': {task_err}")

                # Call plugin shutdown hook
                backend = plugin.backend
                if hasattr(backend, "shutdown") and callable(getattr(backend, "shutdown")):
                    try:
                        backend.shutdown()
                    except Exception as e:
                        print(f"[PluginManager] Warning: plugin '{plugin_id}' failed during shutdown: {e}")

                # Unregister blueprint routes
                if plugin.blueprint_name:
                    self._unregister_blueprint(plugin.blueprint_name)

                # Remove loaded modules for this plugin
                try:
                    prefix = f"plugins.{plugin_id}"
                    for m in list(sys.modules.keys()):
                        if m == prefix or m.startswith(prefix + "."):
                            sys.modules.pop(m, None)
                except Exception:
                    pass

                # Remove plugin record
                self._plugins.pop(plugin_id, None)
                return True
            except Exception as e:
                print(f"[PluginManager] Error while unloading plugin '{plugin_id}': {e}")
                return False

    def reload_plugin(self, plugin_id):
        """Reload a plugin in-place. If new code fails to import or initialize, keep the old plugin."""
        with self._lock:
            old_plugin = self._plugins.get(plugin_id)
            plugin_path = os.path.join(self.plugins_dir, plugin_id)
            manifest_path = os.path.join(plugin_path, "plugin.json")
            if not os.path.isdir(plugin_path) or not os.path.exists(manifest_path):
                # Plugin deleted from disk -> unload if present
                if old_plugin:
                    self._unload_plugin(plugin_id)
                    print(f"[PluginManager] Plugin '{plugin_id}' removed from disk and unloaded.")
                    return True
                return False

            # Read manifest and prepare import
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
                backend_entry = metadata.get("entry_points", {}).get("backend")
                if not backend_entry:
                    raise ValueError("Plugin manifest is missing backend entry point.")
                module_name, class_name = backend_entry.split(":")
                module_file = os.path.join(plugin_path, f"{module_name}.py")
                if not os.path.exists(module_file):
                    raise FileNotFoundError(f"Backend module file '{module_name}.py' not found for plugin '{plugin_id}'.")

                temp_mod_name = f"plugins.{plugin_id}.__hotload__{int(time.time())}"
                module_spec = importlib.util.spec_from_file_location(temp_mod_name, module_file)
                if not module_spec or not module_spec.loader:
                    raise ImportError(f"Unable to load module spec for '{temp_mod_name}'.")

                temp_module = importlib.util.module_from_spec(module_spec)
                module_spec.loader.exec_module(temp_module)

                plugin_class = getattr(temp_module, class_name)
                new_backend = plugin_class(self.core_api)

                # Prepare blueprint (do not register yet)
                new_blueprint = None
                new_url_prefix = None
                if hasattr(new_backend, "get_blueprint"):
                    try:
                        new_blueprint, new_url_prefix = new_backend.get_blueprint()
                    except Exception as e:
                        # If blueprint building fails, treat as reload failure
                        raise RuntimeError(f"get_blueprint() failed: {e}")

                # If we get here, import/instantiate succeeded. Proceed to replace.
                print(f"[PluginManager] Reloading plugin '{plugin_id}'...")
                # Fully unload old plugin (tasks, blueprint, modules)
                if old_plugin:
                    self._unload_plugin(plugin_id)

                # Re-import under the canonical module path and initialize like fresh load
                full_module_path = f"plugins.{plugin_id}.{module_name}"
                module_spec2 = importlib.util.spec_from_file_location(full_module_path, module_file)
                module2 = importlib.util.module_from_spec(module_spec2)
                sys.modules[full_module_path] = module2
                module_spec2.loader.exec_module(module2)
                plugin_class2 = getattr(module2, class_name)
                backend_instance = plugin_class2(self.core_api)

                if not hasattr(backend_instance, "plugin_id"):
                    backend_instance.plugin_id = plugin_id
                backend_instance.background_task_service = self.core_api.task_service

                if hasattr(backend_instance, "register_services") and callable(getattr(backend_instance, "register_services")):
                    backend_instance.register_services()

                if hasattr(backend_instance, "register_background_tasks") and callable(getattr(backend_instance, "register_background_tasks")):
                    backend_instance.register_background_tasks(self.core_api.task_service)

                blueprint_name = None
                url_prefix = None
                if hasattr(backend_instance, "get_blueprint"):
                    blueprint, url_prefix = backend_instance.get_blueprint()
                    if blueprint:
                        self.app.register_blueprint(blueprint, url_prefix=url_prefix)
                        try:
                            blueprint_name = getattr(blueprint, "name", None)
                        except Exception:
                            blueprint_name = None

                plugin_obj = Plugin(plugin_path, metadata, backend_instance)
                plugin_obj.module_name = module_name
                plugin_obj.full_module_path = full_module_path
                plugin_obj.blueprint_name = blueprint_name
                plugin_obj.url_prefix = url_prefix
                plugin_obj._files_snapshot = self._snapshot_plugin_files(plugin_path)
                self._plugins[plugin_id] = plugin_obj

                print(self._color_text(f"[PluginManager] Reloaded '{metadata.get('name', plugin_id)}' successfully.", COLOR_GREEN))
                return True
            except Exception as e:
                print(self._color_text(f"[PluginManager] Reload failed for '{plugin_id}': {e}", COLOR_RED))
                return False

    def start_hot_reload_watcher(self, interval: float = 1.0):
        with self._lock:
            if self._watcher_thread and self._watcher_thread.is_alive():
                return
            self._watcher_stop_event = threading.Event()

            def _watch_loop():
                # Initial discover of new plugin folders not yet loaded
                os.makedirs(self.plugins_dir, exist_ok=True)
                while not self._watcher_stop_event.is_set():
                    try:
                        # Discover and load newly added plugins
                        seen = set()
                        for entry in os.scandir(self.plugins_dir):
                            if entry.is_dir():
                                seen.add(entry.name)
                                if entry.name not in self._plugins:
                                    self._load_plugin_from_path(entry.path)

                        # Unload plugins removed from disk
                        for pid in list(self._plugins.keys()):
                            plugin = self._plugins.get(pid)
                            if not plugin:
                                continue
                            if not os.path.isdir(plugin.path):
                                self._unload_plugin(pid)
                                print(f"[PluginManager] Plugin '{pid}' directory removed. Unloaded.")
                                continue
                            # Reload if files changed
                            if self._files_changed(plugin):
                                self.reload_plugin(pid)
                    except Exception as e:
                        print(f"[PluginManager] Hot-reload watcher error: {e}")
                    finally:
                        time.sleep(max(0.2, interval))

            self._watcher_thread = threading.Thread(target=_watch_loop, name="PluginHotReload", daemon=True)
            self._watcher_thread.start()
            print("[PluginManager] Hot-reload watcher started.")

    def stop_hot_reload_watcher(self):
        with self._lock:
            if self._watcher_stop_event:
                self._watcher_stop_event.set()
            if self._watcher_thread:
                self._watcher_thread.join(timeout=2.0)
            self._watcher_thread = None
            self._watcher_stop_event = None

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

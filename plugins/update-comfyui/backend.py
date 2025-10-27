import os
import subprocess
import threading
import time
from typing import Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request

try:
    import psutil
except ImportError:  # pragma: no cover - psutil should be available but fail gracefully
    psutil = None


class UpdateComfyUIPlugin:
    """
    Service plugin that supervises the ComfyUI desktop process and exposes
    safe start/stop/restart endpoints for the frontend launcher.
    """

    SETTINGS_FILE = "update_comfyui_settings.json"
    PROCESS_NAME = "ComfyUI.exe"
    DEFAULT_SERVER = "127.0.0.1:8888"

    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint("update_comfyui", __name__)
        self._lock = threading.Lock()
        self._settings = self._load_settings()
        self._register_routes()

        if not psutil:
            print("[Plugin:UpdateComfyUI] Warning: psutil is not available. Process control disabled.")

    # ------------------------------------------------------------------ #
    # Flask blueprint
    # ------------------------------------------------------------------ #

    def _register_routes(self) -> None:
        @self.blueprint.route("/status", methods=["GET"])
        def get_status():
            if not self._ensure_auth():
                return self._unauthorized_response()

            server_address = request.args.get("server_address", "").strip() or self._settings["server_address"]
            payload = self._build_status_payload(server_address)
            return jsonify(payload)

        @self.blueprint.route("/start", methods=["POST"])
        def start_comfy():
            if not self._ensure_auth():
                return self._unauthorized_response()
            if not psutil:
                return jsonify({"error": "psutil is not installed on this system."}), 500

            payload = request.get_json(silent=True) or {}
            server_address = (payload.get("server_address") or self._settings["server_address"]).strip()

            executable_path = self._get_executable_path_for_launch()
            if not executable_path:
                return jsonify({"error": "ComfyUI executable path is not configured on the server."}), 500

            with self._lock:
                status_before = self._describe_processes()
                if status_before:
                    return jsonify({
                        "status": "already_running",
                        **self._build_status_payload(server_address)
                    })

                launch_result = self._launch_comfy(executable_path)
                if not launch_result["ok"]:
                    return jsonify({"error": launch_result["error"]}), 400

                self._persist_settings(server_address=server_address)
                payload = self._build_status_payload(server_address)
                payload["status"] = "starting"
                payload["launched_pid"] = launch_result.get("pid")
                return jsonify(payload)

        @self.blueprint.route("/stop", methods=["POST"])
        def stop_comfy():
            if not self._ensure_auth():
                return self._unauthorized_response()
            if not psutil:
                return jsonify({"error": "psutil is not installed on this system."}), 500

            summary = self._stop_processes()
            payload = self._build_status_payload(self._settings["server_address"])
            payload["status"] = "stopped" if summary["terminated"] or summary["killed"] else "no_process"
            payload["stop_summary"] = summary
            return jsonify(payload)

        @self.blueprint.route("/restart", methods=["POST"])
        def restart_comfy():
            if not self._ensure_auth():
                return self._unauthorized_response()
            if not psutil:
                return jsonify({"error": "psutil is not installed on this system."}), 500

            payload = request.get_json(silent=True) or {}
            server_address = (payload.get("server_address") or self._settings["server_address"]).strip()

            executable_path = self._get_executable_path_for_launch()
            if not executable_path:
                return jsonify({"error": "ComfyUI executable path is not configured on the server."}), 500

            with self._lock:
                queue_busy, queue_snapshot = self._queue_has_activity(server_address)
                if queue_busy:
                    return (
                        jsonify({
                            "description": "ComfyUI dang co task dang cho hoac dang chay. Vui long huy hoac doi hoan tat truoc khi restart.",
                            "queue_running": queue_snapshot.get("running", []),
                            "queue_pending": queue_snapshot.get("pending", []),
                        }),
                        409,
                    )

                stop_summary = self._stop_processes()
                launch_result = self._launch_comfy(executable_path)
                response_payload = self._build_status_payload(server_address)
                response_payload["stop_summary"] = stop_summary

                if launch_result["ok"]:
                    self._persist_settings(server_address=server_address)
                    response_payload["status"] = "restarted"
                    response_payload["launched_pid"] = launch_result.get("pid")
                else:
                    response_payload["status"] = "stopped_only"
                    response_payload["error"] = launch_result["error"]

                return jsonify(response_payload)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _ensure_auth(self) -> bool:
        try:
            self.core_api.verify_token_and_get_user_hash()
            return True
        except Exception as exc:  # noqa: BLE001
            self._last_auth_error = str(exc)
            return False

    def _unauthorized_response(self):
        return jsonify({"error": getattr(self, "_last_auth_error", "Unauthorized")}), 401

    def _build_status_payload(self, server_address: str) -> Dict:
        processes = self._describe_processes()
        is_running = bool(processes)
        ready_state = self._check_comfy_ready(server_address) if is_running else (False, None)
        is_ready, ready_error = ready_state

        status = "ready" if is_ready else ("running" if is_running else "stopped")
        executable_path = self._settings["executable_path"]

        return {
            "status": status,
            "is_running": is_running,
            "is_ready": is_ready,
            "server_address": server_address,
            "executable_path": executable_path,
            "executable_exists": bool(executable_path and os.path.isfile(executable_path)),
            "processes": processes,
            "ready_error": ready_error,
            "timestamp": time.time(),
        }

    def _describe_processes(self) -> List[Dict]:
        if not psutil:
            return []

        processes = []
        for proc in self._iter_comfy_processes():
            try:
                info = proc.as_dict(attrs=["pid", "name", "status", "create_time"])
                info["exe"] = self._safe_proc_attr(proc, "exe")
                info["cmdline"] = self._safe_proc_attr(proc, "cmdline")
                processes.append(info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return processes

    def _check_comfy_ready(self, server_address: str) -> Tuple[bool, Optional[str]]:
        try:
            self.core_api.comfy_api_client.get_queue_details_sync(server_address)
            return True, None
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def _iter_comfy_processes(self):
        if not psutil:
            return []

        target = self.PROCESS_NAME.lower()
        for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
            try:
                name = (proc.info.get("name") or "").lower()
                if name == target:
                    yield proc
                    continue
                exe_path = (proc.info.get("exe") or "").lower()
                if target in exe_path:
                    yield proc
                    continue
                cmdline = " ".join(proc.info.get("cmdline") or []).lower()
                if target in cmdline:
                    yield proc
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

    def _safe_proc_attr(self, proc, attr: str):
        try:
            return getattr(proc, attr)()
        except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
            return None

    def _launch_comfy(self, executable_path: str) -> Dict:
        executable_path = executable_path.strip()
        if not executable_path:
            return {"ok": False, "error": "Executable path is missing."}
        if not os.path.isfile(executable_path):
            return {"ok": False, "error": f"Executable not found at '{executable_path}'."}

        try:
            working_dir = os.path.dirname(executable_path) or None
            creationflags = 0
            if os.name == "nt":
                creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                creationflags |= getattr(subprocess, "DETACHED_PROCESS", 0)
                creationflags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)

            popen_kwargs = {
                "cwd": working_dir,
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
            }
            if creationflags:
                popen_kwargs["creationflags"] = creationflags
            if os.name != "nt":
                popen_kwargs["start_new_session"] = True

            proc = psutil.Popen([executable_path], **popen_kwargs)
            return {"ok": True, "pid": proc.pid}
        except FileNotFoundError:
            return {"ok": False, "error": f"Executable not found at '{executable_path}'."}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    def _stop_processes(self) -> Dict:
        summary = {"terminated": 0, "killed": 0, "errors": []}
        if not psutil:
            summary["errors"].append("psutil is not available.")
            return summary

        procs = list(self._iter_comfy_processes())
        if not procs:
            return summary

        for proc in procs:
            try:
                proc.terminate()
                summary["terminated"] += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
                summary["errors"].append(f"PID {proc.pid}: {exc}")
            except Exception as exc:  # noqa: BLE001
                summary["errors"].append(f"PID {proc.pid}: {exc}")

        gone, alive = psutil.wait_procs(procs, timeout=10)
        for proc in alive:
            try:
                proc.kill()
                summary["killed"] += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied) as exc:
                summary["errors"].append(f"PID {proc.pid}: {exc}")

        return summary

    def _persist_settings(self, *, server_address: Optional[str] = None) -> None:
        if server_address:
            self._settings["server_address"] = server_address.strip() or self.DEFAULT_SERVER
        data = {
            "executable_path": self._settings.get("executable_path", ""),
            "server_address": self._settings.get("server_address", self.DEFAULT_SERVER),
        }
        self.core_api.save_data(data, self.SETTINGS_FILE, obfuscated=False)

    def _load_settings(self) -> Dict:
        data = self.core_api.read_data(self.SETTINGS_FILE, default_value={}, obfuscated=False) or {}
        env_exec_path = os.environ.get("COMFYUI_EXECUTABLE_PATH", "").strip()
        executable_path = env_exec_path or data.get("executable_path") or ""
        if executable_path and os.path.isfile(executable_path):
            executable_path = os.path.normpath(executable_path)
        else:
            executable_path = self._resolve_default_executable()

        server_address = data.get("server_address") or self.DEFAULT_SERVER
        settings = {
            "executable_path": executable_path,
            "server_address": server_address.strip() or self.DEFAULT_SERVER,
        }
        self.core_api.save_data(settings, self.SETTINGS_FILE, obfuscated=False)
        return settings

    def _queue_has_activity(self, server_address: str) -> Tuple[bool, Dict[str, List]]:
        if not server_address:
            return False, {"running": [], "pending": []}
        try:
            queue_details = self.core_api.comfy_api_client.get_queue_details_sync(server_address)
        except Exception:
            return False, {"running": [], "pending": []}

        running = queue_details.get("queue_running", []) or []
        pending = queue_details.get("queue_pending", []) or []
        has_activity = bool(running or pending)
        return has_activity, {"running": running, "pending": pending}

    def _resolve_default_executable(self) -> str:
        candidates = [
            r"%APPDATA%\Local\Programs\ComfyUI\ComfyUI.exe",
            r"%LOCALAPPDATA%\Programs\ComfyUI\ComfyUI.exe",
            r"%PROGRAMFILES%\ComfyUI\ComfyUI.exe",
        ]
        for candidate in candidates:
            path = os.path.expandvars(candidate)
            if os.path.isfile(path):
                return os.path.normpath(path)
        return ""

    def _get_executable_path_for_launch(self) -> str:
        """
        Determine the executable path using server-side configuration only.
        Returns an empty string if no valid executable is available.
        """
        configured = self._settings.get("executable_path")
        if configured and os.path.isfile(configured):
            return os.path.normpath(configured)

        resolved = self._resolve_default_executable()
        if resolved:
            self._settings["executable_path"] = resolved
            self._persist_settings()
            return resolved

        return ""

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/update-comfyui"

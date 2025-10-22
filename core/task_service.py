import threading
import time
import traceback
from typing import Any, Callable, Dict, Optional


class ManagedThreadTask:
    """
    Wraps a long-running callable inside a managed daemon thread.
    Provides cooperative stop via threading.Event and optional stop callback.
    """

    def __init__(
        self,
        plugin_id: str,
        name: str,
        target: Callable[..., Any],
        *,
        args: Optional[tuple] = None,
        kwargs: Optional[dict] = None,
        pass_stop_event: bool = True,
        stop_callback: Optional[Callable[[threading.Event], Any]] = None,
        auto_restart: bool = False,
        restart_delay: float = 5.0,
        daemon: bool = True,
    ):
        self.plugin_id = plugin_id
        self.name = name
        self._target = target
        self._args = args or ()
        self._kwargs = kwargs or {}
        self._pass_stop_event = pass_stop_event
        self._stop_callback = stop_callback
        self._auto_restart = auto_restart
        self._restart_delay = max(0.5, restart_delay)
        self._daemon = daemon

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.RLock()
        self._requested_stop = False

        self.status = "registered"  # registered | running | stopped | error
        self.last_error: Optional[str] = None
        self.last_started_at: Optional[float] = None
        self.last_stopped_at: Optional[float] = None
        self.restart_count = 0

    def _run_wrapper(self):
        try:
            if self._pass_stop_event:
                self._target(self._stop_event, *self._args, **self._kwargs)
            else:
                self._target(*self._args, **self._kwargs)
            with self._lock:
                if self._stop_event.is_set() or self._requested_stop:
                    self.status = "stopped"
                else:
                    self.status = "stopped"
        except Exception:
            tb = traceback.format_exc()
            print(f"[TaskService] Task '{self.name}' for plugin '{self.plugin_id}' crashed:\n{tb}")
            with self._lock:
                self.status = "error"
                self.last_error = tb
        finally:
            with self._lock:
                self._thread = None
                self.last_stopped_at = time.time()
                should_restart = (
                    self._auto_restart
                    and not self._stop_event.is_set()
                    and not self._requested_stop
                )
            if should_restart:
                self.restart_count += 1
                print(
                    f"[TaskService] Task '{self.name}' for plugin '{self.plugin_id}' "
                    f"restarting in {self._restart_delay} seconds (attempt {self.restart_count})."
                )
                time.sleep(self._restart_delay)
                self.start()

    def start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._requested_stop = False
            self._stop_event.clear()
            self.status = "running"
            self.last_error = None
            self.last_started_at = time.time()

            thread = threading.Thread(
                target=self._run_wrapper,
                name=f"{self.plugin_id}:{self.name}",
                daemon=self._daemon,
            )
            self._thread = thread
        print(f"[TaskService] Starting task '{self.name}' for plugin '{self.plugin_id}'.")
        thread.start()

    def stop(self, timeout: float = 10.0):
        with self._lock:
            if not self._thread:
                return
            self._requested_stop = True
            self._stop_event.set()
            thread = self._thread
        print(f"[TaskService] Stopping task '{self.name}' for plugin '{self.plugin_id}'.")
        try:
            if self._stop_callback:
                self._stop_callback(self._stop_event)
        except Exception:
            tb = traceback.format_exc()
            print(f"[TaskService] stop_callback failed for task '{self.name}':\n{tb}")
        thread.join(timeout)
        with self._lock:
            still_running = thread.is_alive()
            if still_running:
                print(
                    f"[TaskService] Warning: task '{self.name}' for plugin '{self.plugin_id}' "
                    f"is still running after {timeout} seconds."
                )
                self.status = "stopping_timeout"
            else:
                self.status = "stopped"
            self._thread = None
            self.last_stopped_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "plugin_id": self.plugin_id,
                "name": self.name,
                "status": self.status,
                "last_error": self.last_error,
                "last_started_at": self.last_started_at,
                "last_stopped_at": self.last_stopped_at,
                "restart_count": self.restart_count,
                "is_running": bool(self._thread and self._thread.is_alive()),
            }


class BackgroundTaskService:
    """
    Central registry that lets plugins register long-running background tasks
    (e.g. Discord bots). Each task is isolated per plugin for easier lifecycle management.
    """

    def __init__(self):
        self._tasks: Dict[str, Dict[str, ManagedThreadTask]] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ #
    # Registration & lifecycle
    # ------------------------------------------------------------------ #

    def register_thread_task(
        self,
        plugin_id: str,
        task_name: str,
        target: Callable[..., Any],
        *,
        args: Optional[tuple] = None,
        kwargs: Optional[dict] = None,
        pass_stop_event: bool = True,
        stop_callback: Optional[Callable[[threading.Event], Any]] = None,
        auto_start: bool = True,
        auto_restart: bool = False,
        restart_delay: float = 5.0,
        daemon: bool = True,
    ) -> ManagedThreadTask:
        if not plugin_id:
            raise ValueError("plugin_id is required to register a background task.")
        if not task_name:
            raise ValueError("task_name is required to register a background task.")

        task = ManagedThreadTask(
            plugin_id,
            task_name,
            target,
            args=args,
            kwargs=kwargs,
            pass_stop_event=pass_stop_event,
            stop_callback=stop_callback,
            auto_restart=auto_restart,
            restart_delay=restart_delay,
            daemon=daemon,
        )

        with self._lock:
            plugin_tasks = self._tasks.setdefault(plugin_id, {})
            if task_name in plugin_tasks:
                raise ValueError(
                    f"Task '{task_name}' already registered for plugin '{plugin_id}'."
                )
            plugin_tasks[task_name] = task

        if auto_start:
            task.start()
        else:
            print(
                f"[TaskService] Task '{task_name}' for plugin '{plugin_id}' registered (auto_start=False)."
            )

        return task

    def start_task(self, plugin_id: str, task_name: str):
        task = self._get_task(plugin_id, task_name)
        task.start()

    def stop_task(self, plugin_id: str, task_name: str, timeout: float = 10.0):
        task = self._get_task(plugin_id, task_name)
        task.stop(timeout=timeout)

    def stop_all_for_plugin(self, plugin_id: str, timeout: float = 10.0):
        with self._lock:
            plugin_tasks = list(self._tasks.get(plugin_id, {}).values())
        for task in plugin_tasks:
            task.stop(timeout=timeout)

    def stop_all(self, timeout: float = 10.0):
        with self._lock:
            all_tasks = [
                task
                for plugin_tasks in self._tasks.values()
                for task in plugin_tasks.values()
            ]
        for task in all_tasks:
            task.stop(timeout=timeout)

    # ------------------------------------------------------------------ #
    # Introspection helpers
    # ------------------------------------------------------------------ #

    def get_status(self, plugin_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            if plugin_id:
                plugin_tasks = self._tasks.get(plugin_id, {})
                return {plugin_id: {name: task.to_dict() for name, task in plugin_tasks.items()}}
            return {
                p_id: {name: task.to_dict() for name, task in p_tasks.items()}
                for p_id, p_tasks in self._tasks.items()
            }

    def _get_task(self, plugin_id: str, task_name: str) -> ManagedThreadTask:
        with self._lock:
            plugin_tasks = self._tasks.get(plugin_id)
            if not plugin_tasks or task_name not in plugin_tasks:
                raise KeyError(
                    f"Task '{task_name}' not found for plugin '{plugin_id}'."
                )
            return plugin_tasks[task_name]

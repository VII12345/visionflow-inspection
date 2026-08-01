"""Process-local runtime state shared by the Flask API and worker threads."""

from dataclasses import dataclass, field
from queue import Queue
from threading import RLock
from typing import Any

from .config import Config


DEFAULT_CAMERA_STATE = {
    "state": "disconnected",
    "serial": None,
    "model": None,
    "ip": None,
    "triggerMode": "hardware",
    "fps": 0,
    "totalTriggers": 0,
    "lastFrameTime": None,
    "error": None,
}


@dataclass
class RuntimeState:
    """Mutable process state kept in one explicit container.

    The application is a local desktop/industrial runtime, so this state is
    intentionally process-local rather than a distributed store.
    """

    camera_manager: Any = None
    cameras: dict[int, Any] = field(default_factory=dict)
    camera_states: dict[int, dict[str, Any]] = field(
        default_factory=lambda: {
            cam_id: dict(DEFAULT_CAMERA_STATE)
            for cam_id in range(1, Config.CAMERA_COUNT + 1)
        }
    )
    system_running: bool = False
    line_enabled: dict[int, bool] = field(
        default_factory=lambda: {
            cam_id: True for cam_id in range(1, Config.CAMERA_COUNT + 1)
        }
    )
    latest_frames: dict[int, Any] = field(default_factory=dict)
    latest_results: dict[int, dict[str, Any]] = field(default_factory=dict)
    stats: dict[int, dict[str, int]] = field(
        default_factory=lambda: {
            cam_id: {"detected": 0, "defective": 0}
            for cam_id in range(1, Config.CAMERA_COUNT + 1)
        }
    )
    env_check_result: Any = None
    save_settings: dict[int, dict[str, bool]] = field(default_factory=dict)
    save_only_reject: bool = False
    training_state: dict[str, Any] = field(default_factory=dict)
    _training_thread: Any = None
    _training_stop_flag: bool = False
    _save_queue: Queue = field(default_factory=Queue)
    _save_queue_running: bool = False
    lock: RLock = field(default_factory=RLock)

    def get_camera_state(self, cam_id: int):
        with self.lock:
            state = self.camera_states.get(cam_id)
            return dict(state) if state is not None else None

    def update_camera_state(self, cam_id: int, **updates: Any):
        with self.lock:
            state = self.camera_states.setdefault(cam_id, dict(DEFAULT_CAMERA_STATE))
            state.update(updates)

    def set_latest_frame(self, cam_id: int, frame: Any):
        with self.lock:
            self.latest_frames[cam_id] = frame

    def get_latest_frame(self, cam_id: int):
        with self.lock:
            return self.latest_frames.get(cam_id)

    def set_latest_result(self, cam_id: int, result: dict[str, Any]):
        with self.lock:
            self.latest_results[cam_id] = dict(result)

    def get_latest_result(self, cam_id: int):
        with self.lock:
            result = self.latest_results.get(cam_id)
            return dict(result) if result is not None else None

    def get_camera_snapshot(self, cam_id: int):
        with self.lock:
            state = dict(self.camera_states.get(cam_id, DEFAULT_CAMERA_STATE))
            camera_stats = dict(self.stats.get(cam_id, {"detected": 0, "defective": 0}))
            result = self.latest_results.get(cam_id)
            return state, camera_stats, dict(result) if result is not None else None

    def increment_stat(self, cam_id: int, key: str):
        if key not in {"detected", "defective"}:
            raise ValueError(f"不支持的统计字段: {key}")
        with self.lock:
            camera_stats = self.stats.setdefault(cam_id, {"detected": 0, "defective": 0})
            camera_stats[key] = int(camera_stats.get(key, 0)) + 1

    def reset_camera_stats(self, cam_id: int):
        with self.lock:
            self.stats[cam_id] = {"detected": 0, "defective": 0}
            return dict(self.stats[cam_id])

    def get_stats_snapshot(self):
        with self.lock:
            return {cam_id: dict(values) for cam_id, values in self.stats.items()}


runtime = RuntimeState()

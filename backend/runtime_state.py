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
    training_state: dict[str, Any] = field(default_factory=dict)
    _training_thread: Any = None
    _training_stop_flag: bool = False
    _save_queue: Queue = field(default_factory=Queue)
    _save_queue_running: bool = False
    lock: RLock = field(default_factory=RLock)


runtime = RuntimeState()

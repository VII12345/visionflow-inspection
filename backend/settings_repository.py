"""Persistence helpers for local runtime settings."""

import json

from .config import Config


def normalize_line_count(value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = Config.CAMERA_COUNT
    return max(Config.MIN_CAMERA_COUNT, min(Config.MAX_CAMERA_COUNT, value))


def load_line_count():
    path = Config.LINE_COUNT_FILE
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return normalize_line_count(payload.get("line_count"))
        except (OSError, TypeError, ValueError, AttributeError):
            pass
    return Config.CAMERA_COUNT


def save_line_count(count):
    count = normalize_line_count(count)
    path = Config.LINE_COUNT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"line_count": count}, handle, indent=2)
    return count


def load_device_config():
    path = Config.DATA_DIR / "device_config.json"
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                return payload
        except (OSError, TypeError, ValueError):
            pass
    return {"training_device": Config.DEVICE, "inference_device": Config.DEVICE}


def save_device_config(config):
    path = Config.DATA_DIR / "device_config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)

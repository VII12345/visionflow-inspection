"""PLC 可编辑路由配置的读取、校验与持久化。"""

import json
import os
from copy import deepcopy

from .config import Config
from .logger import logger


PLC_BASE_URL = os.getenv("PLC_BASE_URL", "http://127.0.0.1:8088").rstrip("/")
PLC_PROXY_URL = os.getenv("PLC_PROXY_URL", "").strip()
PLC_TIMEOUT_SECONDS = float(os.getenv("PLC_TIMEOUT_SECONDS", "3"))
DEFAULT_NODE_PREFIX = "NODES.MODBUS."
DEFAULT_CAMERA_PLC_MAP = {
    1: {"reject_time": "VW0", "reject_delay": "VW2", "reject_signal": "MB0", "reject_time_value": 0, "reject_delay_value": 0},
    2: {"reject_time": "VW4", "reject_delay": "VW6", "reject_signal": "MB1", "reject_time_value": 0, "reject_delay_value": 0},
    3: {"reject_time": "VW8", "reject_delay": "VW10", "reject_signal": "MB2", "reject_time_value": 0, "reject_delay_value": 0},
    4: {"reject_time": "VW12", "reject_delay": "VW14", "reject_signal": "MB3", "reject_time_value": 0, "reject_delay_value": 0},
}
# 保留导出名称，兼容旧模块引用；实际运行时使用 get_plc_config() 的动态配置。
CAMERA_PLC_MAP = DEFAULT_CAMERA_PLC_MAP

# DWord 写入边界，与 plc_client.write_dword 保持一致。
_PLC_DWORD_MAX = 4294967295

# save_plc_config 会识别的顶层键；其余键视为扩展字段（如 snap7 直连分支的 plc_*），保存时沿用，避免被覆盖丢。
_KNOWN_TOP_KEYS = {"enabled", "base_url", "proxy_url", "timeout_seconds", "node_prefix", "reject_labels", "cameras"}


def _extra_top_level_fields(config):
    """收集 normallizer 不认识的顶层扩展字段（plc_ip/plc_port/plc_rack 等）。

    优先取本次请求提供的值；请求未提供时沿用现有配置文件里的值，
    保证通过 UI 保存不会把其他分支/外部工具写入的扩展字段覆盖丢。
    """
    extra = {key: deepcopy(value) for key, value in config.items() if key not in _KNOWN_TOP_KEYS}
    try:
        if Config.PLC_CONFIG_FILE.exists():
            with open(Config.PLC_CONFIG_FILE, "r", encoding="utf-8") as handle:
                saved = json.load(handle)
            if isinstance(saved, dict):
                for key, value in saved.items():
                    if key not in _KNOWN_TOP_KEYS and key not in extra:
                        extra[key] = deepcopy(value)
    except Exception as exc:
        logger.warning(f"读取 PLC 配置扩展字段失败: {exc}")
    return extra


def _clamp_value(raw, default=0):
    """把节点写入值规整为非负整数，非法输入回落默认值。"""
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        return default
    return max(0, min(parsed, _PLC_DWORD_MAX))


def _default_config():
    cameras = {str(cam_id): deepcopy(mapping) for cam_id, mapping in DEFAULT_CAMERA_PLC_MAP.items()}
    for cam_id in range(5, Config.MAX_CAMERA_COUNT + 1):
        cameras[str(cam_id)] = {
            "reject_time": f"VW{(cam_id - 1) * 4}",
            "reject_delay": f"VW{(cam_id - 1) * 4 + 2}",
            "reject_signal": f"MB{cam_id - 1}",
            "reject_time_value": 0,
            "reject_delay_value": 0,
        }
    return {
        "enabled": True,
        "base_url": PLC_BASE_URL,
        "proxy_url": PLC_PROXY_URL,
        "timeout_seconds": PLC_TIMEOUT_SECONDS,
        "node_prefix": DEFAULT_NODE_PREFIX,
        "reject_labels": ["剔除类"],
        "cameras": cameras,
    }


def get_plc_config():
    """读取并合并 PLC 配置，旧版本没有配置文件时自动生成内存默认值。"""
    config = _default_config()
    try:
        if Config.PLC_CONFIG_FILE.exists():
            with open(Config.PLC_CONFIG_FILE, "r", encoding="utf-8") as handle:
                saved = json.load(handle)
            if isinstance(saved, dict):
                for key in ("enabled", "base_url", "proxy_url", "timeout_seconds", "node_prefix", "reject_labels"):
                    if key in saved:
                        config[key] = saved[key]
                saved_cameras = saved.get("cameras", {})
                if isinstance(saved_cameras, dict):
                    for cam_id, mapping in saved_cameras.items():
                        if str(cam_id) in config["cameras"] and isinstance(mapping, dict):
                            config["cameras"][str(cam_id)].update({
                                key: str(mapping.get(key, config["cameras"][str(cam_id)][key])).strip()
                                for key in ("reject_time", "reject_delay", "reject_signal")
                            })
                            for value_key in ("reject_time_value", "reject_delay_value"):
                                config["cameras"][str(cam_id)][value_key] = _clamp_value(
                                    mapping.get(value_key, config["cameras"][str(cam_id)].get(value_key, 0))
                                )
    except Exception as exc:
        logger.warning(f"读取 PLC 配置失败，使用默认值: {exc}")
    return config


def save_plc_config(config):
    """校验并持久化 PLC 配置。"""
    defaults = _default_config()
    if not isinstance(config, dict):
        raise ValueError("PLC 配置格式无效")
    base_url = str(config.get("base_url", defaults["base_url"])).strip().rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("PLC 地址必须以 http:// 或 https:// 开头")
    node_prefix = str(config.get("node_prefix", defaults["node_prefix"])).strip()
    reject_labels = [str(item).strip() for item in (config.get("reject_labels", defaults["reject_labels"]) or []) if str(item).strip()]
    if not reject_labels:
        raise ValueError("至少配置一个触发剔除的类别名称")
    if not node_prefix:
        raise ValueError("节点前缀不能为空")
    try:
        timeout = float(config.get("timeout_seconds", defaults["timeout_seconds"]))
    except (TypeError, ValueError) as exc:
        raise ValueError("PLC 超时时间必须是数字") from exc
    if timeout <= 0 or timeout > 120:
        raise ValueError("PLC 超时时间必须在 0 到 120 秒之间")

    normalized = {
        "enabled": bool(config.get("enabled", True)),
        "base_url": base_url,
        "proxy_url": str(config.get("proxy_url", "")).strip(),
        "timeout_seconds": timeout,
        "node_prefix": node_prefix,
        "reject_labels": reject_labels,
        "cameras": {},
    }
    cameras = config.get("cameras", {})
    for cam_id in range(1, Config.MAX_CAMERA_COUNT + 1):
        raw = cameras.get(str(cam_id), {}) if isinstance(cameras, dict) else {}
        mapping = defaults["cameras"][str(cam_id)]
        normalized["cameras"][str(cam_id)] = {
            key: str(raw.get(key, mapping[key])).strip()
            for key in ("reject_time", "reject_delay", "reject_signal")
        }
        if any(not normalized["cameras"][str(cam_id)][key] for key in ("reject_time", "reject_delay", "reject_signal")):
            raise ValueError(f"相机 {cam_id} 的 PLC 节点名称不能为空")
        for value_key in ("reject_time_value", "reject_delay_value"):
            try:
                value = int(raw.get(value_key, mapping[value_key]))
            except (TypeError, ValueError):
                raise ValueError(f"相机 {cam_id} 的 {value_key} 必须是整数") from None
            if value < 0 or value > _PLC_DWORD_MAX:
                raise ValueError(f"相机 {cam_id} 的 {value_key} 必须在 0 到 {_PLC_DWORD_MAX} 之间")
            normalized["cameras"][str(cam_id)][value_key] = value

    normalized.update(_extra_top_level_fields(config))

    Config.DATA_DIR.mkdir(exist_ok=True)
    with open(Config.PLC_CONFIG_FILE, "w", encoding="utf-8") as handle:
        json.dump(normalized, handle, indent=2, ensure_ascii=False)
    return normalized

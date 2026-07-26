"""PLC Web API client and editable routing configuration."""

import json
import os
import threading
import urllib.error
import urllib.request
from copy import deepcopy

from .config import Config
from .logger import logger


PLC_BASE_URL = os.getenv("PLC_BASE_URL", "http://127.0.0.1:8088").rstrip("/")
PLC_PROXY_URL = os.getenv("PLC_PROXY_URL", "").strip()
PLC_TIMEOUT_SECONDS = float(os.getenv("PLC_TIMEOUT_SECONDS", "3"))
DEFAULT_NODE_PREFIX = "NODES.MODBUS."
DEFAULT_CAMERA_PLC_MAP = {
    1: {"reject_time": "VW0", "reject_delay": "VW2", "reject_signal": "MB0"},
    2: {"reject_time": "VW4", "reject_delay": "VW6", "reject_signal": "MB1"},
    3: {"reject_time": "VW8", "reject_delay": "VW10", "reject_signal": "MB2"},
    4: {"reject_time": "VW12", "reject_delay": "VW14", "reject_signal": "MB3"},
}
# 保留导出名称，兼容旧模块引用；实际运行时使用 get_plc_config() 的动态配置。
CAMERA_PLC_MAP = DEFAULT_CAMERA_PLC_MAP


class PlcWriteError(RuntimeError):
    """Raised when an PLC node write fails."""


def _default_config():
    cameras = {str(cam_id): deepcopy(mapping) for cam_id, mapping in DEFAULT_CAMERA_PLC_MAP.items()}
    for cam_id in range(5, Config.MAX_CAMERA_COUNT + 1):
        cameras[str(cam_id)] = {
            "reject_time": f"VW{(cam_id - 1) * 4}",
            "reject_delay": f"VW{(cam_id - 1) * 4 + 2}",
            "reject_signal": f"MB{cam_id - 1}",
        }
    return {
        "enabled": True,
        "base_url": PLC_BASE_URL,
        "proxy_url": PLC_PROXY_URL,
        "timeout_seconds": PLC_TIMEOUT_SECONDS,
        "node_prefix": DEFAULT_NODE_PREFIX,
        "reject_labels": ["类别B"],
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

    Config.DATA_DIR.mkdir(exist_ok=True)
    with open(Config.PLC_CONFIG_FILE, "w", encoding="utf-8") as handle:
        json.dump(normalized, handle, indent=2, ensure_ascii=False)
    return normalized


class PlcService:
    """Thread-safe client for the configurable PLC write API."""

    def __init__(self, base_url=PLC_BASE_URL, proxy_url=PLC_PROXY_URL, node_prefix=DEFAULT_NODE_PREFIX, timeout_seconds=PLC_TIMEOUT_SECONDS):
        self.base_url = base_url.rstrip("/")
        self.proxy_url = proxy_url
        self.node_prefix = node_prefix
        self.timeout_seconds = float(timeout_seconds)
        self._lock = threading.Lock()
        self.last_error = None
        self.last_write = None

    def with_base_url(self, base_url):
        config = get_plc_config()
        return PlcService(
            base_url=base_url,
            proxy_url=config.get("proxy_url", self.proxy_url),
            node_prefix=config.get("node_prefix", self.node_prefix),
            timeout_seconds=config.get("timeout_seconds", self.timeout_seconds),
        )

    def _node_name(self, address):
        return f"{self.node_prefix}{address}"

    def write_node(self, address, value):
        if not isinstance(value, list) or not value:
            raise ValueError("PLC 节点值必须是非空数组")
        payload = {"action": "plc_write_node", "node": self._node_name(address), "value": value}
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        opener = urllib.request.build_opener()
        if self.proxy_url:
            opener.add_handler(urllib.request.ProxyHandler({"http": self.proxy_url, "https": self.proxy_url}))
        else:
            opener.add_handler(urllib.request.ProxyHandler({}))
        try:
            with self._lock:
                with opener.open(request, timeout=self.timeout_seconds) as response:
                    response_data = json.loads(response.read().decode("utf-8"))
            errcode = response_data.get("errcode")
            errmsg = response_data.get("errmsg", "")
            if errcode != 0:
                raise PlcWriteError(f"{payload['node']} 写入失败({errcode}): {errmsg}")
            self.last_error = None
            self.last_write = {"node": payload["node"], "value": value}
            logger.info(f"PLC 写入成功: {payload['node']} = {value}")
            return {"node": payload["node"], "value": value, "errcode": 0}
        except (urllib.error.URLError, TimeoutError, ValueError, PlcWriteError) as exc:
            self.last_error = str(exc)
            logger.error(f"PLC 写入失败: {payload['node']} - {exc}")
            if isinstance(exc, PlcWriteError):
                raise
            raise PlcWriteError(f"PLC 网络请求失败: {exc}") from exc

    def write_dword(self, address, value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("DWord 值必须是整数")
        if value < 0 or value > 4294967295:
            raise ValueError("DWord 值必须在 0 到 4294967295 之间")
        return self.write_node(address, [value])

    def write_byte(self, address, value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Byte 值必须是整数")
        if value < 0 or value > 255:
            raise ValueError("Byte 值必须在 0 到 255 之间")
        return self.write_node(address, [value, 0])

    def write_camera_timing(self, cam_id, reject_time, reject_delay):
        mapping = get_plc_config()["cameras"].get(str(cam_id))
        if mapping is None:
            raise ValueError("无效的相机编号")
        return {
            "rejectTime": self.write_dword(mapping["reject_time"], reject_time),
            "rejectDelay": self.write_dword(mapping["reject_delay"], reject_delay),
        }

    def write_reject_signal(self, cam_id):
        mapping = get_plc_config()["cameras"].get(str(cam_id))
        if mapping is None:
            raise ValueError("无效的相机编号")
        return self.write_byte(mapping["reject_signal"], 1)


plc_service = PlcService()

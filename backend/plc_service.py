"""LECPServer Web API client for PLC node writes."""

import json
import os
import threading
import urllib.error
import urllib.request

from .logger import logger


PLC_BASE_URL = os.getenv("PLC_BASE_URL", "http://127.0.0.1:8088").rstrip("/")
PLC_PROXY_URL = os.getenv("PLC_PROXY_URL", "").strip()
PLC_TIMEOUT_SECONDS = float(os.getenv("PLC_TIMEOUT_SECONDS", "3"))

CAMERA_PLC_MAP = {
    1: {"reject_time": "VW0", "reject_delay": "VW2", "reject_signal": "MB0"},
    2: {"reject_time": "VW4", "reject_delay": "VW6", "reject_signal": "MB1"},
    3: {"reject_time": "VW8", "reject_delay": "VW10", "reject_signal": "MB2"},
    4: {"reject_time": "VW12", "reject_delay": "VW14", "reject_signal": "MB3"},
}


class PlcWriteError(RuntimeError):
    """Raised when an LECPServer node write fails."""


class PlcService:
    """Small, thread-safe client for LECPServer's plc_write_node API."""

    def __init__(self, base_url=PLC_BASE_URL, proxy_url=PLC_PROXY_URL):
        self.base_url = base_url.rstrip("/")
        self.proxy_url = proxy_url
        self._lock = threading.Lock()
        self.last_error = None
        self.last_write = None

    def with_base_url(self, base_url):
        return PlcService(base_url=base_url, proxy_url=self.proxy_url)

    def _node_name(self, address):
        # The current LECPServer Modbus node convention maps the configured
        # VD/MB names directly below NODES.MODBUS.
        return f"NODES.MODBUS.{address}"

    def write_node(self, address, value):
        if not isinstance(value, list) or not value:
            raise ValueError("PLC node value must be a non-empty array")

        payload = {
            "action": "plc_write_node",
            "node": self._node_name(address),
            "value": value,
        }
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
                with opener.open(request, timeout=PLC_TIMEOUT_SECONDS) as response:
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
            raise ValueError("DWord value must be an integer")
        if value < 0 or value > 4294967295:
            raise ValueError("DWord value must be between 0 and 4294967295")
        return self.write_node(address, [value])

    def write_byte(self, address, value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Byte value must be an integer")
        if value < 0 or value > 255:
            raise ValueError("Byte value must be between 0 and 255")
        # LECPServer 的 Byte 节点长度最小为 2（按 2 对齐），因此数组补一个 0 凑够长度 2。
        # 第一个字节为实际值，第二个恒为 0。
        return self.write_node(address, [value, 0])

    def write_camera_timing(self, cam_id, reject_time, reject_delay):
        mapping = CAMERA_PLC_MAP.get(cam_id)
        if mapping is None:
            raise ValueError("Invalid camera ID")
        return {
            "rejectTime": self.write_dword(mapping["reject_time"], reject_time),
            "rejectDelay": self.write_dword(mapping["reject_delay"], reject_delay),
        }

    def write_reject_signal(self, cam_id):
        mapping = CAMERA_PLC_MAP.get(cam_id)
        if mapping is None:
            raise ValueError("Invalid camera ID")
        return self.write_byte(mapping["reject_signal"], 1)


plc_service = PlcService()

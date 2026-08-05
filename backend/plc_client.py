"""PLC Web API 写入客户端（线程安全）。"""

import json
import threading
import urllib.error
import urllib.request

from .logger import logger
from .plc_config import (
    DEFAULT_NODE_PREFIX,
    PLC_BASE_URL,
    PLC_PROXY_URL,
    PLC_TIMEOUT_SECONDS,
    get_plc_config,
)


class PlcWriteError(RuntimeError):
    """Raised when an PLC node write fails."""


class PlcNetworkError(PlcWriteError):
    """PLC 网络层失败（连不上/超时），区别于节点写入被拒。"""


# 全局写入锁：with_base_url() 会为每次调用新建 PlcService 实例，若锁挂在实例上，
# 多相机 worker 并发写 PLC 实际不会串行化。这里统一用模块级锁串行所有写入。
_plc_write_lock = threading.Lock()


class PlcService:
    """Thread-safe client for the configurable PLC write API."""

    def __init__(self, base_url=PLC_BASE_URL, proxy_url=PLC_PROXY_URL, node_prefix=DEFAULT_NODE_PREFIX, timeout_seconds=PLC_TIMEOUT_SECONDS):
        self.base_url = base_url.rstrip("/")
        self.proxy_url = proxy_url
        self.node_prefix = node_prefix
        self.timeout_seconds = float(timeout_seconds)
        self.last_error = None
        self.last_write = None

    def with_base_url(self, base_url, config=None):
        config = config or get_plc_config()
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
            with _plc_write_lock:
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
            if isinstance(exc, (urllib.error.URLError, TimeoutError)):
                raise PlcNetworkError(f"PLC 网络请求失败: {exc}") from exc
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

    def write_camera_timing(self, cam_id, reject_time=None, reject_delay=None):
        """把某相机的持续时间/触发延时值写入对应节点。

        数值以 PLC 配置（plc_config.json 的 reject_time_value/reject_delay_value）为准，
        未配置时回退调用方传入的参数，最后回退 0。
        """
        mapping = get_plc_config()["cameras"].get(str(cam_id))
        if mapping is None:
            raise ValueError("无效的相机编号")
        reject_time = mapping.get("reject_time_value") if mapping.get("reject_time_value") is not None else reject_time
        reject_delay = mapping.get("reject_delay_value") if mapping.get("reject_delay_value") is not None else reject_delay
        if reject_time is None:
            reject_time = 0
        if reject_delay is None:
            reject_delay = 0
        return {
            "rejectTime": self.write_dword(mapping["reject_time"], int(reject_time)),
            "rejectDelay": self.write_dword(mapping["reject_delay"], int(reject_delay)),
        }

    def write_reject_signal(self, cam_id):
        mapping = get_plc_config()["cameras"].get(str(cam_id))
        if mapping is None:
            raise ValueError("无效的相机编号")
        return self.write_byte(mapping["reject_signal"], 1)


plc_service = PlcService()

"""PLC 服务聚合入口：配置读写（plc_config）+ 写入客户端（plc_client）。"""

from .plc_client import PlcService, PlcWriteError, plc_service
from .plc_config import (
    CAMERA_PLC_MAP,
    DEFAULT_CAMERA_PLC_MAP,
    DEFAULT_NODE_PREFIX,
    PLC_BASE_URL,
    PLC_PROXY_URL,
    PLC_TIMEOUT_SECONDS,
    _default_config,
    get_plc_config,
    save_plc_config,
)

__all__ = [
    "PLC_BASE_URL",
    "PLC_PROXY_URL",
    "PLC_TIMEOUT_SECONDS",
    "DEFAULT_NODE_PREFIX",
    "DEFAULT_CAMERA_PLC_MAP",
    "CAMERA_PLC_MAP",
    "PlcWriteError",
    "PlcService",
    "plc_service",
    "get_plc_config",
    "save_plc_config",
    "_default_config",
]

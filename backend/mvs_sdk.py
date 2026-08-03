"""MVS SDK 运行时引导：准备依赖路径并导入 SDK 符号。"""

import os
import sys

from .config import Config
from .logger import logger

# 导入 MVS SDK
if Config.IS_WINDOWS:
    Config.prepare_mvs_runtime_paths()
    sys.path.append(Config.PYTHON_IMPORT_PATH)
    os.environ["MVCAM_COMMON_RUNENV"] = Config.MVS_SDK_PATH

try:
    from MvCameraControl_class import *  # noqa: F401,F403
except ImportError as e:
    logger.error(f"无法导入 MVS SDK: {e}")
    MvCamera = None


def _c_string(chars):
    """把 MVS 的字符数组（遇 0 截断）转字符串。"""
    out = []
    for char in chars:
        if char == 0:
            break
        out.append(chr(char))
    return "".join(out)


def parse_gige_info(gige_info):
    """解析 GigE 设备信息，返回 {model, serial, ip}。"""
    nip = gige_info.nCurrentIp
    return {
        "model": _c_string(gige_info.chModelName),
        "serial": _c_string(gige_info.chSerialNumber),
        "ip": f"{(nip >> 24) & 0xFF}.{(nip >> 16) & 0xFF}.{(nip >> 8) & 0xFF}.{nip & 0xFF}",
    }

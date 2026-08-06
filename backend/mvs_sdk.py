"""MVS SDK 运行时引导：准备依赖路径并导入 SDK 符号。"""

import os
import sys

from .config import Config
from .logger import logger

# 导入 MVS SDK
if Config.IS_WINDOWS:
    Config.prepare_mvs_runtime_paths()
    if Config.FAKE_MVS_DIR:
        sys.path.insert(0, Config.FAKE_MVS_DIR)
    else:
        sys.path.append(Config.PYTHON_IMPORT_PATH)
    os.environ["MVCAM_COMMON_RUNENV"] = Config.MVS_SDK_PATH

# 集中导入 MVS SDK 所需的命名符号；SDK 缺失时给出占位值，使依赖模块仍可导入，
# 功能在访问时因 MvCamera is None 报出明确错误（见 mvs_camera_manager.initialize）。
try:
    from MvCameraControl_class import (  # noqa: F401
        MV_ACCESS_ExclusiveWithSwitch,
        MV_CC_DEVICE_INFO,
        MV_CC_DEVICE_INFO_LIST,
        MV_CC_PIXEL_CONVERT_PARAM,
        MV_E_NODATA,
        MV_FRAME_OUT,
        MV_GIGE_DEVICE,
        MV_TRIGGER_MODE_ON,
        MV_USB_DEVICE,
        MvCamera,
        PixelType_Gvsp_RGB8_Packed,
    )
except ImportError as e:
    logger.error(f"无法导入 MVS SDK: {e}")
    MvCamera = None
    MV_ACCESS_ExclusiveWithSwitch = 2
    MV_CC_DEVICE_INFO = None
    MV_CC_DEVICE_INFO_LIST = None
    MV_CC_PIXEL_CONVERT_PARAM = None
    MV_E_NODATA = 0x80000001
    MV_FRAME_OUT = None
    MV_GIGE_DEVICE = None
    MV_TRIGGER_MODE_ON = 1
    MV_USB_DEVICE = None
    PixelType_Gvsp_RGB8_Packed = None


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

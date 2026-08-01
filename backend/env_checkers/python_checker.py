"""Python 运行时环境检查。"""

import struct
from pathlib import Path

from ..config import Config


class PythonChecker:
    """Python 位数与运行时信息记录。"""

    def __init__(self, add):
        self._add = add

    def check(self):
        """记录 Python 位数，不根据 MVS 安装目录名推断兼容性。"""
        py_bits = struct.calcsize("P") * 8
        sdk_path = Path(Config.MVS_SDK_PATH)
        self._add(
            name="Python 运行时",
            passed=True,
            level="ok",
            message=f"Python {py_bits} 位，MVS SDK 路径: {sdk_path}",
            detail="不以 Program Files (x86) 目录名判断 SDK 位数；实际兼容性以 MVS 接口导入和 SDK 初始化结果为准。",
        )

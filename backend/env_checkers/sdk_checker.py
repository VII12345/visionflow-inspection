"""MVS SDK 导入与初始化检查。"""

import os
import sys

from ..config import Config


class SDKChecker:
    """MvCameraControl_class 导入与 SDK 初始化检查。"""

    def __init__(self, add):
        self._add = add

    def check(self):
        """检测能否导入 MvCameraControl_class"""
        try:
            import_path = str(Config.PYTHON_IMPORT_PATH)
            if import_path not in sys.path:
                sys.path.insert(0, import_path)
            os.environ.setdefault("MVCAM_COMMON_RUNENV", Config.MVS_SDK_PATH)

            from MvCameraControl_class import (  # noqa: F401
                MvCamera,
                MV_CC_DEVICE_INFO_LIST,
                MV_GIGE_DEVICE,
                MV_USB_DEVICE,
            )

            self._add(
                name="MVS SDK 导入",
                passed=True,
                level="ok",
                message="MvCameraControl_class 导入成功",
                detail="",
            )
        except ImportError as e:
            self._add(
                name="MVS SDK 导入",
                passed=False,
                level="error",
                message=f"无法导入 MvCameraControl_class: {e}",
                detail="可能原因:\n"
                
                "2. MVS 安装不完整\n"
                "3. 缺少 VC++ 运行库",
            )
        except Exception as e:
            self._add(
                name="MVS SDK 导入",
                passed=False,
                level="error",
                message=f"导入时发生异常: {e}",
                detail="请检查 MVS 安装是否完整",
            )

        self._check_sdk_init()

    def _check_sdk_init(self):
        """检测 SDK 能否初始化"""
        try:
            # 先确保已导入
            import_path = str(Config.PYTHON_IMPORT_PATH)
            if import_path not in sys.path:
                sys.path.insert(0, import_path)
            os.environ.setdefault("MVCAM_COMMON_RUNENV", Config.MVS_SDK_PATH)

            from MvCameraControl_class import MvCamera

            # 尝试初始化
            ret = MvCamera.MV_CC_Initialize()
            if ret == 0:
                self._add(
                    name="MVS SDK 初始化",
                    passed=True,
                    level="ok",
                    message="MVS SDK 初始化成功",
                    detail="",
                )
                MvCamera.MV_CC_Finalize()
            else:
                self._add(
                    name="MVS SDK 初始化",
                    passed=False,
                    level="error",
                    message=f"MVS SDK 初始化失败，错误码: {ret}",
                    detail="可能原因:\n"
                    "1. GigE 网络驱动未安装\n"
                    "2. 防火墙阻止了 SDK\n"
                    "3. 其他程序占用了 SDK 资源\n"
                    "请重启电脑后重试",
                )
        except Exception as e:
            self._add(
                name="MVS SDK 初始化",
                passed=False,
                level="error",
                message=f"MVS SDK 初始化异常: {e}",
                detail="请检查 MVS 安装是否完整",
            )

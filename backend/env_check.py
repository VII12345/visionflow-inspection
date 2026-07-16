"""
环境检测模块
在系统启动时检测 MVS SDK、Python 环境等是否满足运行要求
"""

import sys
import os
import struct
import platform
from pathlib import Path

from .config import Config
from .logger import logger


if Config.IS_WINDOWS:
    Config.prepare_mvs_runtime_paths()


class EnvCheckResult:
    """单条检测结果"""

    def __init__(self, name, passed, level, message, detail=""):
        self.name = name  # 检测项名称
        self.passed = passed  # 是否通过
        self.level = level  # 'error' | 'warning' | 'ok'
        self.message = message  # 简短消息
        self.detail = detail  # 详细信息（修复建议）


class EnvironmentChecker:
    """环境检测器 — 启动时运行，收集所有环境问题"""

    def __init__(self):
        self.results = []

    def _add(self, name, passed, level, message, detail=""):
        self.results.append(EnvCheckResult(name, passed, level, message, detail))
        status = "OK" if passed else "FAIL"
        logger.info(f"  [{status}] {name}: {message}")

    def run_all(self):
        """运行所有检测项，返回结果列表"""
        logger.info("=" * 50)
        logger.info("开始环境检测...")
        logger.info("=" * 50)

        self.results = []
        self._check_python_arch()
        self._check_mvs_paths()
        self._check_import()
        self._check_sdk_init()

        # 汇总
        errors = sum(1 for r in self.results if r.level == "error" and not r.passed)
        warnings = sum(1 for r in self.results if r.level == "warning" and not r.passed)
        all_ok = errors == 0

        logger.info("=" * 50)
        if all_ok:
            logger.info("环境检测通过 ✓")
        else:
            logger.warning(f"环境检测发现 {errors} 个错误, {warnings} 个警告")
        logger.info("=" * 50)

        return self.to_dict()

    def _check_python_arch(self):
        """检测 Python 位数 vs MVS SDK 预期位数"""
        py_bits = struct.calcsize("P") * 8

        # MVS SDK 装在 Program Files (x86) → 32-bit SDK
        # 检查实际安装路径的架构
        sdk_path = Path(Config.MVS_SDK_PATH)
        is_x86_path = "(x86)" in str(sdk_path)

        if is_x86_path and py_bits == 32:
            self._add(
                name="Python 位数匹配",
                passed=True,
                level="ok",
                message=f"Python {py_bits} 位 ↔ MVS SDK 预期 32 位，匹配",
                detail="",
            )
        elif is_x86_path and py_bits == 64:
            self._add(
                name="Python 位数匹配",
                passed=False,
                level="error",
                message=f"Python 是 {py_bits} 位，但 MVS SDK 路径在 Program Files (x86) 下（32 位SDK），不匹配",
                detail="请安装 32 位 Python，或重新安装 64 位版本的 MVS SDK",
            )
            return  # 架构不匹配，后续检测无意义
        else:
            # SDK 不在 x86 路径下，可能是 64 位 SDK
            self._add(
                name="Python 位数匹配",
                passed=True,
                level="ok",
                message=f"Python {py_bits} 位",
                detail="",
            )

    def _check_mvs_paths(self):
        """检测 MVS SDK 路径是否存在"""
        sdk_path = Path(Config.MVS_SDK_PATH)
        import_path = Path(Config.PYTHON_IMPORT_PATH)

        # 检查 SDK 根目录
        if not sdk_path.exists():
            self._add(
                name="MVS SDK 根目录",
                passed=False,
                level="error",
                message=f"MVS SDK 根目录不存在: {sdk_path}",
                detail="请安装 Hikvision MVS（机器视觉软件），下载地址: https://www.hikrobotics.com/cn/machinevision/service/download/",
            )
            return
        else:
            self._add(
                name="MVS SDK 根目录",
                passed=True,
                level="ok",
                message=f"MVS SDK 路径存在: {sdk_path}",
                detail="",
            )

        # 检查 Python MvImport 目录
        if not import_path.exists():
            self._add(
                name="MVS Python 接口",
                passed=False,
                level="error",
                message=f"Python MvImport 目录不存在: {import_path}",
                detail="请确认 MVS 安装时勾选了 Development → Python Samples 组件",
            )
            return
        else:
            self._add(
                name="MVS Python 接口",
                passed=True,
                level="ok",
                message=f"MvImport 路径存在: {import_path}",
                detail="",
            )

        # 检查关键 Python 接口文件
        mvimport_dir = import_path
        key_files = [
            "MvCameraControl_class.py",
            "CameraParams_header.py",
            "PixelType_header.py",
        ]
        missing = [f for f in key_files if not (mvimport_dir / f).exists()]
        if missing:
            self._add(
                name="MVS 接口文件",
                passed=False,
                level="error",
                message=f"缺少关键文件: {', '.join(missing)}",
                detail="MVS Python 接口安装不完整，请重装 MVS 并勾选 Development -> Python Samples",
            )
        else:
            self._add(
                name="MVS 接口文件",
                passed=True,
                level="ok",
                message=f"关键接口文件完整（{len(key_files)} 个）",
                detail="",
            )

    def _check_import(self):
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
                "1. Python 位数与 MVS SDK 不匹配（需要同为 32 位或同为 64 位）\n"
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

    def to_dict(self):
        """转为前端可用的字典"""
        errors = [r for r in self.results if r.level == "error" and not r.passed]
        warnings = [r for r in self.results if r.level == "warning" and not r.passed]
        all_passed = len(errors) == 0

        return {
            "passed": all_passed,
            "errorCount": len(errors),
            "warningCount": len(warnings),
            "summary": "环境检测通过"
            if all_passed
            else f"发现 {len(errors)} 个问题需要解决",
            "results": [
                {
                    "name": r.name,
                    "passed": r.passed,
                    "level": r.level,
                    "message": r.message,
                    "detail": r.detail,
                }
                for r in self.results
            ],
        }

    def can_proceed(self):
        """是否允许继续启动（致命错误返回 False）"""
        for r in self.results:
            if r.level == "error" and not r.passed:
                return False
        return True


# ========== 便捷函数 ==========


def run_environment_check():
    """运行环境检测并返回结果字典"""
    checker = EnvironmentChecker()
    return checker.run_all()

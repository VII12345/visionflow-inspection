"""MVS SDK 路径环境检查。"""

from pathlib import Path

from ..config import Config


class MVSChecker:
    """MVS SDK 根目录、Python 接口目录与关键文件检查。"""

    def __init__(self, add):
        self._add = add

    def check(self):
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

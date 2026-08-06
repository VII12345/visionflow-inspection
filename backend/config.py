"""
配置管理 - 跨平台兼容
"""

import os
import platform
import sys
from pathlib import Path

# 训练/测试/照片扫描共用的图片扩展名（单一来源）
IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"})


class _LazyDevice:
    """首次读取时检测推理/训练设备并缓存。

    避免 import config 就强制加载 torch。设备偏好在启动时由
    settings_repository 用持久化配置覆盖，此处先给 torch 探测的默认值。
    """

    _cache: dict[str, str] = {}

    def __init__(self, attr: str):
        self.attr = attr

    def __get__(self, instance, owner):
        value = self._cache.get(self.attr)
        if value is None:
            import torch

            value = "cuda" if torch.cuda.is_available() else "cpu"
            self._cache[self.attr] = value
        return value

    def __set__(self, instance, value):
        self._cache[self.attr] = value


class Config:
    """系统配置"""

    # ========== 平台检测 ==========
    IS_WINDOWS = platform.system() == "Windows"
    IS_WSL = "microsoft" in platform.uname().release.lower()

    # ========== MVS SDK 路径 ==========
    if IS_WINDOWS:
        MVS_SDK_PATH = r"C:\Program Files (x86)\MVS"
        PYTHON_IMPORT_PATH = (
            r"C:\Program Files (x86)\MVS\Development\Samples\Python\MvImport"
        )
    else:
        # WSL 开发环境
        MVS_SDK_PATH = "/mnt/c/Program Files (x86)/MVS"
        PYTHON_IMPORT_PATH = (
            "/mnt/c/Program Files (x86)/MVS/Development/Samples/Python/MvImport"
        )

    # 模拟相机：打包后的 exe 不读取 PYTHONPATH，需用 FAKE_MVS_DIR 显式指向
    # simulator 目录，使 import MvCameraControl_class 命中模拟替身。
    # 开发环境仍可用 PYTHONPATH=simulator；两者都不设则走真实 MVS SDK。
    FAKE_MVS_DIR = os.environ.get("FAKE_MVS_DIR", "").strip() or None

    # ========== Flask 服务 ==========
    # Web 模式默认监听所有网卡，允许局域网浏览器访问；可用 VISION_FLASK_HOST 覆盖。
    FLASK_HOST = os.environ.get("VISION_FLASK_HOST", "0.0.0.0")
    FLASK_PORT = int(os.environ.get("VISION_FLASK_PORT", "5000"))
    FLASK_DEBUG = False

    # ========== 登录鉴权 ==========
    # 默认关闭以兼容现有局域网无鉴权部署；启用后除 /api/auth/login、/api/health、静态资源外
    # 均需校验 Authorization: Bearer <token>。可通过 VISION_AUTH_ENABLED 环境变量开启。
    AUTH_ENABLED = os.environ.get("VISION_AUTH_ENABLED", "0") in ("1", "true", "True", "yes", "on")

    # ========== 相机配置 ==========
    CAMERA_COUNT = 4
    MIN_CAMERA_COUNT = 1
    MAX_CAMERA_COUNT = 16
    CAMERA_TIMEOUT_MS = 1000  # 抓帧超时（毫秒）- 连续模式
    CAMERA_TRIGGER_TIMEOUT_MS = 30000  # 触发模式等待超时（毫秒）- 等待传感器信号
    CAMERA_FPS_TARGET = 2.0  # 目标帧率（连续模式用）

    # ========== 推理配置 ==========
    INFERENCE_QUEUE_SIZE = 20
    INFERENCE_BATCH_SIZE = 1

    # 推理/训练设备：首次访问时按 torch 探测默认值，启动时由持久化配置覆盖
    DEVICE = _LazyDevice("DEVICE")
    TRAINING_DEVICE = _LazyDevice("TRAINING_DEVICE")

    # 模型路径优先级：
    # 模型路径在 DATA_DIR 确定后动态计算（见下方 get_active_model_path）

    # ========== 存储配置 ==========
    # 数据目录优先级：环境变量 > exe同目录(打包) > 项目根目录(开发)
    _ENV_DATA_DIR = os.environ.get("VISION_DATA_DIR")
    if _ENV_DATA_DIR:
        DATA_DIR = Path(_ENV_DATA_DIR)
    elif getattr(sys, "frozen", False):
        DATA_DIR = Path(sys.executable).parent / "data"
    else:
        DATA_DIR = Path(__file__).parent.parent / "data"
    CAPTURE_DIR = DATA_DIR / "captures"
    CONFIG_FILE = DATA_DIR / "backend_config.json"
    CAMERA_CONFIG_FILE = DATA_DIR / 'camera_config.json'
    PLC_CONFIG_FILE = DATA_DIR / 'plc_config.json'
    LINE_COUNT_FILE = DATA_DIR / 'line_count.json'
    LOG_DIR = DATA_DIR / "logs"
    # 旧路径仅用于迁移：改造前日志直接写在 data 根目录，启动时挪进 LOG_DIR 归档
    LOG_FILE = DATA_DIR / "vision_system.log"
    LOG_ERROR_FILE = DATA_DIR / "vision_system_error.log"

    # ========== LECPServer 自动启动 ==========
    # 应用启动时后端在后台自动拉起 LECPServer.exe（隐藏窗口），退出时关闭。
    LECPSERVER_AUTO_START = os.environ.get("LECPSERVER_AUTO_START", "1") not in ("0", "false", "False", "no", "off")
    LECPSERVER_EXE = os.environ.get("LECPSERVER_EXE", "").strip() or None  # 绝对路径到 exe
    LECPSERVER_DIR = os.environ.get("LECPSERVER_DIR", "").strip() or None  # 含 LECPServer.exe 的目录
    LECPSERVER_HOST = os.environ.get("LECPSERVER_HOST", "127.0.0.1")
    LECPSERVER_PORT = int(os.environ.get("LECPSERVER_PORT", "8088"))
    LECPSERVER_READY_TIMEOUT = int(os.environ.get("LECPSERVER_READY_TIMEOUT", "60"))
    # hide=完全隐藏（任务栏也不留）；minimize=最小化到任务栏。默认 hide。
    LECPSERVER_HIDE_MODE = os.environ.get("LECPSERVER_HIDE_MODE", "hide")  # "hide" | "minimize"
    LECPSERVER_HIDE_INTERVAL = float(os.environ.get("LECPSERVER_HIDE_INTERVAL", "3"))  # 持续压制间隔（秒）
    LECPSERVER_PID_FILE = DATA_DIR / "lecpserver.pid"

    # 活跃模型：优先用 data/ 下已训练的任意产品模型，否则用种子模型
    @classmethod
    def get_active_model_path(cls, model_name=None):
        """获取模型路径。指定 model_name 时精确匹配（找不到返回 None），否则用第一个已训练的。"""
        trained = sorted(cls.DATA_DIR.glob("*_classifier_*.pth"))
        if model_name:
            return next(
                (p for p in trained if p.stem.rsplit("_classifier_", 1)[-1] == model_name),
                None,
            )
        return trained[0] if trained else None

    # ========== 照片管理 ==========
    MAX_PHOTO_AGE_DAYS = 30
    PHOTO_RETENTION_COUNT = 1000  # 每个相机最多保留照片数
    PHOTO_CLEANUP_INTERVAL = 3600  # 清理间隔（秒）

    # ========== 训练配置 ==========
    TRAINING_EPOCHS = 100
    TRAINING_EARLY_STOP = 15
    TRAINING_BATCH_SIZE = 16
    TRAINING_LR = 0.001
    TRAINING_FINETUNE_LR = 0.0001
    TRAINING_FREEZE_EPOCHS = 10

    @classmethod
    def ensure_directories(cls):
        """确保必要的目录存在"""
        cls.DATA_DIR.mkdir(exist_ok=True)
        cls.CAPTURE_DIR.mkdir(exist_ok=True)
        for i in range(1, cls.CAMERA_COUNT + 1):
            (cls.CAPTURE_DIR / f"cam{i}").mkdir(exist_ok=True)

    @classmethod
    def get_mvs_import_path(cls):
        """获取 MVS Python 导入路径"""
        if os.path.exists(cls.PYTHON_IMPORT_PATH):
            return cls.PYTHON_IMPORT_PATH
        # 如果找不到，尝试环境变量
        env_path = os.getenv("MVCAM_COMMON_RUNENV")
        if env_path:
            import_path = os.path.join(
                env_path, "Development", "Samples", "Python", "MvImport"
            )
            if os.path.exists(import_path):
                return import_path
        return None

    @classmethod
    def get_mvs_runtime_paths(cls):
        """获取 MVS 原生 DLL 搜索路径"""
        runtime_base = Path(r"C:\Program Files (x86)\Common Files\MVS\Runtime")
        if not runtime_base.exists():
            return []

        if sys.maxsize > 2**32:
            candidates = [
                runtime_base / "Win64_x64",
                runtime_base / "Win64",
                runtime_base / "x64",
            ]
        else:
            candidates = [
                runtime_base / "Win32_x86",
                runtime_base / "Win32",
                runtime_base / "x86",
            ]

        return [str(path) for path in candidates if path.exists()]

    @classmethod
    def prepare_mvs_runtime_paths(cls):
        """把 MVS 原生 DLL 目录加入进程搜索路径"""
        runtime_paths = cls.get_mvs_runtime_paths()
        if not runtime_paths:
            return []

        current_path = os.environ.get("PATH", "")
        for runtime_path in reversed(runtime_paths):
            if runtime_path not in current_path:
                current_path = (
                    f"{runtime_path};{current_path}" if current_path else runtime_path
                )
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(runtime_path)

        os.environ["PATH"] = current_path
        return runtime_paths

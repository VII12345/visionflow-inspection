"""
配置管理 - 跨平台兼容
"""

import os
import platform
import sys
from pathlib import Path


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

    # ========== Flask 服务 ==========
    FLASK_HOST = "127.0.0.1"
    FLASK_PORT = 5000
    FLASK_DEBUG = False

    # ========== 相机配置 ==========
    CAMERA_COUNT = 4
    CAMERA_TIMEOUT_MS = 1000  # 抓帧超时（毫秒）- 连续模式
    CAMERA_TRIGGER_TIMEOUT_MS = 30000  # 触发模式等待超时（毫秒）- 等待传感器信号
    CAMERA_FPS_TARGET = 2.0  # 目标帧率（连续模式用）

    # ========== 推理配置 ==========
    INFERENCE_QUEUE_SIZE = 20
    INFERENCE_BATCH_SIZE = 1
    import torch

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    TRAINING_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    # 从持久化配置加载设备偏好（如果存在）
    @classmethod
    def load_device_config(cls):
        import json

        device_cfg = cls.DATA_DIR / "device_config.json"
        if device_cfg.exists():
            try:
                with open(device_cfg, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                valid = ["cpu"]
                import torch

                if torch.cuda.is_available():
                    valid.append("cuda")
                td = cfg.get("training_device", cls.TRAINING_DEVICE)
                idd = cfg.get("inference_device", cls.DEVICE)
                if td in valid:
                    cls.TRAINING_DEVICE = td
                if idd in valid:
                    cls.DEVICE = idd
            except Exception:
                pass

    # 模型路径优先级：
    # 1) 数据目录下已训练的模型（持久化，exe 同目录）
    # 2) PyInstaller 打包内嵌的种子模型
    # 3) 开发模式项目根目录
    if getattr(sys, "frozen", False):
        _SEED_MODEL = Path(sys._MEIPASS) / "jar_classifier.pth"
    else:
        _SEED_MODEL = Path(__file__).parent.parent / "jar_classifier.pth"

    # MODEL_PATH 在 DATA_DIR 确定后动态计算（见下方）

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
    CAMERA_CONFIG_FILE = DATA_DIR / "camera_config.json"
    LOG_FILE = DATA_DIR / "vision_system.log"

    # 活跃模型：优先用 data/ 下已训练的任意产品模型，否则用种子模型
    @classmethod
    def get_active_model_path(cls, model_name=None):
        """获取模型路径。指定 model_name 则用对应产品模型，否则用第一个已训练的。"""
        if model_name:
            p = cls.DATA_DIR / f"jar_classifier_{model_name}.pth"
            if p.exists():
                return p
        # 扫描所有已训练的模型
        trained = sorted(cls.DATA_DIR.glob("jar_classifier_*.pth"))
        if trained:
            return trained[0]
        return cls._SEED_MODEL

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

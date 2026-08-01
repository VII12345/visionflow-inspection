"""服务器启动编排：配置加载、环境检测、相机初始化与后台清理线程。"""

import threading
import time

from .config import Config
from .logger import logger
from .server import app
from .camera_run_service import initialize_camera_manager
from .inference_worker import start_inference_worker
from .model_loader import preload_all_models
from .env_check import run_environment_check
from .capture_service import cleanup_photos, start_save_worker
from .runtime_state import runtime
from .user_repository import ensure_users_file
from .system_routes import apply_line_count as _apply_line_count
from .settings_repository import (
    load_device_config as _load_device_config,
    load_line_count as _load_line_count,
    load_save_only_reject as _load_save_only_reject,
)


def run_server():
    """启动 Flask 服务器"""

    # 启动前加载线体数量，确保环境检测和相机槽位与前端设置一致
    try:
        _apply_line_count(_load_line_count())
    except Exception as e:
        logger.warning(f"加载线体数量失败，使用默认值: {e}")

    Config.ensure_directories()

    # 初始化用户文件（首次启动创建默认管理员并提示初始密码）
    ensure_users_file()

    # 加载"仅保存剔除照片"全局开关
    runtime.save_only_reject = _load_save_only_reject()

    # ========== 加载已保存的设备配置 ==========
    try:
        saved_cfg = _load_device_config()
        td = saved_cfg.get("training_device", Config.TRAINING_DEVICE)
        idd = saved_cfg.get("inference_device", Config.DEVICE)
        import torch as _torch

        valid_devices = ["cpu"]
        if _torch.cuda.is_available():
            valid_devices.append("cuda")
        if td in valid_devices:
            Config.TRAINING_DEVICE = td
        if idd in valid_devices:
            Config.DEVICE = idd
        # 同步训练模块的全局设备
        from .training import set_training_device

        set_training_device(Config.TRAINING_DEVICE)
        logger.info(
            f"已加载设备配置: 训练={Config.TRAINING_DEVICE}, 推理={Config.DEVICE}"
        )
    except Exception as e:
        logger.warning(f"加载设备配置失败，使用默认值: {e}")

    # ========== 环境检测 ==========
    logger.info("正在运行环境检测...")
    runtime.env_check_result = run_environment_check()

    if runtime.env_check_result["passed"]:
        logger.info("环境检测通过，继续初始化相机管理器")
    else:
        logger.warning(
            f"环境检测未通过: {runtime.env_check_result['errorCount']} 个错误, "
            f"{runtime.env_check_result['warningCount']} 个警告"
        )
        logger.warning("环境检测存在问题，但仍尝试初始化相机管理器...")

    try:
        initialize_camera_manager()
    except Exception as e:
        logger.error(f"相机管理器初始化失败: {e}")
        logger.warning("相机功能将不可用，服务器将在受限模式下运行")

    # 启动前预加载并预热全部已训练模型，避免第一张图片承担模型/CUDA初始化耗时。
    try:
        preload_all_models()
    except Exception as e:
        logger.warning(f"模型启动预加载失败，首次识别时将按需加载: {e}")

    # 启动推理 worker
    start_inference_worker()

    # 启动异步存盘 worker
    start_save_worker()

    # 启动时运行一次照片清理
    cleanup_photos()

    # 启动定期照片清理线程
    def _cleanup_loop():
        while True:
            time.sleep(Config.PHOTO_CLEANUP_INTERVAL)
            cleanup_photos()

    cleanup_thread = threading.Thread(target=_cleanup_loop, daemon=True)
    cleanup_thread.start()

    logger.info(f"Flask 服务器启动: {Config.FLASK_HOST}:{Config.FLASK_PORT}")
    app.run(
        host=Config.FLASK_HOST,
        port=Config.FLASK_PORT,
        debug=Config.FLASK_DEBUG,
        threaded=True,
    )

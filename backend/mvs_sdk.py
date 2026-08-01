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

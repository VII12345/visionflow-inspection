"""硬件与环境遥测采集与达标评估。"""

import platform
import torch

from .config import Config
from .hardware_checks import evaluate_hardware_checks
from .hardware_collectors import (
    collect_cpu_info,
    collect_disk_info,
    collect_gpu_info,
    collect_memory_info,
    collect_network_info,
    collect_system_info,
)


def collect_hardware_info():
    """返回详细的 CPU/GPU/内存/硬盘 硬件信息，供前端展示和选择。"""
    info = {
        "system": collect_system_info(),
        "cpu": collect_cpu_info(platform.system()),
        "memory": collect_memory_info(platform.system()),
        "gpu": collect_gpu_info(),
        "disk": collect_disk_info(),
        "network": collect_network_info(platform.system()),
        "pytorch_version": torch.__version__,
        "training_device": getattr(Config, "TRAINING_DEVICE", Config.DEVICE),
        "inference_device": Config.DEVICE,
    }
    info["checks"] = evaluate_hardware_checks(info)
    return info

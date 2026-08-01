"""硬件信息采集：系统、CPU、内存、磁盘、网络和 GPU（聚合入口）。"""

import platform

from .hardware.cpu_collector import collect_cpu_info
from .hardware.disk_collector import collect_disk_info
from .hardware.gpu_collector import collect_gpu_info
from .hardware.memory_collector import collect_memory_info
from .hardware.network_collector import collect_network_info


def collect_system_info():
    """采集操作系统基础信息。"""
    return {
        "os": platform.system(),
        "os_version": platform.version(),
        "os_release": platform.release(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
    }

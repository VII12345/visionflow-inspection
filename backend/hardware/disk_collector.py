"""磁盘硬件信息采集。"""

from pathlib import Path


def collect_disk_info():
    """采集项目所在磁盘的使用情况。"""
    disk = {
        "project_drive": None,
        "total_gb": None,
        "used_gb": None,
        "free_gb": None,
        "percent": None,
        "filesystem": None,
    }
    try:
        import psutil

        project_path = Path(__file__).resolve().parents[2]
        disk_usage = psutil.disk_usage(str(project_path))
        disk["project_drive"] = (
            str(project_path.drive) if hasattr(project_path, "drive") else str(project_path)
        )
        disk["total_gb"] = round(disk_usage.total / (1024 ** 3), 1)
        disk["used_gb"] = round(disk_usage.used / (1024 ** 3), 1)
        disk["free_gb"] = round(disk_usage.free / (1024 ** 3), 1)
        disk["percent"] = disk_usage.percent
        try:
            for part in psutil.disk_partitions():
                if str(project_path).startswith(part.mountpoint):
                    disk["filesystem"] = part.fstype
                    break
        except Exception:
            pass
    except ImportError:
        pass
    return disk

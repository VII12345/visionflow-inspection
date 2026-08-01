"""内存硬件信息采集。"""

import subprocess


def _detect_memory_speed(system_name):
    """按平台探测内存频率。"""
    mem_speed = None
    try:
        if system_name == "Windows":
            try:
                result = subprocess.run(
                    ["powershell", "-Command", "(Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1).Speed"],
                    capture_output=True,
                    text=True,
                    errors="replace",
                    timeout=5,
                )
                value = result.stdout.strip()
                if value and value.isdigit():
                    mem_speed = int(value)
            except Exception:
                pass
            if not mem_speed:
                try:
                    result = subprocess.run(
                        ["wmic", "memorychip", "get", "speed"],
                        capture_output=True,
                        text=True,
                        errors="replace",
                        timeout=5,
                    )
                    for line in result.stdout.split("\n"):
                        line = line.strip()
                        if line.isdigit():
                            mem_speed = int(line)
                            break
                except Exception:
                    pass
        elif system_name == "Linux":
            try:
                result = subprocess.run(
                    ["dmidecode", "-t", "memory"],
                    capture_output=True,
                    text=True,
                    errors="replace",
                    timeout=5,
                )
                for line in result.stdout.split("\n"):
                    if "Speed:" in line and "MHz" in line:
                        value = line.split(":")[1].strip().split()[0]
                        if value.isdigit():
                            mem_speed = int(value)
                            break
            except Exception:
                pass
    except Exception:
        pass
    return mem_speed


def collect_memory_info(system_name):
    """采集内存总量、可用量和频率。"""
    memory = {
        "total_gb": None,
        "available_gb": None,
        "used_gb": None,
        "percent": None,
        "speed_mhz": None,
    }
    try:
        import psutil

        mem = psutil.virtual_memory()
        memory["total_gb"] = round(mem.total / (1024 ** 3), 1)
        memory["available_gb"] = round(mem.available / (1024 ** 3), 1)
        memory["used_gb"] = round(mem.used / (1024 ** 3), 1)
        memory["percent"] = mem.percent
        memory["speed_mhz"] = _detect_memory_speed(system_name)
    except ImportError:
        pass
    return memory

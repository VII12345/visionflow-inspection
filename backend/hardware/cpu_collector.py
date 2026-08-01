"""CPU 硬件信息采集。"""

import platform
import subprocess


def _detect_cpu_model(system_name):
    """按平台探测 CPU 型号，多种来源按可靠性从高到低尝试。"""
    cpu_model = None
    try:
        if system_name == "Windows":
            try:
                import winreg

                key = winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
                )
                cpu_model, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                winreg.CloseKey(key)
            except Exception:
                pass

            if not cpu_model:
                try:
                    result = subprocess.run(
                        ["powershell", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                        capture_output=True,
                        text=True,
                        errors="replace",
                        timeout=5,
                    )
                    value = result.stdout.strip()
                    if value:
                        cpu_model = value
                except Exception:
                    pass

            if not cpu_model:
                try:
                    result = subprocess.run(
                        ["wmic", "cpu", "get", "name"],
                        capture_output=True,
                        text=True,
                        errors="replace",
                        timeout=5,
                    )
                    lines = [
                        line.strip()
                        for line in result.stdout.split("\n")
                        if line.strip() and line.strip() != "Name"
                    ]
                    if lines:
                        cpu_model = lines[0]
                except Exception:
                    pass
        elif system_name == "Linux":
            result = subprocess.run(
                ["cat", "/proc/cpuinfo"],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=5,
            )
            for line in result.stdout.split("\n"):
                if "model name" in line:
                    cpu_model = line.split(":")[1].strip()
                    break
        elif system_name == "Darwin":
            result = subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=5,
            )
            cpu_model = result.stdout.strip()
    except Exception:
        pass
    return cpu_model or None


def collect_cpu_info(system_name):
    """采集 CPU 核心、频率、使用率和型号。"""
    cpu = {
        "model": None,
        "physical_cores": None,
        "logical_cores": None,
        "max_freq_mhz": None,
        "current_freq_mhz": None,
        "arch": platform.machine(),
        "usage_percent": None,
    }
    try:
        import psutil

        cpu["physical_cores"] = psutil.cpu_count(logical=False)
        cpu["logical_cores"] = psutil.cpu_count(logical=True)
        cpu["usage_percent"] = psutil.cpu_percent(interval=0.1)

        freq = psutil.cpu_freq()
        if freq:
            cpu["current_freq_mhz"] = round(freq.current, 1) if freq.current else None
            cpu["max_freq_mhz"] = round(freq.max, 1) if freq.max else None

        cpu["model"] = _detect_cpu_model(system_name)
    except ImportError:
        cpu["cores"] = None
        cpu["model"] = platform.processor() or None
    return cpu

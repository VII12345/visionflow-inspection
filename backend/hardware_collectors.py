"""硬件信息采集：系统、CPU、内存、磁盘、网络和 GPU。"""

import platform
import subprocess
from pathlib import Path


def collect_system_info():
    """采集操作系统基础信息。"""
    return {
        "os": platform.system(),
        "os_version": platform.version(),
        "os_release": platform.release(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
    }


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

        project_path = Path(__file__).resolve().parent.parent
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


def _collect_wifi_rates():
    """Windows netsh 获取 WiFi 真实协商速率。"""
    wifi_rates = {}
    try:
        result = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
        )
        current_name = None
        for line in result.stdout.split("\n"):
            stripped = line.strip()
            if "名称" in stripped and ":" in stripped:
                current_name = stripped.split(":", 1)[1].strip()
            elif "接收速率" in stripped and ":" in stripped:
                value = stripped.split(":", 1)[1].strip().split()[0]
                if current_name and value.isdigit():
                    wifi_rates.setdefault(current_name.lower(), {})["rx_mbps"] = int(value)
            elif "传输速率" in stripped and ":" in stripped:
                value = stripped.split(":", 1)[1].strip().split()[0]
                if current_name and value.isdigit():
                    wifi_rates.setdefault(current_name.lower(), {})["tx_mbps"] = int(value)
    except Exception:
        pass
    return wifi_rates


def _collect_ethernet_speeds():
    """Windows PowerShell 获取以太网真实链路速率。"""
    eth_speeds = {}
    try:
        result = subprocess.run(
            ["powershell", "-Command", "Get-NetAdapter | Select-Object Name,LinkSpeed | ConvertTo-Json -Compress"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
        )
        import json

        adapters = json.loads(result.stdout.strip())
        if isinstance(adapters, dict):
            adapters = [adapters]
        for adapter in adapters:
            name = adapter.get("Name", "")
            speed = adapter.get("LinkSpeed", 0)
            if name and speed:
                eth_speeds[name.lower()] = round(speed / 1_000_000)
    except Exception:
        pass
    return eth_speeds


def _classify_interface(name, normalized):
    """根据名称推断网络接口类型。"""
    if "wi" in normalized or "wlan" in normalized or "无线" in name:
        return "WiFi"
    if "蓝牙" in name or "bluetooth" in normalized:
        return "蓝牙"
    if (
        "虚拟" in name
        or "virtual" in normalized
        or "vmware" in normalized
        or "vethernet" in normalized
        or "hyper" in normalized
    ):
        return "虚拟"
    if "tailscale" in normalized or "vpn" in normalized or "tun" in normalized:
        return "VPN"
    return "以太网"


def collect_network_info(system_name):
    """采集各网络接口的状态、速率和 IPv4 地址。"""
    network = []
    try:
        import psutil

        if_addrs = psutil.net_if_addrs()
        if_stats = psutil.net_if_stats()
        wifi_rates = _collect_wifi_rates() if system_name == "Windows" else {}
        eth_speeds = _collect_ethernet_speeds() if system_name == "Windows" else {}

        for name, stats in if_stats.items():
            normalized = name.lower()
            if normalized.startswith("loopback"):
                continue

            addrs = if_addrs.get(name, [])
            ipv4_list = [addr.address for addr in addrs if addr.family.name == "AF_INET"]
            if_type = _classify_interface(name, normalized)

            base_speed = stats.speed if stats.speed and stats.speed > 0 else None
            rx_mbps = None
            tx_mbps = None
            if if_type == "WiFi" and normalized in wifi_rates:
                rx_mbps = wifi_rates[normalized].get("rx_mbps")
                tx_mbps = wifi_rates[normalized].get("tx_mbps")
                if rx_mbps or tx_mbps:
                    base_speed = rx_mbps or tx_mbps
            if if_type == "以太网" and normalized in eth_speeds:
                base_speed = eth_speeds[normalized]

            entry = {
                "name": name,
                "type": if_type,
                "up": stats.isup,
                "speed_mbps": base_speed,
                "ipv4": ipv4_list,
            }
            if rx_mbps is not None or tx_mbps is not None:
                entry["speed_rx_mbps"] = rx_mbps
                entry["speed_tx_mbps"] = tx_mbps
            network.append(entry)
    except ImportError:
        pass
    return network


def collect_gpu_info():
    """采集 CUDA GPU 名称、显存和算力。"""
    import torch

    gpu = {
        "name": None,
        "memory_total_mb": None,
        "memory_free_mb": None,
        "memory_used_mb": None,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda if torch.cuda.is_available() else None,
        "count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "compute_capability": None,
    }
    if torch.cuda.is_available():
        try:
            gpu["name"] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            gpu["memory_total_mb"] = round(props.total_memory / 1024 / 1024)
            gpu["compute_capability"] = f"{props.major}.{props.minor}"

            try:
                import pynvml

                pynvml.nvmlInit()
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                gpu["memory_total_mb"] = round(mem_info.total / 1024 / 1024)
                gpu["memory_free_mb"] = round(mem_info.free / 1024 / 1024)
                gpu["memory_used_mb"] = round(mem_info.used / 1024 / 1024)
                pynvml.nvmlShutdown()
            except (ImportError, Exception):
                try:
                    import torch.cuda

                    free_mem, total_mem = torch.cuda.mem_get_info(0)
                    gpu["memory_total_mb"] = round(total_mem / 1024 / 1024)
                    gpu["memory_free_mb"] = round(free_mem / 1024 / 1024)
                    gpu["memory_used_mb"] = round((total_mem - free_mem) / 1024 / 1024)
                except Exception:
                    pass
        except Exception:
            pass
    return gpu

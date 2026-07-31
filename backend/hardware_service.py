"""Hardware and environment telemetry collection."""

from pathlib import Path

from .config import Config


def collect_hardware_info():
    """返回详细的 CPU/GPU/内存/硬盘 硬件信息，供前端展示和选择"""
    import torch
    import platform

    info = {
        "system": {
            "os": platform.system(),
            "os_version": platform.version(),
            "os_release": platform.release(),
            "hostname": platform.node(),
            "python_version": platform.python_version(),
        },
        "cpu": {
            "model": None,
            "physical_cores": None,
            "logical_cores": None,
            "max_freq_mhz": None,
            "current_freq_mhz": None,
            "arch": platform.machine(),
            "usage_percent": None,
        },
        "memory": {
            "total_gb": None,
            "available_gb": None,
            "used_gb": None,
            "percent": None,
            "speed_mhz": None,
        },
        "gpu": {
            "name": None,
            "memory_total_mb": None,
            "memory_free_mb": None,
            "memory_used_mb": None,
            "cuda_available": torch.cuda.is_available(),
            "cuda_version": torch.version.cuda if torch.cuda.is_available() else None,
            "count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "compute_capability": None,
        },
        "disk": {
            "project_drive": None,
            "total_gb": None,
            "used_gb": None,
            "free_gb": None,
            "percent": None,
            "filesystem": None,
        },
        "network": [],
        "pytorch_version": torch.__version__,
        "training_device": getattr(Config, "TRAINING_DEVICE", Config.DEVICE),
        "inference_device": Config.DEVICE,
    }

    try:
        import psutil

        # --- CPU ---
        info["cpu"]["physical_cores"] = psutil.cpu_count(logical=False)
        info["cpu"]["logical_cores"] = psutil.cpu_count(logical=True)
        info["cpu"]["usage_percent"] = psutil.cpu_percent(interval=0.1)

        # CPU frequency
        freq = psutil.cpu_freq()
        if freq:
            info["cpu"]["current_freq_mhz"] = (
                round(freq.current, 1) if freq.current else None
            )
            info["cpu"]["max_freq_mhz"] = round(freq.max, 1) if freq.max else None

        # CPU model — try multiple sources (most reliable first)
        cpu_model = None
        try:
            import subprocess

            if platform.system() == "Windows":
                # Method 1: Windows Registry (most reliable on Win10/11)
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

                # Method 2: PowerShell (fallback if registry fails)
                if not cpu_model:
                    try:
                        result = subprocess.run(
                            [
                                "powershell",
                                "-Command",
                                "(Get-CimInstance Win32_Processor).Name",
                            ],
                            capture_output=True,
                            text=True,
                            errors="replace",
                            timeout=5,
                        )
                        val = result.stdout.strip()
                        if val:
                            cpu_model = val
                    except Exception:
                        pass

                # Method 3: wmic (deprecated but works on older systems)
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
                            l.strip()
                            for l in result.stdout.split("\n")
                            if l.strip() and l.strip() != "Name"
                        ]
                        if lines:
                            cpu_model = lines[0]
                    except Exception:
                        pass

            elif platform.system() == "Linux":
                result = subprocess.run(
                    ["cat", "/proc/cpuinfo"], capture_output=True, text=True,
                    errors="replace", timeout=5
                )
                for line in result.stdout.split("\n"):
                    if "model name" in line:
                        cpu_model = line.split(":")[1].strip()
                        break

            elif platform.system() == "Darwin":
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

        info["cpu"]["model"] = cpu_model or None

        # --- Memory (RAM) ---
        mem = psutil.virtual_memory()
        info["memory"]["total_gb"] = round(mem.total / (1024**3), 1)
        info["memory"]["available_gb"] = round(mem.available / (1024**3), 1)
        info["memory"]["used_gb"] = round(mem.used / (1024**3), 1)
        info["memory"]["percent"] = mem.percent

        # Memory speed (via platform-specific detection)
        try:
            import subprocess

            mem_speed = None
            if platform.system() == "Windows":
                # Try PowerShell first (most reliable on Win10/11)
                try:
                    result = subprocess.run(
                        [
                            "powershell",
                            "-Command",
                            "(Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1).Speed",
                        ],
                        capture_output=True,
                        text=True,
                        errors="replace",
                        timeout=5,
                    )
                    val = result.stdout.strip()
                    if val and val.isdigit():
                        mem_speed = int(val)
                except Exception:
                    pass
                # Fallback to wmic
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
            elif platform.system() == "Linux":
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
                            val = line.split(":")[1].strip().split()[0]
                            if val.isdigit():
                                mem_speed = int(val)
                                break
                except Exception:
                    pass
            info["memory"]["speed_mhz"] = mem_speed
        except Exception:
            pass

        # --- Disk (project drive) ---
        project_path = Path(__file__).resolve().parent.parent  # 项目根目录
        disk_usage = psutil.disk_usage(str(project_path))
        info["disk"]["project_drive"] = (
            str(project_path.drive)
            if hasattr(project_path, "drive")
            else str(project_path)
        )
        info["disk"]["total_gb"] = round(disk_usage.total / (1024**3), 1)
        info["disk"]["used_gb"] = round(disk_usage.used / (1024**3), 1)
        info["disk"]["free_gb"] = round(disk_usage.free / (1024**3), 1)
        info["disk"]["percent"] = disk_usage.percent
        # 获取文件系统类型 (仅 Linux)
        try:
            for part in psutil.disk_partitions():
                if str(project_path).startswith(part.mountpoint):
                    info["disk"]["filesystem"] = part.fstype
                    break
        except Exception:
            pass

        # --- Network ---
        try:
            if_addrs = psutil.net_if_addrs()
            if_stats = psutil.net_if_stats()

            # 预先收集 WiFi 真实速率（Windows netsh）
            wifi_rates = {}  # {adapter_name_lower: {rx_mbps, tx_mbps}}
            if platform.system() == "Windows":
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
                        line_stripped = line.strip()
                        if "名称" in line_stripped and ":" in line_stripped:
                            current_name = line_stripped.split(":", 1)[1].strip()
                        elif "接收速率" in line_stripped and ":" in line_stripped:
                            val = line_stripped.split(":", 1)[1].strip().split()[0]
                            if current_name and val.isdigit():
                                wifi_rates.setdefault(current_name.lower(), {})[
                                    "rx_mbps"
                                ] = int(val)
                        elif "传输速率" in line_stripped and ":" in line_stripped:
                            val = line_stripped.split(":", 1)[1].strip().split()[0]
                            if current_name and val.isdigit():
                                wifi_rates.setdefault(current_name.lower(), {})[
                                    "tx_mbps"
                                ] = int(val)
                except Exception:
                    pass

            # 预先收集以太网真实速率（Windows PowerShell）
            eth_speeds = {}  # {adapter_name_lower: speed_bps}
            if platform.system() == "Windows":
                try:
                    result = subprocess.run(
                        [
                            "powershell",
                            "-Command",
                            "Get-NetAdapter | Select-Object Name,LinkSpeed | ConvertTo-Json -Compress",
                        ],
                        capture_output=True,
                        text=True,
                        errors="replace",
                        timeout=5,
                    )
                    import json as _json_local

                    adapters = _json_local.loads(result.stdout.strip())
                    if isinstance(adapters, dict):
                        adapters = [adapters]
                    for ad in adapters:
                        name = ad.get("Name", "")
                        speed = ad.get("LinkSpeed", 0)
                        if name and speed:
                            # LinkSpeed is in bps, convert to Mbps
                            eth_speeds[name.lower()] = round(speed / 1_000_000)
                except Exception:
                    pass

            for name, stats in if_stats.items():
                nl = name.lower()

                # 跳过回环接口
                if nl.startswith("loopback"):
                    continue

                addrs = if_addrs.get(name, [])
                ipv4_list = [a.address for a in addrs if a.family.name == "AF_INET"]

                # 判断接口类型
                if "wi" in nl or "wlan" in nl or "无线" in name:
                    if_type = "WiFi"
                elif "蓝牙" in name or "bluetooth" in nl:
                    if_type = "蓝牙"
                elif (
                    "虚拟" in name
                    or "virtual" in nl
                    or "vmware" in nl
                    or "vethernet" in nl
                    or "hyper" in nl
                ):
                    if_type = "虚拟"
                elif "tailscale" in nl or "vpn" in nl or "tun" in nl:
                    if_type = "VPN"
                else:
                    if_type = "以太网"

                # 基础速率 (psutil)
                base_speed = stats.speed if stats.speed and stats.speed > 0 else None

                # WiFi: 使用 netsh 的真实协商速率
                rx_mbps = None
                tx_mbps = None
                if if_type == "WiFi" and nl in wifi_rates:
                    rx_mbps = wifi_rates[nl].get("rx_mbps")
                    tx_mbps = wifi_rates[nl].get("tx_mbps")
                    if rx_mbps or tx_mbps:
                        base_speed = rx_mbps or tx_mbps  # 用 RX 速率覆盖

                # 以太网: 使用 PowerShell Get-NetAdapter 的真实链路速率
                if if_type == "以太网" and nl in eth_speeds:
                    base_speed = eth_speeds[nl]

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

                info["network"].append(entry)
        except Exception:
            pass

    except ImportError:
        info["cpu"]["cores"] = None
        info["cpu"]["model"] = platform.processor() or None

    # --- GPU 详细信息 ---
    if torch.cuda.is_available():
        try:
            info["gpu"]["name"] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            info["gpu"]["memory_total_mb"] = round(props.total_memory / 1024 / 1024)
            info["gpu"]["compute_capability"] = f"{props.major}.{props.minor}"

            # 尝试用 pynvml 获取详细 GPU 信息（显存使用、温度等）
            try:
                import pynvml

                pynvml.nvmlInit()
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                info["gpu"]["memory_total_mb"] = round(mem_info.total / 1024 / 1024)
                info["gpu"]["memory_free_mb"] = round(mem_info.free / 1024 / 1024)
                info["gpu"]["memory_used_mb"] = round(mem_info.used / 1024 / 1024)
                pynvml.nvmlShutdown()
            except (ImportError, Exception):
                # pynvml 不可用时使用 CUDA API 估算
                try:
                    import torch.cuda

                    free_mem, total_mem = torch.cuda.mem_get_info(0)
                    info["gpu"]["memory_total_mb"] = round(total_mem / 1024 / 1024)
                    info["gpu"]["memory_free_mb"] = round(free_mem / 1024 / 1024)
                    info["gpu"]["memory_used_mb"] = round(
                        (total_mem - free_mem) / 1024 / 1024
                    )
                except Exception:
                    pass
        except Exception:
            pass

    # --- 硬件达标检测 ---
    checks = {}

    # CPU 检测: 至少 4 核
    cpu_cores = info["cpu"]["physical_cores"] or info["cpu"]["logical_cores"] or 0
    checks["cpu_cores"] = {
        "label": f"CPU 核心 ({cpu_cores} 核)",
        "pass": cpu_cores >= 4,
        "detail": "需要 ≥ 4 核" if cpu_cores < 4 else f"{cpu_cores} 核 — 满足要求",
    }

    # 内存检测: 总量 ≥ 8 GB，可用 ≥ 2 GB
    mem_total = info["memory"]["total_gb"] or 0
    mem_avail = info["memory"]["available_gb"] or 0
    checks["memory_total"] = {
        "label": f"内存总量 ({mem_total:.0f} GB)",
        "pass": mem_total >= 8,
        "detail": "需要 ≥ 8 GB" if mem_total < 8 else f"{mem_total:.0f} GB — 满足要求",
    }
    checks["memory_available"] = {
        "label": f"内存可用 ({mem_avail:.0f} GB)",
        "pass": mem_avail >= 2,
        "detail": "需要 ≥ 2 GB 空闲"
        if mem_avail < 2
        else f"{mem_avail:.0f} GB — 满足要求",
    }

    # GPU 检测: CUDA 可用
    gpu_ok = info["gpu"]["cuda_available"]
    gpu_mem = info["gpu"]["memory_total_mb"] or 0
    checks["gpu_cuda"] = {
        "label": "CUDA 可用",
        "pass": gpu_ok,
        "detail": "未检测到 CUDA GPU，将使用 CPU 推理（较慢）"
        if not gpu_ok
        else f"{info['gpu']['name'] or 'GPU'} — CUDA {info['gpu']['cuda_version']}",
    }

    # GPU 显存检测: ≥ 4 GB
    if gpu_ok:
        checks["gpu_vram"] = {
            "label": f"GPU 显存 ({gpu_mem / 1024:.1f} GB)",
            "pass": gpu_mem >= 4096,
            "detail": f"需要 ≥ 4 GB，当前 {gpu_mem / 1024:.1f} GB"
            if gpu_mem < 4096
            else f"{gpu_mem / 1024:.1f} GB — 满足要求",
        }

    # CUDA 版本检测: ≥ 11.0
    if gpu_ok and info["gpu"]["cuda_version"]:
        try:
            cuda_ver = float(info["gpu"]["cuda_version"])
            checks["cuda_version"] = {
                "label": f"CUDA 版本 ({info['gpu']['cuda_version']})",
                "pass": cuda_ver >= 11.0,
                "detail": f"需要 CUDA ≥ 11.0" if cuda_ver < 11.0 else "版本满足要求",
            }
        except ValueError:
            pass

    # 硬盘检测: 可用 ≥ 10 GB
    disk_free = info["disk"]["free_gb"] or 0
    checks["disk_free"] = {
        "label": f"硬盘可用 ({disk_free:.0f} GB)",
        "pass": disk_free >= 10,
        "detail": f"需要 ≥ 10 GB，当前仅 {disk_free:.0f} GB"
        if disk_free < 10
        else f"{disk_free:.0f} GB — 满足要求",
    }

    # 网络检测: 至少一个以太网/WiFi 接口速率 ≥ 1000 Mbps
    net_speeds = []
    for iface in info["network"]:
        if iface["type"] not in ("以太网", "WiFi"):
            continue
        if not iface["up"]:
            continue
        speed = iface.get("speed_rx_mbps") or iface.get("speed_mbps") or 0
        net_speeds.append((iface["name"], iface["type"], speed))

    if net_speeds:
        best_name, best_type, best_speed = max(net_speeds, key=lambda x: x[2])
        speed_str = (
            f"{best_speed / 1000:.1f} Gbps"
            if best_speed >= 1000
            else f"{best_speed} Mbps"
        )
        checks["network_speed"] = {
            "label": f"网络速率 ({best_name})",
            "pass": best_speed >= 1000,
            "detail": f"{best_type} {best_name}: {speed_str}"
            + (
                " — 满足千兆要求"
                if best_speed >= 1000
                else f" — 未达千兆，需要 ≥ 1000 Mbps"
            ),
        }
    else:
        checks["network_speed"] = {
            "label": "网络速率",
            "pass": False,
            "detail": "未检测到已连接的网络接口",
        }

    # 综合判断
    all_pass = all(c["pass"] for c in checks.values())
    checks["_all_pass"] = all_pass

    info["checks"] = checks

    return info

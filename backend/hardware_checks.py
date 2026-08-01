"""基于采集结果的硬件达标评估。"""


def evaluate_hardware_checks(info):
    """根据硬件信息生成逐项检查结果和综合结论。"""
    checks = {}

    cpu_cores = info["cpu"]["physical_cores"] or info["cpu"]["logical_cores"] or 0
    checks["cpu_cores"] = {
        "label": f"CPU 核心 ({cpu_cores} 核)",
        "pass": cpu_cores >= 4,
        "detail": "需要 ≥ 4 核" if cpu_cores < 4 else f"{cpu_cores} 核 — 满足要求",
    }

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
        "detail": "需要 ≥ 2 GB 空闲" if mem_avail < 2 else f"{mem_avail:.0f} GB — 满足要求",
    }

    gpu_ok = info["gpu"]["cuda_available"]
    gpu_mem = info["gpu"]["memory_total_mb"] or 0
    checks["gpu_cuda"] = {
        "label": "CUDA 可用",
        "pass": gpu_ok,
        "detail": "未检测到 CUDA GPU，将使用 CPU 推理（较慢）"
        if not gpu_ok
        else f"{info['gpu']['name'] or 'GPU'} — CUDA {info['gpu']['cuda_version']}",
    }
    if gpu_ok:
        checks["gpu_vram"] = {
            "label": f"GPU 显存 ({gpu_mem / 1024:.1f} GB)",
            "pass": gpu_mem >= 4096,
            "detail": f"需要 ≥ 4 GB，当前 {gpu_mem / 1024:.1f} GB"
            if gpu_mem < 4096
            else f"{gpu_mem / 1024:.1f} GB — 满足要求",
        }

    if gpu_ok and info["gpu"]["cuda_version"]:
        try:
            cuda_ver = float(info["gpu"]["cuda_version"])
            checks["cuda_version"] = {
                "label": f"CUDA 版本 ({info['gpu']['cuda_version']})",
                "pass": cuda_ver >= 11.0,
                "detail": "需要 CUDA ≥ 11.0" if cuda_ver < 11.0 else "版本满足要求",
            }
        except ValueError:
            pass

    disk_free = info["disk"]["free_gb"] or 0
    checks["disk_free"] = {
        "label": f"硬盘可用 ({disk_free:.0f} GB)",
        "pass": disk_free >= 10,
        "detail": f"需要 ≥ 10 GB，当前仅 {disk_free:.0f} GB"
        if disk_free < 10
        else f"{disk_free:.0f} GB — 满足要求",
    }

    net_speeds = []
    for iface in info["network"]:
        if iface["type"] not in ("以太网", "WiFi"):
            continue
        if not iface["up"]:
            continue
        speed = iface.get("speed_rx_mbps") or iface.get("speed_mbps") or 0
        net_speeds.append((iface["name"], iface["type"], speed))

    if net_speeds:
        best_name, best_type, best_speed = max(net_speeds, key=lambda item: item[2])
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
                else " — 未达千兆，需要 ≥ 1000 Mbps"
            ),
        }
    else:
        checks["network_speed"] = {
            "label": "网络速率",
            "pass": False,
            "detail": "未检测到已连接的网络接口",
        }

    all_pass = all(item["pass"] for item in checks.values())
    checks["_all_pass"] = all_pass
    return checks

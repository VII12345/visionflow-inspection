"""
Flask HTTP 服务器
提供 REST API 给 Electron 前端
"""

import io
import json
import os
import queue
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

from .config import Config
from .logger import logger
from .mvs_camera import MVSCameraManager
from .camera_config_manager import camera_config_manager
from .inference_worker import (
    start_inference_worker,
    submit_inference,
    get_inference_result,
    set_camera_product,
    preload_all_models,
)
from . import inference_worker
from .env_check import run_environment_check
from .plc_service import CAMERA_PLC_MAP, PlcWriteError, plc_service


# 初始化 Flask
app = Flask(__name__)
CORS(app)  # 允许跨域

# 全局状态
camera_manager = None
cameras = {}  # {cam_id: camera_instance}
camera_states = {}  # {cam_id: state_dict}
system_running = False
latest_frames = {}  # {cam_id: PIL.Image}
latest_results = {}  # {cam_id: {label, confidence, timestamp}}
stats = {i: {"detected": 0, "defective": 0} for i in range(1, Config.CAMERA_COUNT + 1)}
env_check_result = None  # 环境检测结果缓存


def initialize_camera_manager():
    """初始化相机管理器"""
    global camera_manager

    logger.info("初始化相机管理器（使用真实 MVS 相机）")
    camera_manager = MVSCameraManager()
    camera_manager.initialize()

    # 初始化相机状态
    for i in range(1, Config.CAMERA_COUNT + 1):
        camera_states[i] = {
            "state": "disconnected",
            "serial": None,
            "model": None,
            "ip": None,
            "triggerMode": "hardware",  # 硬触发模式
            "fps": 0,  # 触发频率（次/秒）
            "totalTriggers": 0,  # 累计触发次数
            "lastFrameTime": None,
            "error": None,
        }

    logger.info(f"相机状态已初始化: {len(camera_states)} 个相机槽位")


# ========== API 端点 ==========


@app.route("/api/health", methods=["GET"])
def health():
    """健康检查"""
    cam_status = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        if i in camera_states:
            cam_status[i] = camera_states[i]["state"] != "disconnected"
        else:
            cam_status[i] = False
    return jsonify(
        {
            "status": "ok",
            "version": "2.0.0",
            "cameras": cam_status,
            "modelLoaded": inference_worker.model_loaded,
            "running": system_running,
            "dataDir": str(Config.DATA_DIR),
        }
    )


@app.route("/api/env-check", methods=["GET"])
def env_check():
    """环境检测 — 返回所有检测项结果"""
    global env_check_result
    if env_check_result is None:
        env_check_result = run_environment_check()
    return jsonify(env_check_result)


@app.route("/api/hardware", methods=["GET"])
def hardware_info():
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

    return jsonify({"success": True, "hardware": info})


# 设备配置持久化
import json as _json

_device_config_path = Config.DATA_DIR / "device_config.json"
_line_count_path = Config.LINE_COUNT_FILE


def _normalize_line_count(value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = 4
    return max(Config.MIN_CAMERA_COUNT, min(Config.MAX_CAMERA_COUNT, value))


def _load_line_count():
    if _line_count_path.exists():
        try:
            with open(_line_count_path, "r", encoding="utf-8") as f:
                return _normalize_line_count(json.load(f).get("line_count"))
        except Exception:
            pass
    return Config.CAMERA_COUNT


def _apply_line_count(count):
    """更新运行时线体/相机槽位数量，并补齐相机配置。"""
    global stats
    count = _normalize_line_count(count)
    Config.CAMERA_COUNT = count
    camera_config_manager.ensure_camera_slots(count)
    stats = {
        i: stats.get(i, {"detected": 0, "defective": 0})
        for i in range(1, count + 1)
    }
    for cam_id in range(1, count + 1):
        camera_states.setdefault(cam_id, {
            "state": "disconnected",
            "serial": None,
            "model": None,
            "ip": None,
            "triggerMode": "hardware",
            "fps": 0,
            "totalTriggers": 0,
            "lastFrameTime": None,
            "error": None,
        })
    for cam_id in list(camera_states):
        if cam_id > count and cam_id not in cameras:
            camera_states.pop(cam_id, None)
    _line_count_path.parent.mkdir(parents=True, exist_ok=True)
    with open(_line_count_path, "w", encoding="utf-8") as f:
        json.dump({"line_count": count}, f, indent=2)
    return count


def _load_device_config():
    if _device_config_path.exists():
        try:
            with open(_device_config_path, "r", encoding="utf-8") as f:
                return _json.load(f)
        except Exception:
            pass
    return {"training_device": Config.DEVICE, "inference_device": Config.DEVICE}


def _save_device_config(cfg):
    _device_config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(_device_config_path, "w", encoding="utf-8") as f:
        _json.dump(cfg, f, indent=2)


@app.route("/api/settings/line-count", methods=["GET"])
def get_line_count():
    """获取当前线体数量"""
    return jsonify({"success": True, "line_count": Config.CAMERA_COUNT})


@app.route("/api/settings/line-count", methods=["POST"])
def update_line_count():
    """保存并应用线体数量（1-16），运行中禁止修改。"""
    if system_running:
        return jsonify({"success": False, "message": "系统运行中不能修改线体数量"}), 409
    data = request.get_json(silent=True) or {}
    raw_count = data.get("line_count")
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "线体数量必须是整数"}), 400
    if not Config.MIN_CAMERA_COUNT <= count <= Config.MAX_CAMERA_COUNT:
        return jsonify({"success": False, "message": f"线体数量应为 {Config.MIN_CAMERA_COUNT}-{Config.MAX_CAMERA_COUNT}"}), 400
    try:
        count = _apply_line_count(count)
        return jsonify({"success": True, "message": "线体数量已保存", "line_count": count})
    except Exception as e:
        logger.error(f"保存线体数量失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/api/settings/device", methods=["GET"])
def get_device_config():
    """获取设备选择配置"""
    cfg = _load_device_config()
    return jsonify({"success": True, "config": cfg})


@app.route("/api/settings/device", methods=["POST"])
def update_device_config():
    """更新设备选择配置"""
    import torch

    data = request.get_json()
    training_device = data.get("training_device", "").strip()
    inference_device = data.get("inference_device", "").strip()

    valid_devices = ["cpu"]
    if torch.cuda.is_available():
        valid_devices.append("cuda")

    if training_device not in valid_devices:
        return jsonify(
            {"success": False, "message": f"无效的训练设备: {training_device}"}
        ), 400
    if inference_device not in valid_devices:
        return jsonify(
            {"success": False, "message": f"无效的推理设备: {inference_device}"}
        ), 400

    cfg = {"training_device": training_device, "inference_device": inference_device}
    _save_device_config(cfg)

    # 更新运行时配置
    Config.DEVICE = inference_device
    if hasattr(Config, "TRAINING_DEVICE"):
        Config.TRAINING_DEVICE = training_device
    else:
        setattr(Config, "TRAINING_DEVICE", training_device)

    # ── 即时生效：同步训练模块的全局设备 ──
    try:
        from .training import set_training_device

        set_training_device(training_device)
    except Exception as e:
        logger.warning(f"同步训练设备失败: {e}")

    # ── 即时生效：重载推理模型到新设备 ──
    try:
        from .inference_worker import reload_all_models

        reload_all_models(inference_device)
    except Exception as e:
        logger.warning(f"重载推理模型失败: {e}")

    logger.info(
        f"设备配置已更新并生效: 训练={training_device}, 推理={inference_device}"
    )
    return jsonify(
        {"success": True, "message": "设备配置已保存并即时生效", "config": cfg}
    )


@app.route("/api/cameras", methods=["GET"])
def get_cameras():
    """枚举所有相机"""
    try:
        camera_list = camera_manager.enumerate_cameras()
        return jsonify({"success": True, "cameras": camera_list})
    except Exception as e:
        logger.error(f"枚举相机失败: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/cameras/mapping", methods=["GET"])
def get_camera_mapping():
    """获取相机映射配置"""
    mapping = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        if camera_states[i]["serial"]:
            mapping[str(i)] = {"serial": camera_states[i]["serial"], "name": f"Cam{i}"}
        else:
            mapping[str(i)] = None
    return jsonify(mapping)


@app.route("/api/cameras/config", methods=["GET"])
def get_camera_config():
    """获取所有相机配置"""
    config = camera_config_manager.get_config()
    return jsonify({"success": True, "config": config})


@app.route("/api/cameras/config/<int:cam_id>", methods=["GET"])
def get_single_camera_config(cam_id):
    """获取单个相机配置"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    config = camera_config_manager.get_camera_config(cam_id)
    return jsonify({"success": True, "config": config})


@app.route("/api/cameras/config/<int:cam_id>", methods=["POST"])
def update_camera_config(cam_id):
    """更新单个相机配置"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    try:
        data = request.get_json()
        camera_config = {
            "enabled": data.get("enabled", False),
            "ip": data.get("ip", ""),
            "name": data.get("name", f"Cam{cam_id}"),
            "triggerSource": data.get("triggerSource", "Line0"),
            "triggerActivation": data.get("triggerActivation", "RisingEdge"),
            "triggerTimeout": data.get("triggerTimeout", 30000),
            "triggerDelay": data.get("triggerDelay", 0),
            "exposureTime": data.get("exposureTime", 5000),
            "gain": data.get("gain", 0),
            "lineDebouncerTime": data.get("lineDebouncerTime", 50),
            "strobeEnable": data.get("strobeEnable", False),
            "strobeDelay": data.get("strobeDelay", 0),
            "strobeDuration": data.get("strobeDuration", 1000),
            "rejectTime": data.get("rejectTime", 0),
            "rejectDelay": data.get("rejectDelay", 0),
            "plcUrl": data.get("plcUrl", "http://127.0.0.1:8088"),
        }

        plc_url = camera_config["plcUrl"].strip()
        if not plc_url.startswith(("http://", "https://")):
            return jsonify(
                {"success": False, "error": "PLC地址必须以 http:// 或 https:// 开头"}
            ), 400
        camera_config["plcUrl"] = plc_url.rstrip("/")

        for key in ("rejectTime", "rejectDelay"):
            value = camera_config[key]
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 0
                or value > 4294967295
            ):
                return jsonify(
                    {"success": False, "error": f"{key} 必须是 0 到 4294967295 的整数"}
                ), 400

        success = camera_config_manager.update_camera_config(cam_id, camera_config)
        plc_result = None
        plc_error = None
        try:
            plc_result = plc_service.with_base_url(plc_url).write_camera_timing(
                cam_id, camera_config["rejectTime"], camera_config["rejectDelay"]
            )
        except (PlcWriteError, ValueError) as e:
            plc_error = str(e)

        if success:
            logger.info(f"相机 {cam_id} 配置已更新: {camera_config}")
            response = {
                "success": True,
                "message": f"Cam{cam_id} 配置已保存",
                "plcSuccess": plc_error is None,
                "plc": plc_result,
            }
            if plc_error:
                response["plcError"] = plc_error
            return jsonify(response)
        else:
            return jsonify({"success": False, "error": "保存配置失败"}), 500

    except Exception as e:
        logger.error(f"更新相机配置失败: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/cameras/<int:cam_id>/plc/test-reject", methods=["POST"])
def test_reject_signal(cam_id):
    """写入对应相机的 MB=1 测试信号"""
    if cam_id not in CAMERA_PLC_MAP:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    try:
        result = plc_service.with_base_url(
            camera_config_manager.get_camera_config(cam_id).get(
                "plcUrl", plc_service.base_url
            )
        ).write_reject_signal(cam_id)
        return jsonify(
            {
                "success": True,
                "camera": cam_id,
                "address": CAMERA_PLC_MAP[cam_id]["reject_signal"],
                "value": 1,
                "plc": result,
            }
        )
    except (PlcWriteError, ValueError) as e:
        return jsonify(
            {
                "success": False,
                "camera": cam_id,
                "address": CAMERA_PLC_MAP[cam_id]["reject_signal"],
                "error": str(e),
            }
        ), 502


@app.route("/api/start", methods=["POST"])
def start_system():
    """启动所有相机"""
    global system_running

    if system_running:
        return jsonify({"success": False, "message": "系统已在运行中"})

    try:
        logger.info("启动系统...")

        # 读取摄像头-产品映射（前端传入）
        from .inference_worker import set_camera_product

        data = request.get_json(silent=True) or {}
        requested_count = data.get("line_count")
        if requested_count is not None:
            try:
                _apply_line_count(requested_count)
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "线体数量无效"}), 400
        cam_products = data.get("camProducts", {})
        for cam_id_str, model_name in cam_products.items():
            set_camera_product(int(cam_id_str), model_name if model_name else None)
        logger.info(f"摄像头-产品映射: {cam_products}")

        if camera_manager is None:
            return jsonify(
                {
                    "success": False,
                    "message": "相机管理器未初始化，请检查 MVS SDK 安装或查看环境检测结果",
                }
            ), 500

        system_running = True

        # 获取启用的相机配置
        enabled_cameras = camera_config_manager.get_enabled_cameras()

        if not enabled_cameras:
            logger.warning("没有启用的相机配置")
            system_running = False
            return jsonify(
                {
                    "success": False,
                    "message": "没有启用的相机，请先在设置中配置相机IP地址",
                }
            ), 400

        # 枚举可用的物理相机
        available_cameras = camera_manager.enumerate_cameras()
        logger.info(f"检测到 {len(available_cameras)} 台物理相机")

        # 根据配置的IP地址匹配相机
        started_count = 0
        errors = []

        for cam_id, cam_config in enabled_cameras.items():
            target_ip = cam_config["ip"]
            logger.info(f"尝试连接 Cam{cam_id} (IP: {target_ip})...")

            # 在枚举的相机中查找匹配的IP
            device_info = None
            device_index = None

            for idx, cam_info in enumerate(available_cameras):
                if cam_info.get("ip") == target_ip:
                    device_info = cam_info
                    device_index = idx
                    break

            if device_info is None:
                error_msg = f"Cam{cam_id} 未找到IP为 {target_ip} 的相机"
                logger.warning(error_msg)
                errors.append(error_msg)
                camera_states[cam_id]["state"] = "error"
                camera_states[cam_id]["error"] = f"未找到IP: {target_ip}"
                continue

            try:
                # 创建并连接相机
                cam = camera_manager.create_camera(cam_id, device_index)
                cameras[cam_id] = cam
                cam.connect()

                # 设置曝光和增益
                exposure_time = cam_config.get("exposureTime", 5000)
                gain = cam_config.get("gain", 0)
                cam.set_exposure_time(exposure_time)
                cam.set_gain(gain)

                # 设置触发延时
                trigger_delay = cam_config.get("triggerDelay", 0)
                cam.set_trigger_delay(trigger_delay)

                # 设置线路滤波（防误触发）
                debouncer = cam_config.get("lineDebouncerTime", 50)
                cam.set_line_debouncer(debouncer)

                # 设置频闪输出（外部光源控制）
                strobe_enable = cam_config.get("strobeEnable", False)
                cam.set_strobe(
                    strobe_enable,
                    cam_config.get("strobeDelay", 0),
                    cam_config.get("strobeDuration", 1000),
                )

                # 读取触发配置并启动取流
                trigger_source = cam_config.get("triggerSource", "Line0")
                trigger_activation = cam_config.get("triggerActivation", "RisingEdge")
                trigger_timeout = cam_config.get("triggerTimeout", 30000)
                cam.start_grabbing(
                    trigger_source=trigger_source, trigger_activation=trigger_activation
                )
                # 将超时存入相机实例，worker 使用
                cam.trigger_timeout = trigger_timeout

                # 启动相机工作线程
                thread = threading.Thread(
                    target=camera_worker, args=(cam_id,), daemon=True
                )
                thread.start()

                # 更新状态
                camera_states[cam_id]["state"] = "running"
                camera_states[cam_id]["triggerMode"] = "hardware"
                camera_states[cam_id]["totalTriggers"] = 0
                info = cam.get_info()
                camera_states[cam_id]["serial"] = info["serial"]
                camera_states[cam_id]["model"] = info["model"]
                camera_states[cam_id]["ip"] = info.get("ip")
                camera_states[cam_id]["error"] = None

                logger.info(f"Cam{cam_id} 启动成功: {info['model']} ({target_ip})")
                started_count += 1

            except Exception as e:
                error_msg = f"Cam{cam_id} 启动失败: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)
                camera_states[cam_id]["state"] = "error"
                camera_states[cam_id]["error"] = str(e)
                # 断开已连接的相机，避免设备残留占用
                try:
                    if cam_id in cameras:
                        cameras[cam_id].disconnect()
                        del cameras[cam_id]
                except Exception:
                    pass

        if started_count == 0:
            system_running = False
            return jsonify(
                {"success": False, "message": "所有相机启动失败", "errors": errors}
            ), 500

        message = f"系统启动成功，启动了 {started_count}/{len(enabled_cameras)} 个相机"
        if errors:
            message += f"，{len(errors)} 个相机启动失败"

        logger.info(message)
        return jsonify(
            {
                "success": True,
                "message": message,
                "started": started_count,
                "total": len(enabled_cameras),
                "errors": errors if errors else None,
            }
        )

    except Exception as e:
        logger.error(f"启动失败: {e}")
        system_running = False
        return jsonify({"success": False, "message": f"启动失败: {str(e)}"}), 500


@app.route("/api/stop", methods=["POST"])
def stop_system():
    """停止所有相机"""
    global system_running

    if not system_running:
        return jsonify({"success": False, "message": "系统未运行"})

    try:
        logger.info("停止系统...")
        system_running = False

        # 停止所有相机
        for i in range(1, Config.CAMERA_COUNT + 1):
            if i in cameras:
                cameras[i].stop_grabbing()
                cameras[i].disconnect()
                camera_states[i]["state"] = "ready"

        logger.info("系统停止成功")
        return jsonify({"success": True, "message": "系统停止成功"})
    except Exception as e:
        logger.error(f"停止失败: {e}")
        return jsonify({"success": False, "message": f"停止失败: {str(e)}"}), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    """获取系统状态（主要轮询端点）"""
    camera_status = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        state = camera_states[i]
        camera_status[str(i)] = {
            "state": state["state"],
            "serial": state["serial"],
            "model": state["model"],
            "triggerMode": state["triggerMode"],
            "fps": state["fps"],
            "totalTriggers": state["totalTriggers"],
            "lastFrameTime": state["lastFrameTime"],
            "stats": stats[i],
            "error": state["error"],
        }

        # 添加最新检测结果
        if i in latest_results:
            camera_status[str(i)]["result"] = latest_results[i]

    return jsonify(
        {
            "cameras": camera_status,
            "system": {
                "running": system_running,
                "modelLoaded": inference_worker.model_loaded,
            },
        }
    )


@app.route("/api/frame/<int:cam_id>", methods=["GET"])
def get_frame(cam_id):
    """获取最新帧（JPEG）"""
    if cam_id not in latest_frames:
        return jsonify({"error": "No frame available"}), 404

    try:
        img = latest_frames[cam_id]
        # 转为 JPEG bytes
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        return send_file(buf, mimetype="image/jpeg")
    except Exception as e:
        logger.error(f"获取帧失败: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/result/<int:cam_id>", methods=["GET"])
def get_result(cam_id):
    """获取最新检测结果"""
    if cam_id not in latest_results:
        return jsonify({"error": "No result available"}), 404

    return jsonify(latest_results[cam_id])


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """获取统计数据"""
    return jsonify(stats)


@app.route("/api/stats/reset/<int:cam_id>", methods=["POST"])
def reset_stats(cam_id):
    """重置统计"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"error": "Invalid camera ID"}), 400

    stats[cam_id] = {"detected": 0, "defective": 0}
    logger.info(f"重置 Camera {cam_id} 统计")
    return jsonify({"success": True, "stats": stats[cam_id]})


# ========== 保存设置 API ==========

_save_settings_path = Config.DATA_DIR / "save_settings.json"


def _default_save_settings():
    return {
        i: {"saveGood": True, "saveBad": True}
        for i in range(1, Config.CAMERA_COUNT + 1)
    }


def _load_save_settings():
    settings = _default_save_settings()
    if not _save_settings_path.exists():
        return settings
    try:
        with open(_save_settings_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            # 线体数量可能在本次启动时才从 line_count.json 恢复，
            # 因此不能只按默认的 Config.CAMERA_COUNT 读取设置。
            for raw_cam_id, item in raw.items():
                try:
                    cam_id = int(raw_cam_id)
                except (TypeError, ValueError):
                    continue
                if not 1 <= cam_id <= Config.MAX_CAMERA_COUNT or not isinstance(item, dict):
                    continue
                settings[cam_id] = {
                    "saveGood": item.get("saveGood", True) is True,
                    "saveBad": item.get("saveBad", True) is True,
                }
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"加载照片保存设置失败，使用默认值: {exc}")
    return settings


def _persist_save_settings():
    try:
        _save_settings_path.parent.mkdir(parents=True, exist_ok=True)
        with open(_save_settings_path, "w", encoding="utf-8") as f:
            json.dump(save_settings, f, indent=2)
    except OSError as exc:
        logger.error(f"保存照片保存设置失败: {exc}")


save_settings = _load_save_settings()


# ========== 训练状态 ==========

training_state = {
    "running": False,
    "progress": 0,
    "epoch": 0,
    "total_epochs": Config.TRAINING_EPOCHS,
    "train_loss": 0,
    "val_loss": 0,
    "val_acc": 0,
    "message": "",
    "history": None,
    "folderPath": "",
    "modelName": "",
    "modelPath": None,
    "evalResult": None,
    "trainCount": 0,
    "valCount": 0,
}
_training_thread = None
_training_stop_flag = False


@app.route("/api/save-settings", methods=["GET"])
def get_save_settings():
    """获取所有保存设置"""
    return jsonify({"success": True, "settings": save_settings})


@app.route("/api/save-settings/<int:cam_id>", methods=["POST"])
def update_save_settings(cam_id):
    """更新保存设置，并立即影响后续抓拍存盘。"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    data = request.get_json(silent=True) or {}
    values = {"saveGood": data.get("saveGood", True), "saveBad": data.get("saveBad", True)}
    if any(not isinstance(value, bool) for value in values.values()):
        return jsonify({"success": False, "error": "saveGood/saveBad 必须是布尔值"}), 400
    save_settings[cam_id] = values
    _persist_save_settings()
    logger.info(f"更新保存设置 Cam{cam_id}: {save_settings[cam_id]}")
    return jsonify({"success": True, "settings": save_settings[cam_id]})


# ========== 后端图片目录选择 API ==========

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def _image_directory_roots():
    """返回允许通过网页选择的后端图片根目录。"""
    roots = [Config.DATA_DIR, Path(__file__).resolve().parent.parent / "test"]
    configured = os.getenv("VISION_IMAGE_ROOTS", "")
    if configured:
        roots.extend(Path(item) for item in configured.split(os.pathsep) if item.strip())

    unique = []
    seen = set()
    for root in roots:
        try:
            resolved = root.expanduser().resolve()
        except OSError:
            continue
        key = str(resolved).lower() if os.name == "nt" else str(resolved)
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    return unique


@app.route("/api/image-directories", methods=["GET"])
def list_image_directories():
    """列出后端允许选择且包含图片的目录。"""
    directories = []
    for root in _image_directory_roots():
        if not root.is_dir():
            continue
        try:
            candidates = [root, *root.rglob("*")]
            for directory in candidates:
                if not directory.is_dir() or directory.is_symlink():
                    continue
                try:
                    image_count = sum(
                        1
                        for item in directory.iterdir()
                        if item.is_file() and item.suffix.lower() in _IMAGE_EXTENSIONS
                    )
                    if image_count == 0:
                        continue
                    relative = "." if directory == root else str(directory.relative_to(root))
                    directories.append(
                        {
                            "path": str(directory),
                            "name": directory.name or str(directory),
                            "relativePath": relative,
                            "root": str(root),
                            "imageCount": image_count,
                        }
                    )
                except (OSError, ValueError):
                    continue
        except OSError as exc:
            logger.warning(f"扫描图片目录失败 {root}: {exc}")

    directories.sort(key=lambda item: (item["root"].lower(), item["relativePath"].lower()))
    return jsonify({"success": True, "directories": directories})


# ========== 照片管理 API ==========


@app.route("/api/photos/<int:cam_id>", methods=["GET"])
def list_photos(cam_id):
    """获取相机照片列表（含正/反分类）"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    capture_dir = Config.CAPTURE_DIR / f"cam{cam_id}"
    if not capture_dir.exists():
        return jsonify({"success": True, "photos": [], "okCount": 0, "ngCount": 0})

    photos = []
    ok_count = 0
    ng_count = 0
    # 扫描子目录（正/反/未分类）
    for sub in ["正", "反", "未分类"]:
        subdir = capture_dir / sub
        if not subdir.exists():
            continue
        for f in sorted(
            subdir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True
        ):
            if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                stat = f.stat()
                # 根据子目录确定分类
                result_tag = "OK" if sub == "正" else ("NG" if sub == "反" else "--")
                if result_tag == "OK":
                    ok_count += 1
                elif result_tag == "NG":
                    ng_count += 1
                photos.append(
                    {
                        "filename": f.name,
                        "subdir": sub,
                        "size": stat.st_size,
                        "mtime": datetime.fromtimestamp(stat.st_mtime).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                        "timestamp": stat.st_mtime,
                        "result": result_tag,
                    }
                )

    return jsonify(
        {"success": True, "photos": photos, "okCount": ok_count, "ngCount": ng_count}
    )


@app.route("/api/photos/<int:cam_id>/<filename>", methods=["GET"])
def get_photo(cam_id, filename):
    """获取单张照片文件"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"error": "Invalid camera ID"}), 400

    safe_name = Path(filename).name
    # 在子目录中查找
    for sub in ["正", "反", "未分类", ""]:
        file_path = Config.CAPTURE_DIR / f"cam{cam_id}" / sub / safe_name
        if file_path.exists():
            break
    else:
        return jsonify({"error": "Photo not found"}), 404

    # 根据扩展名自动选择 MIME 类型
    ext = file_path.suffix.lower()
    mime_map = {
        ".png": "image/png",
        ".bmp": "image/bmp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    mime = mime_map.get(ext, "image/jpeg")
    return send_file(str(file_path), mimetype=mime)


@app.route("/api/photos/<int:cam_id>/<filename>", methods=["DELETE"])
def delete_photo(cam_id, filename):
    """删除单张照片"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    safe_name = Path(filename).name
    file_path = None
    for sub in ["正", "反", "未分类", ""]:
        candidate = Config.CAPTURE_DIR / f"cam{cam_id}" / sub / safe_name
        if candidate.exists() and candidate.is_file():
            file_path = candidate
            break

    if file_path is None:
        return jsonify({"success": False, "error": "Photo not found"}), 404

    try:
        file_path.unlink()
        logger.info(f"已删除照片: {file_path}")
        return jsonify({"success": True, "message": f"已删除 {filename}"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def cleanup_photos():
    """清理过期/超量照片"""
    now = time.time()
    max_age_seconds = Config.MAX_PHOTO_AGE_DAYS * 86400
    total_deleted = 0

    for cam_id in range(1, Config.CAMERA_COUNT + 1):
        capture_dir = Config.CAPTURE_DIR / f"cam{cam_id}"
        if not capture_dir.exists():
            continue

        # 收集所有照片文件，按修改时间排序
        files = []
        for sub in ["正", "反", "未分类", ""]:
            subdir = capture_dir / sub
            if not subdir.exists():
                continue
            for f in subdir.iterdir():
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                    files.append((f, f.stat().st_mtime))

        if not files:
            continue

        # 按时间从旧到新排序
        files.sort(key=lambda x: x[1])

        # 1) 删除过期照片
        for f_path, mtime in files[:]:
            if now - mtime > max_age_seconds:
                try:
                    f_path.unlink()
                    total_deleted += 1
                except Exception:
                    pass
                files.remove((f_path, mtime))

        # 2) 超出数量限制，删除最旧的
        while len(files) > Config.PHOTO_RETENTION_COUNT:
            f_path, _ = files.pop(0)
            try:
                f_path.unlink()
                total_deleted += 1
            except Exception:
                pass

    if total_deleted > 0:
        logger.info(f"照片清理完成: 删除了 {total_deleted} 张照片")
    return total_deleted


@app.route("/api/photos/cleanup", methods=["POST"])
def trigger_cleanup():
    """手动触发照片清理"""
    deleted = cleanup_photos()
    return jsonify(
        {
            "success": True,
            "message": f"清理完成，删除了 {deleted} 张照片",
            "deleted": deleted,
        }
    )


# ========== 异步存盘队列 ==========
# 存盘操作（BMP 写入磁盘）移到独立线程，不阻塞抓帧→推理→结果返回的快速路径

_save_queue = queue.Queue()
_save_queue_running = False


def _unpack_save_item(item):
    if len(item) >= 4:
        return item[0], item[1], item[2], item[3]
    return item[0], item[1], None, None


def _write_save_item(item):
    frame, save_path, done_event, completion = _unpack_save_item(item)
    write_start = time.perf_counter()
    error = None
    try:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        frame.save(save_path, "BMP")
        logger.debug(f"异步存盘完成: {save_path.name}")
    except Exception as exc:
        error = exc
        logger.error(f"异步存盘失败: {exc}")
    finally:
        if completion is not None:
            completion["write_ms"] = (time.perf_counter() - write_start) * 1000
            completion["error"] = str(error) if error else None
        if done_event is not None:
            done_event.set()
    return error


def _save_worker():
    """异步存盘 worker；支持测试等待同一保存任务完成并读取实际写盘耗时。"""
    global _save_queue_running
    logger.info("异步存盘 worker 启动")
    _save_queue_running = True
    while _save_queue_running:
        try:
            item = _save_queue.get(timeout=1)
            if item is None:
                break
            _write_save_item(item)
        except queue.Empty:
            continue
        except Exception as e:
            logger.error(f"异步存盘 worker 错误: {e}")
    while not _save_queue.empty():
        try:
            item = _save_queue.get_nowait()
            if item is not None:
                _write_save_item(item)
        except Exception:
            pass
    logger.info("异步存盘 worker 停止")


def _submit_save(frame, save_path, done_event=None, completion=None):
    """提交存盘任务；默认非阻塞，测试可传 event 等待同一异步任务完成。"""
    try:
        if done_event is None and completion is None:
            item = (frame, save_path)
        else:
            item = (frame, save_path, done_event, completion or {})
        _save_queue.put(item, timeout=0.05)
        return True
    except queue.Full:
        logger.warning(f"存盘队列已满，丢弃: {save_path.name}")
        if done_event is not None:
            done_event.set()
        return False

def _start_save_worker():
    """启动异步存盘线程"""
    t = threading.Thread(target=_save_worker, daemon=True)
    t.start()


def _stop_save_worker():
    """停止异步存盘线程"""
    global _save_queue_running
    _save_queue_running = False
    try:
        _save_queue.put(None, timeout=0.1)
    except queue.Full:
        pass


# ========== 相机工作线程 ==========


def camera_worker(cam_id):
    """
    相机工作线程（触发模式）
    阻塞等待传感器触发 → 抓帧 → 推理 → 更新结果 → 继续等待下一个触发
    """
    logger.info(f"Camera {cam_id} worker 启动（触发模式：等待传感器信号...）")
    cam = cameras[cam_id]
    frame_count = 0
    start_time = time.time()
    wait_count = 0

    while system_running and cam.running:
        try:
            # 阻塞等待传感器触发并抓帧
            timeout = getattr(cam, "trigger_timeout", Config.CAMERA_TRIGGER_TIMEOUT_MS)
            frame = cam.grab_frame(timeout_ms=timeout)

            if frame is None:
                # 超时未收到触发信号，继续等待
                wait_count += 1
                if wait_count % 10 == 0:
                    logger.debug(
                        f"Camera {cam_id}: 等待传感器触发中... (已等待 {wait_count * Config.CAMERA_TRIGGER_TIMEOUT_MS / 1000:.0f}s)"
                    )
                continue

            # 收到触发，拿到了新照片！
            wait_count = 0
            frame_count += 1
            latest_frames[cam_id] = frame

            logger.info(f"Camera {cam_id}: 收到触发信号 #{frame_count}，开始推理...")

            # 提交并等待推理结果
            submitted = False
            if inference_worker.model_loaded:
                submitted = submit_inference(cam_id, frame)
            else:
                logger.warning(f"Camera {cam_id}: model_loaded=False，跳过检测")

            if submitted:
                # 阻塞等待推理完成
                result = get_inference_result(cam_id, timeout=5.0)
                if result:
                    latest_results[cam_id] = result
                    stats[cam_id]["detected"] += 1
                    if result["label"] == "反":
                        stats[cam_id]["defective"] += 1
                        try:
                            plc_service.with_base_url(
                                camera_config_manager.get_camera_config(cam_id).get(
                                    "plcUrl", plc_service.base_url
                                )
                            ).write_reject_signal(cam_id)
                        except (PlcWriteError, ValueError) as e:
                            logger.error(f"Camera {cam_id}: 反结果写入PLC失败: {e}")
                    logger.info(
                        f"Camera {cam_id}: #{frame_count} → {result['label']} ({result['confidence']:.2f})"
                    )
                else:
                    logger.warning(f"Camera {cam_id}: 推理超时，跳过此帧")
                    continue
            else:
                # 模型未就绪，记录但不推理
                logger.warning(f"Camera {cam_id}: 模型未就绪，无法推理")
                stats[cam_id]["detected"] += 1

            # 照片存盘 — 异步写入，不阻塞抓帧循环。正/反照片的开关
            # 来自 /api/save-settings，并且在后端进程内直接生效。
            try:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                millis = int((time.time() * 1000) % 1000)
                if submitted and result:
                    tag = "OK" if result["label"] == "正" else "NG"
                else:
                    tag = "UNK"
                setting_key = "saveGood" if tag == "OK" else "saveBad"
                should_save = tag == "UNK" or save_settings.get(cam_id, {}).get(setting_key, True)
                if should_save:
                    subdir = "正" if tag == "OK" else ("反" if tag == "NG" else "未分类")
                    filename = f"CAM{cam_id}_{timestamp}_{millis:03d}.bmp"
                    save_path = Config.CAPTURE_DIR / f"cam{cam_id}" / subdir / filename
                    # 异步提交存盘（非阻塞，存盘在后台线程慢慢写）
                    _submit_save(frame.copy(), save_path)
            except Exception as e:
                logger.error(f"Camera {cam_id}: 提交存盘失败: {e}")

            # 更新状态
            camera_states[cam_id]["lastFrameTime"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            camera_states[cam_id]["totalTriggers"] = frame_count

            # 计算实际触发频率（触发/秒）
            elapsed = time.time() - start_time
            if elapsed > 0:
                camera_states[cam_id]["fps"] = round(frame_count / elapsed, 2)

        except Exception as e:
            logger.error(f"Camera {cam_id} worker 错误: {e}")
            camera_states[cam_id]["error"] = str(e)
            camera_states[cam_id]["state"] = "error"
            # 短暂等待后重试
            time.sleep(1)

    logger.info(f"Camera {cam_id} worker 停止（共处理 {frame_count} 张图片）")


# ========== 模型管理 API ==========


@app.route("/api/models", methods=["GET"])
def list_models():
    """扫描 data/ 目录，返回已训练的模型列表"""
    models = []
    try:
        for f in Config.DATA_DIR.glob("jar_classifier_*.pth"):
            name = f.stem.replace("jar_classifier_", "")
            stat = f.stat()
            models.append(
                {
                    "name": name,
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                }
            )
    except Exception as e:
        logger.error(f"扫描模型文件失败: {e}")
    return jsonify({"success": True, "models": models})


# ========== 模型测试 API ==========


@app.route("/api/test", methods=["POST"])
def test_model():
    """使用真实 inference_queue、推理 Worker 和异步存盘队列执行测试。"""
    import tempfile
    from PIL import Image
    from .inference_worker import get_inference_result, submit_inference, set_camera_product

    IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    STEP_LABELS = {
        "file_enumeration_ms": "文件枚举",
        "model_route_prepare_ms": "模型路由/准备",
        "image_acquisition_ms": "获取图片",
        "inference_submit_ms": "提交推理队列",
        "inference_queue_wait_ms": "推理队列等待",
        "inference_batch_window_ms": "推理批窗口",
        "model_prepare_ms": "Worker 获取模型",
        "preprocess_ms": "图像预处理",
        "model_call_ms": "调用模型",
        "recognition_ms": "识别/置信度计算",
        "inference_result_wait_ms": "等待推理结果",
        "inference_result_handoff_ms": "推理结果交接",
        "result_output_ms": "输出结果",
        "frame_copy_ms": "帧复制",
        "save_submit_ms": "提交保存队列",
        "save_queue_wait_ms": "保存队列等待",
        "save_queue_wait_excluding_write_ms": "写盘前队列等待",
        "image_save_ms": "实际写盘",
        "detection_pipeline_ms": "检测主流程",
        "pipeline_ms": "单张完整流程",
    }

    def timing_stats(values):
        if not values:
            return {"avg_ms": 0.0, "min_ms": 0.0, "max_ms": 0.0, "total_ms": 0.0}
        return {
            "avg_ms": round(sum(values) / len(values), 2),
            "min_ms": round(min(values), 2),
            "max_ms": round(max(values), 2),
            "total_ms": round(sum(values), 2),
        }

    try:
        data = request.get_json(force=True) or {}
        model_name = (data.get("model_name") or "").strip()
        mode = data.get("mode", "labeled")
        if not model_name:
            return jsonify({"success": False, "message": "请指定模型名称"}), 400
        if mode not in ("labeled", "unlabeled"):
            return jsonify({"success": False, "message": "无效的测试模式"}), 400
        if system_running:
            return jsonify({"success": False, "message": "系统运行中不能执行模拟测试，请先停止实际检测"}), 409

        # 使用 Cam1 的真实 result_queue 作为测试通道；系统未运行时不会与真实相机竞争。
        test_cam_id = 1
        old_mapping_exists = test_cam_id in inference_worker.camera_product_map
        old_mapping = inference_worker.camera_product_map.get(test_cam_id)
        result_queue = inference_worker.result_queues[test_cam_id]
        while True:
            try:
                result_queue.get_nowait()
            except queue.Empty:
                break

        pipeline_start = time.perf_counter()
        step_values = {key: [] for key in STEP_LABELS}
        set_model_start = time.perf_counter()
        set_camera_product(test_cam_id, model_name)
        step_values["model_route_prepare_ms"].append((time.perf_counter() - set_model_start) * 1000)

        sources = []
        enum_start = time.perf_counter()
        if mode == "labeled":
            upright_path = (data.get("upright_path") or "").strip()
            inverted_path = (data.get("inverted_path") or "").strip()
            if not upright_path and not inverted_path:
                return jsonify({"success": False, "message": "请至少指定正罐或倒罐目录"}), 400
            for expected, folder_value in (("正", upright_path), ("反", inverted_path)):
                if not folder_value:
                    continue
                folder = Path(folder_value)
                if not folder.is_dir():
                    continue
                sources.extend((path, expected) for path in sorted(folder.iterdir()) if path.suffix.lower() in IMG_EXTS)
        else:
            folder_value = (data.get("folder_path") or "").strip()
            if not folder_value:
                return jsonify({"success": False, "message": "请指定测试图片目录"}), 400
            folder = Path(folder_value)
            if not folder.is_dir():
                return jsonify({"success": False, "message": "目录不存在"}), 400
            sources = [(path, None) for path in sorted(folder.iterdir()) if path.suffix.lower() in IMG_EXTS]
        step_values["file_enumeration_ms"].append((time.perf_counter() - enum_start) * 1000)

        results = []
        counts = {"total": 0, "correct": 0, "upright_total": 0, "upright_correct": 0, "inverted_total": 0, "inverted_correct": 0}

        try:
            with tempfile.TemporaryDirectory(prefix="vision_test_captures_", dir=str(Config.DATA_DIR)) as temp_dir:
                save_root = Path(temp_dir) / "captures"
                for image_path, expected in sources:
                    image_start = time.perf_counter()
                    image = None
                    try:
                        # 与实际相机帧进入 worker 前一致：读取并转换为 RGB 图像对象。
                        t0 = time.perf_counter()
                        with Image.open(image_path) as source_image:
                            image = source_image.convert("RGB")
                        step_values["image_acquisition_ms"].append((time.perf_counter() - t0) * 1000)

                        # 与实际运行完全相同：提交 inference_queue，由推理 Worker 处理。
                        t0 = time.perf_counter()
                        submitted = submit_inference(test_cam_id, image, timed=True)
                        step_values["inference_submit_ms"].append((time.perf_counter() - t0) * 1000)
                        if not submitted:
                            raise RuntimeError("推理队列已满")

                        t0 = time.perf_counter()
                        inference_result = get_inference_result(test_cam_id, timeout=30.0)
                        step_values["inference_result_wait_ms"].append((time.perf_counter() - t0) * 1000)
                        if not inference_result:
                            raise RuntimeError("等待推理结果超时")

                        worker_timing = inference_result.get("timing", {})
                        worker_timing_keys = (
                            "inference_queue_wait_ms",
                            "inference_batch_window_ms",
                            "model_prepare_ms",
                            "preprocess_ms",
                            "model_call_ms",
                            "recognition_ms",
                        )
                        for key in worker_timing_keys:
                            if key in worker_timing:
                                step_values[key].append(float(worker_timing[key]))
                        inference_wait_ms = step_values["inference_result_wait_ms"][-1]
                        worker_timing_total = sum(float(worker_timing.get(key, 0.0)) for key in worker_timing_keys)
                        # “等待推理结果”是提交线程看到的完整墙钟时间，Worker 子项之外还包含
                        # 结果入队、线程唤醒和跨线程交接；把这段剩余时间单独列出，避免父子重复相加。
                        step_values["inference_result_handoff_ms"].append(
                            max(0.0, inference_wait_ms - worker_timing_total)
                        )

                        # 模拟实际 Worker 结果交回相机线程后的输出/统计更新。
                        t0 = time.perf_counter()
                        predicted = inference_result["label"]
                        confidence = float(inference_result["confidence"])
                        is_correct = expected is not None and predicted == expected
                        counts["total"] += 1
                        if expected is not None:
                            if is_correct:
                                counts["correct"] += 1
                            if expected == "正":
                                counts["upright_total"] += 1
                                if is_correct:
                                    counts["upright_correct"] += 1
                            else:
                                counts["inverted_total"] += 1
                                if is_correct:
                                    counts["inverted_correct"] += 1
                        result = {"filename": image_path.name, "predicted": predicted, "confidence": round(confidence, 4)}
                        if expected is not None:
                            result.update({"expected": expected, "correct": is_correct})
                        step_values["result_output_ms"].append((time.perf_counter() - t0) * 1000)

                        # 模拟实际 _submit_save：先异步入队，再等待同一个异步 Worker 写盘完成。
                        t0 = time.perf_counter()
                        save_copy = image.copy()
                        step_values["frame_copy_ms"].append((time.perf_counter() - t0) * 1000)
                        save_subdir = "正" if predicted == "正" else "反"
                        save_path = save_root / save_subdir / f"{image_path.stem}.bmp"
                        done_event = threading.Event()
                        completion = {}
                        t0 = time.perf_counter()
                        save_submitted = _submit_save(save_copy, save_path, done_event, completion)
                        step_values["save_submit_ms"].append((time.perf_counter() - t0) * 1000)
                        if not save_submitted:
                            save_copy.close()
                            raise RuntimeError("保存队列已满")
                        save_wait_start = time.perf_counter()
                        if not done_event.wait(timeout=30.0):
                            raise RuntimeError("等待异步保存完成超时")
                        save_queue_wait_ms = (time.perf_counter() - save_wait_start) * 1000
                        step_values["save_queue_wait_ms"].append(save_queue_wait_ms)
                        if completion.get("error"):
                            raise RuntimeError(f"图片保存失败: {completion['error']}")
                        image_save_ms = float(completion.get("write_ms", 0.0))
                        step_values["image_save_ms"].append(image_save_ms)
                        # 保存队列等待已经覆盖从入队到写盘完成的墙钟时间，实际写盘是其中的子区间。
                        # 拆出写盘前等待后，保存阶段的子项可以无重叠地相加。
                        step_values["save_queue_wait_excluding_write_ms"].append(
                            max(0.0, save_queue_wait_ms - image_save_ms)
                        )

                        detection_end = time.perf_counter()
                        result["timing"] = {
                            key: round(float(value), 2)
                            for key, value in {
                                **worker_timing,
                                "inference_submit_ms": step_values["inference_submit_ms"][-1],
                                "inference_result_wait_ms": step_values["inference_result_wait_ms"][-1],
                                "inference_result_handoff_ms": step_values["inference_result_handoff_ms"][-1],
                                "result_output_ms": step_values["result_output_ms"][-1],
                                "frame_copy_ms": step_values["frame_copy_ms"][-1],
                                "save_submit_ms": step_values["save_submit_ms"][-1],
                                "save_queue_wait_ms": step_values["save_queue_wait_ms"][-1],
                                "save_queue_wait_excluding_write_ms": step_values["save_queue_wait_excluding_write_ms"][-1],
                                "image_save_ms": step_values["image_save_ms"][-1],
                            }.items()
                        }
                        result["timing"]["detection_pipeline_ms"] = round((detection_end - image_start) * 1000 - step_values["save_queue_wait_ms"][-1] - step_values["image_save_ms"][-1], 2)
                        result["time_ms"] = round((time.perf_counter() - image_start) * 1000, 2)
                        step_values["detection_pipeline_ms"].append(result["timing"]["detection_pipeline_ms"])
                        step_values["pipeline_ms"].append(result["time_ms"])
                        results.append(result)
                    except Exception as exc:
                        logger.warning(f"测试图片处理失败 {image_path}: {exc}")
                    finally:
                        if image is not None:
                            image.close()
        finally:
            if old_mapping_exists:
                inference_worker.camera_product_map[test_cam_id] = old_mapping
            else:
                inference_worker.camera_product_map.pop(test_cam_id, None)

        timing = {
            **timing_stats(step_values["pipeline_ms"]),
            "pipeline_total_ms": round((time.perf_counter() - pipeline_start) * 1000, 2),
            "steps": {key: timing_stats(values) for key, values in step_values.items() if values},
            "step_labels": STEP_LABELS,
        }
        total = counts["total"]
        response = {"success": True, "mode": mode, "model_name": model_name, "total": total, "timing": timing, "results": results}
        if mode == "labeled":
            response.update({
                "correct": counts["correct"],
                "accuracy": round(counts["correct"] / total, 4) if total else 0,
                "upright_total": counts["upright_total"],
                "upright_correct": counts["upright_correct"],
                "upright_accuracy": round(counts["upright_correct"] / counts["upright_total"], 4) if counts["upright_total"] else None,
                "inverted_total": counts["inverted_total"],
                "inverted_correct": counts["inverted_correct"],
                "inverted_accuracy": round(counts["inverted_correct"] / counts["inverted_total"], 4) if counts["inverted_total"] else None,
            })
        return jsonify(response)
    except Exception as e:
        logger.error(f"模型测试失败: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500

# ========== 训练 API ==========


def _training_status_callback(
    epoch, total_epochs, train_loss, val_loss, val_acc, message
):
    """训练进度回调，更新全局状态供前端轮询"""
    if epoch > 0:
        training_state["epoch"] = epoch
    training_state["total_epochs"] = total_epochs
    training_state["train_loss"] = round(train_loss, 4)
    training_state["val_loss"] = round(val_loss, 4)
    training_state["val_acc"] = round(val_acc, 4)
    training_state["message"] = message
    if total_epochs > 0:
        training_state["progress"] = round(
            min(epoch, total_epochs) / total_epochs * 100, 1
        )


def _run_training(folder_path, model_name, upright_path=None, inverted_path=None):
    """后台训练线程"""
    global training_state
    try:
        from .training import (
            JarDataset,
            JarClassifier,
            train_model_v2,
            set_training_device,
        )

        # 应用用户配置的训练设备
        training_device = getattr(Config, "TRAINING_DEVICE", Config.DEVICE)
        set_training_device(training_device)
        logger.info(f"训练设备: {training_device}")

        logger.info(
            f"开始训练: model={model_name}, upright={upright_path}, inverted={inverted_path}, folder={folder_path}"
        )
        training_state["message"] = "正在加载数据..."

        train_set = JarDataset(
            Path(folder_path) if folder_path else Path.cwd(),
            train=True,
            augment=True,
            upright_dir=Path(upright_path) if upright_path else None,
            inverted_dir=Path(inverted_path) if inverted_path else None,
        )
        val_set = JarDataset(
            Path(folder_path) if folder_path else Path.cwd(),
            train=False,
            augment=False,
            upright_dir=Path(upright_path) if upright_path else None,
            inverted_dir=Path(inverted_path) if inverted_path else None,
        )

        logger.info(
            f"数据集模式: {train_set.mode}, 训练集={len(train_set)}, 验证集={len(val_set)}"
        )

        training_state["trainCount"] = len(train_set)
        training_state["valCount"] = len(val_set)

        from torch.utils.data import DataLoader

        # 自适应 batch size：不超过训练集大小的 1/2，也不超过验证集大小
        adaptive_batch = min(
            Config.TRAINING_BATCH_SIZE,
            max(2, len(train_set) // 2),
            max(2, len(val_set)),
        )
        if adaptive_batch < Config.TRAINING_BATCH_SIZE:
            logger.info(
                f"数据集较小，batch_size 自动调整为 {adaptive_batch} "
                f"(原 {Config.TRAINING_BATCH_SIZE}, 训练集={len(train_set)}, 验证集={len(val_set)})"
            )

        train_ldr = DataLoader(
            train_set,
            batch_size=adaptive_batch,
            shuffle=True,
            drop_last=True,
            num_workers=0,  # Windows 多进程在 daemon 线程中有问题，用 0
            pin_memory=True,  # 加速 CPU→GPU 传输
        )
        val_ldr = DataLoader(
            val_set,
            batch_size=adaptive_batch,
            drop_last=False,
            num_workers=0,
            pin_memory=True,
        )

        model_path = Config.DATA_DIR / f"jar_classifier_{model_name}.pth"

        # 传递停止标志检查函数
        def _check_stop():
            return _training_stop_flag

        model, history = train_model_v2(
            JarClassifier(),
            train_ldr,
            val_ldr,
            save_path=model_path,
            epochs=Config.TRAINING_EPOCHS,
            lr=Config.TRAINING_LR,
            finetune_lr=Config.TRAINING_FINETUNE_LR,
            freeze_epochs=Config.TRAINING_FREEZE_EPOCHS,
            early_stop_patience=Config.TRAINING_EARLY_STOP,
            status_callback=_training_status_callback,
            stop_flag_fn=_check_stop,
        )

        logger.info(f"模型已保存: {model_path}")

        # 清除模型缓存，下次推理自动加载新模型
        from .inference_worker import models, load_model

        models.clear()
        load_model(model_name)
        logger.info("推理模型已更新")

        training_state["history"] = history
        training_state["modelPath"] = str(model_path)
        training_state["evalResult"] = history.get("eval", {})
        training_state["message"] = (
            f"训练完成！最佳轮次: {history['best_epoch']}, "
            f"验证准确率: {history['eval']['accuracy']:.2%}"
        )
        training_state["progress"] = 100
        logger.info(f"训练完成: {training_state['message']}")

    except Exception as e:
        logger.error(f"训练失败: {e}", exc_info=True)
        training_state["message"] = f"训练失败: {str(e)}"
        training_state["evalResult"] = None
        training_state["modelPath"] = None
    finally:
        training_state["running"] = False


@app.route("/api/training/start", methods=["POST"])
def start_training():
    """启动训练"""
    global training_state, _training_thread, _training_stop_flag

    if training_state["running"]:
        return jsonify({"success": False, "message": "训练已在运行中"})

    try:
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "训练参数格式无效"}), 400

        def clean_path(field_name):
            value = data.get(field_name, "")
            if value is None:
                return ""
            if not isinstance(value, str):
                raise ValueError(f"{field_name} 必须是文本路径")
            return value.strip()

        folder_path = clean_path("folderPath")
        upright_path = clean_path("uprightPath")
        inverted_path = clean_path("invertedPath")
        model_name = clean_path("modelName") or "default"

        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}

        def validate_image_directory(path_value, label, recursive=False):
            directory = Path(path_value)
            if not directory.is_dir():
                return f"{label}不存在或不是文件夹: {path_value}"
            try:
                candidates = directory.rglob("*") if recursive else directory.iterdir()
                image_count = sum(
                    1
                    for item in candidates
                    if item.is_file() and item.suffix.lower() in image_extensions
                )
            except OSError as exc:
                return f"无法读取{label}: {exc}"
            if image_count == 0:
                return f"{label}中没有可识别的图片文件: {path_value}"
            return None

        if upright_path and inverted_path:
            # 双目录模式
            error = validate_image_directory(upright_path, "正罐目录")
            if error:
                return jsonify({"success": False, "message": error}), 400
            error = validate_image_directory(inverted_path, "倒罐目录")
            if error:
                return jsonify({"success": False, "message": error}), 400
        elif folder_path:
            # 单目录模式（需包含 正/ 反/ 子目录）
            error = validate_image_directory(folder_path, "图片目录", recursive=True)
            if error:
                return jsonify({"success": False, "message": error}), 400
        else:
            return jsonify({"success": False, "message": "请选择图片文件夹"}), 400

        # 重置状态
        training_state.update(
            {
                "running": True,
                "progress": 0,
                "epoch": 0,
                "total_epochs": Config.TRAINING_EPOCHS,
                "train_loss": 0,
                "val_loss": 0,
                "val_acc": 0,
                "message": "正在初始化...",
                "history": None,
                "folderPath": folder_path,
                "uprightPath": upright_path,
                "invertedPath": inverted_path,
                "modelName": model_name,
                "modelPath": None,
                "evalResult": None,
                "trainCount": 0,
                "valCount": 0,
            }
        )
        _training_stop_flag = False

        _training_thread = threading.Thread(
            target=_run_training,
            args=(folder_path, model_name, upright_path, inverted_path),
            daemon=True,
        )
        _training_thread.start()

        logger.info(f"训练线程已启动: {folder_path}")
        return jsonify({"success": True, "message": "训练已启动"})

    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        logger.error(f"启动训练失败: {e}")
        training_state["running"] = False
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/api/training/status", methods=["GET"])
def get_training_status():
    """获取训练进度"""
    return jsonify(training_state)


@app.route("/api/training/stop", methods=["POST"])
def stop_training():
    """停止训练"""
    global _training_stop_flag
    _training_stop_flag = True
    training_state["running"] = False
    training_state["message"] = "训练已手动停止"
    logger.info("训练已手动停止")
    return jsonify({"success": True, "message": "训练已停止"})


@app.route("/api/training/history", methods=["GET"])
def get_training_history():
    """获取最近训练历史"""
    history_path = Config.DATA_DIR / "training_history.json"
    if history_path.exists():
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                return jsonify({"success": True, "history": json.load(f)})
        except Exception:
            pass
    return jsonify({"success": True, "history": training_state.get("history")})


# ========== 启动服务器 ==========


def run_server():
    """启动 Flask 服务器"""
    global env_check_result

    # 启动前加载线体数量，确保环境检测和相机槽位与前端设置一致
    try:
        _apply_line_count(_load_line_count())
    except Exception as e:
        logger.warning(f"加载线体数量失败，使用默认值: {e}")

    Config.ensure_directories()

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
    env_check_result = run_environment_check()

    if env_check_result["passed"]:
        logger.info("环境检测通过，继续初始化相机管理器")
    else:
        logger.warning(
            f"环境检测未通过: {env_check_result['errorCount']} 个错误, "
            f"{env_check_result['warningCount']} 个警告"
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
    _start_save_worker()

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


if __name__ == "__main__":
    run_server()


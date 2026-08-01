"""系统状态、环境和本地设置相关 API。"""

from flask import Blueprint, jsonify, request

from . import __version__, model_loader
from .config import Config
from .logger import logger
from .camera_config_manager import camera_config_manager
from .env_check import run_environment_check
from .hardware_service import collect_hardware_info
from .runtime_state import runtime
from .settings_repository import (
    load_device_config,
    load_line_count,
    load_save_only_reject,
    normalize_line_count,
    save_device_config,
    save_line_count,
    save_save_only_reject,
)


system_bp = Blueprint("system", __name__)


@system_bp.route("/api/health", methods=["GET"])
def health():
    """健康检查"""
    cam_status = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        camera_state = runtime.get_camera_state(i)
        if camera_state is not None:
            cam_status[i] = camera_state["state"] != "disconnected"
        else:
            cam_status[i] = False
    return jsonify(
        {
            "status": "ok",
            "version": __version__,
            "cameras": cam_status,
            "modelLoaded": model_loader.model_loaded,
            "running": runtime.system_running,
            "dataDir": str(Config.DATA_DIR),
        }
    )


@system_bp.route("/api/env-check", methods=["GET"])
def env_check():
    """环境检测 — 返回所有检测项结果"""
    if runtime.env_check_result is None:
        runtime.env_check_result = run_environment_check()
    return jsonify(runtime.env_check_result)


@system_bp.route("/api/hardware", methods=["GET"])
def hardware_info():
    """返回详细的 CPU/GPU/内存/硬盘 硬件信息，供前端展示和选择"""
    return jsonify({"success": True, "hardware": collect_hardware_info()})

def apply_line_count(count):
    """更新运行时线体/相机槽位数量，并补齐相机配置。"""
    count = normalize_line_count(count)
    Config.CAMERA_COUNT = count
    runtime.line_enabled = {i: runtime.line_enabled.get(i, True) for i in range(1, count + 1)}
    camera_config_manager.ensure_camera_slots(count)
    runtime.stats = {
        i: runtime.stats.get(i, {"detected": 0, "defective": 0})
        for i in range(1, count + 1)
    }
    for cam_id in range(1, count + 1):
        runtime.camera_states.setdefault(cam_id, {
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
    for cam_id in list(runtime.camera_states):
        if cam_id > count and cam_id not in runtime.cameras:
            runtime.camera_states.pop(cam_id, None)
    return save_line_count(count)


@system_bp.route("/api/settings/line-count", methods=["GET"])
def get_line_count():
    """获取当前线体数量"""
    return jsonify({"success": True, "line_count": Config.CAMERA_COUNT})


@system_bp.route("/api/settings/line-count", methods=["POST"])
def update_line_count():
    """保存并应用线体数量（1-16），运行中禁止修改。"""
    if runtime.system_running:
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
        count = apply_line_count(count)
        return jsonify({"success": True, "message": "线体数量已保存", "line_count": count})
    except Exception as e:
        logger.error(f"保存线体数量失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@system_bp.route("/api/settings/device", methods=["GET"])
def get_device_config():
    """获取设备选择配置"""
    cfg = load_device_config()
    return jsonify({"success": True, "config": cfg})


@system_bp.route("/api/settings/device", methods=["POST"])
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
    save_device_config(cfg)

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
        from .model_loader import reload_all_models

        reload_all_models(inference_device)
    except Exception as e:
        logger.warning(f"重载推理模型失败: {e}")

    logger.info(
        f"设备配置已更新并生效: 训练={training_device}, 推理={inference_device}"
    )
    return jsonify(
        {"success": True, "message": "设备配置已保存并即时生效", "config": cfg}
    )


@system_bp.route("/api/settings/save-only-reject", methods=["GET"])
def get_save_only_reject():
    """获取"仅保存剔除照片"开关状态。"""
    return jsonify({"success": True, "enabled": bool(runtime.save_only_reject)})


@system_bp.route("/api/settings/save-only-reject", methods=["POST"])
def update_save_only_reject():
    """开启/关闭"仅保存剔除照片"（全局生效，即时作用于相机存盘）。"""
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("enabled"))
    try:
        runtime.save_only_reject = save_save_only_reject(enabled)
    except OSError as exc:
        logger.error(f"保存照片保存策略失败: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500
    logger.info(f"照片保存策略已更新: 仅保存剔除照片 = {runtime.save_only_reject}")
    return jsonify({"success": True, "enabled": runtime.save_only_reject})



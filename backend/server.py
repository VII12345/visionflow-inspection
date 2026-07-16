"""
Flask HTTP 服务器
提供 REST API 给 Electron 前端
"""

import io
import json
import os
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
            "system": {"running": system_running, "modelLoaded": False},
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
    return jsonify({"success": True})


# ========== 保存设置 API ==========

save_settings = {
    i: {"saveGood": True, "saveBad": True} for i in range(1, Config.CAMERA_COUNT + 1)
}


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
}
_training_thread = None
_training_stop_flag = False


@app.route("/api/save-settings", methods=["GET"])
def get_save_settings():
    """获取所有保存设置"""
    return jsonify({"success": True, "settings": save_settings})


@app.route("/api/save-settings/<int:cam_id>", methods=["POST"])
def update_save_settings(cam_id):
    """更新保存设置"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    data = request.get_json()
    save_settings[cam_id] = {
        "saveGood": data.get("saveGood", True),
        "saveBad": data.get("saveBad", True),
    }
    logger.info(f"更新保存设置 Cam{cam_id}: {save_settings[cam_id]}")
    return jsonify({"success": True})


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
    file_path = Config.CAPTURE_DIR / f"cam{cam_id}" / safe_name

    if not file_path.exists():
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
        for sub in ["正", "反", "未分類", ""]:
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

            # 照片存盘 — 文件名编码检测结果
            try:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                millis = int((time.time() * 1000) % 1000)
                # 根据推理结果分目录存储
                if submitted and result:
                    tag = "OK" if result["label"] == "正" else "NG"
                else:
                    tag = "UNK"
                subdir = "正" if tag == "OK" else ("反" if tag == "NG" else "未分类")
                filename = f"CAM{cam_id}_{timestamp}_{millis:03d}.bmp"
                save_path = Config.CAPTURE_DIR / f"cam{cam_id}" / subdir / filename
                save_path.parent.mkdir(parents=True, exist_ok=True)
                frame.save(save_path, "BMP")
                logger.info(f"Camera {cam_id}: 原图已保存 → {save_path.name}")
            except Exception as e:
                logger.error(f"Camera {cam_id}: 保存照片失败: {e}")

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
        from .training import JarDataset, JarClassifier, train_model_v2

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

        from torch.utils.data import DataLoader

        train_ldr = DataLoader(
            train_set, batch_size=Config.TRAINING_BATCH_SIZE, shuffle=True
        )
        val_ldr = DataLoader(val_set, batch_size=Config.TRAINING_BATCH_SIZE)

        model_path = Config.DATA_DIR / f"jar_classifier_{model_name}.pth"

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
        data = request.get_json()
        folder_path = data.get("folderPath", "").strip()
        upright_path = data.get("uprightPath", "").strip()
        inverted_path = data.get("invertedPath", "").strip()
        model_name = data.get("modelName", "").strip()

        if not model_name:
            model_name = "default"

        if upright_path and inverted_path:
            # 双目录模式
            if not Path(upright_path).exists():
                return jsonify(
                    {"success": False, "message": f"正罐目录不存在: {upright_path}"}
                ), 400
            if not Path(inverted_path).exists():
                return jsonify(
                    {"success": False, "message": f"倒罐目录不存在: {inverted_path}"}
                ), 400
        elif folder_path:
            # 单目录模式（需包含 正/ 反/ 子目录）
            if not Path(folder_path).exists():
                return jsonify(
                    {"success": False, "message": f"文件夹不存在: {folder_path}"}
                ), 400
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

    Config.ensure_directories()

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

    # 启动推理 worker
    start_inference_worker()

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

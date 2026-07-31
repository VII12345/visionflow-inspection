"""
Flask HTTP 服务器
提供 REST API 给 React/Tauri 前端
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
from .plc_service import get_plc_config, save_plc_config, PlcWriteError, PlcService, plc_service
from .runtime_state import runtime
from .camera_routes import camera_bp
from .capture_service import cleanup_photos, start_save_worker, submit_save
from .model_repository import get_model_reject_labels as _get_model_reject_labels
from .model_routes import model_bp
from .photo_routes import photo_bp
from .system_routes import apply_line_count as _apply_line_count, system_bp
from .training_routes import training_bp
from .settings_repository import (
    load_device_config as _load_device_config,
    load_line_count as _load_line_count,
    normalize_line_count as _normalize_line_count,
    save_device_config as _save_device_config,
    save_line_count as _save_line_count,
)


# 初始化 Flask
app = Flask(__name__)
CORS(app)  # 允许跨域
app.register_blueprint(system_bp)
app.register_blueprint(camera_bp)
app.register_blueprint(model_bp)
app.register_blueprint(photo_bp)
app.register_blueprint(training_bp)


def initialize_camera_manager():
    """初始化相机管理器"""

    logger.info("初始化相机管理器（使用真实 MVS 相机）")
    runtime.camera_manager = MVSCameraManager()
    runtime.camera_manager.initialize()

    # 初始化相机状态
    for i in range(1, Config.CAMERA_COUNT + 1):
        runtime.camera_states[i] = {
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

    logger.info(f"相机状态已初始化: {len(runtime.camera_states)} 个相机槽位")


# ========== API 端点 ==========


def _stop_camera(cam_id):
    """停止并清理单个相机实例。"""
    cam = runtime.cameras.pop(cam_id, None)
    if cam is not None:
        try:
            cam.stop_grabbing()
        except Exception as e:
            logger.warning(f"Cam{cam_id} 停止取流失败: {e}")
        try:
            cam.disconnect()
        except Exception as e:
            logger.warning(f"Cam{cam_id} 断开失败: {e}")
    if cam_id in runtime.camera_states:
        runtime.update_camera_state(cam_id, state="ready", error=None, fps=0)


def _start_camera(cam_id, cam_config, available_cameras):
    """按配置连接并启动单个相机，返回 (success, error_message)。"""
    target_ip = cam_config.get("ip")
    device_index = next(
        (idx for idx, cam_info in enumerate(available_cameras) if cam_info.get("ip") == target_ip),
        None,
    )
    if device_index is None:
        error_msg = f"Cam{cam_id} 未找到IP为 {target_ip} 的相机"
        runtime.update_camera_state(cam_id, state="error", error=f"未找到IP: {target_ip}")
        logger.warning(error_msg)
        return False, error_msg

    _stop_camera(cam_id)
    try:
        cam = runtime.camera_manager.create_camera(cam_id, device_index)
        runtime.cameras[cam_id] = cam
        cam.connect()
        cam.set_exposure_time(cam_config.get("exposureTime", 5000))
        cam.set_gain(cam_config.get("gain", 0))
        cam.set_trigger_delay(cam_config.get("triggerDelay", 0))
        cam.set_line_debouncer(cam_config.get("lineDebouncerTime", 50))
        cam.set_strobe(
            cam_config.get("strobeEnable", False),
            cam_config.get("strobeDelay", 0),
            cam_config.get("strobeDuration", 1000),
        )
        cam.start_grabbing(
            trigger_source=cam_config.get("triggerSource", "Line0"),
            trigger_activation=cam_config.get("triggerActivation", "RisingEdge"),
        )
        cam.trigger_timeout = cam_config.get("triggerTimeout", 30000)
        threading.Thread(target=camera_worker, args=(cam_id,), daemon=True).start()

        info = cam.get_info()
        runtime.update_camera_state(
            cam_id,
            state="running",
            triggerMode="hardware",
            totalTriggers=0,
            serial=info["serial"],
            model=info["model"],
            ip=info.get("ip"),
            error=None,
        )
        logger.info(f"Cam{cam_id} 启动成功: {info['model']} ({target_ip})")
        return True, None
    except Exception as e:
        error_msg = f"Cam{cam_id} 启动失败: {str(e)}"
        logger.error(error_msg)
        _stop_camera(cam_id)
        runtime.update_camera_state(cam_id, state="error", error=str(e))
        return False, error_msg


@app.route("/api/start", methods=["POST"])
def start_system():
    """启动选中的相机；未传 camera_ids 时启动所有已启用相机。"""

    if runtime.system_running:
        return jsonify({"success": False, "message": "系统已在运行中"}), 409

    try:
        logger.info("启动系统...")
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

        if runtime.camera_manager is None:
            return jsonify({
                "success": False,
                "message": "相机管理器未初始化，请检查 MVS SDK 安装或查看环境检测结果",
            }), 500

        enabled_cameras = camera_config_manager.get_enabled_cameras()
        requested_ids = data.get("camera_ids")
        if requested_ids is not None:
            try:
                requested_ids = {int(cam_id) for cam_id in requested_ids}
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "线路选择无效"}), 400
            invalid_ids = requested_ids - set(range(1, Config.CAMERA_COUNT + 1))
            if invalid_ids:
                return jsonify({"success": False, "message": "线路选择超出范围"}), 400
            runtime.line_enabled = {i: i in requested_ids for i in range(1, Config.CAMERA_COUNT + 1)}
            enabled_cameras = {
                cam_id: cam_config
                for cam_id, cam_config in enabled_cameras.items()
                if cam_id in requested_ids
            }
        else:
            requested_ids = {i for i in range(1, Config.CAMERA_COUNT + 1) if runtime.line_enabled.get(i, True)}
            enabled_cameras = {
                cam_id: cam_config
                for cam_id, cam_config in enabled_cameras.items()
                if cam_id in requested_ids
            }

        if not enabled_cameras:
            logger.warning("没有选中的已启用相机配置")
            return jsonify({
                "success": False,
                "message": "没有选中的相机，请先启用线路并配置相机IP地址",
            }), 400

        runtime.system_running = True
        available_cameras = runtime.camera_manager.enumerate_cameras()
        logger.info(f"检测到 {len(available_cameras)} 台物理相机")
        started_cameras = []
        errors = []

        for cam_id, cam_config in enabled_cameras.items():
            ok, error_msg = _start_camera(cam_id, cam_config, available_cameras)
            if ok:
                started_cameras.append(cam_id)
            elif error_msg:
                errors.append(error_msg)

        if not started_cameras:
            runtime.system_running = False
            return jsonify({"success": False, "message": "所有选中的相机启动失败", "errors": errors}), 500

        message = f"系统启动成功，启动了 {len(started_cameras)}/{len(enabled_cameras)} 个相机"
        if errors:
            message += f"，{len(errors)} 个相机启动失败"
        logger.info(message)
        return jsonify({
            "success": True,
            "message": message,
            "started": len(started_cameras),
            "started_cameras": started_cameras,
            "total": len(enabled_cameras),
            "errors": errors if errors else None,
            "running": runtime.system_running,
        })
    except Exception as e:
        logger.error(f"启动失败: {e}")
        runtime.system_running = False
        return jsonify({"success": False, "message": f"启动失败: {str(e)}"}), 500


@app.route("/api/lines/<int:cam_id>", methods=["POST"])
def set_line_enabled(cam_id):
    """运行中实时启停单条线路；系统停止时也会保存线路选择。"""

    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "message": "线路编号无效"}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("enabled"), bool):
        return jsonify({"success": False, "message": "enabled 必须是布尔值"}), 400

    enabled = data["enabled"]
    runtime.line_enabled[cam_id] = enabled
    if not enabled:
        _stop_camera(cam_id)
        if not runtime.cameras:
            runtime.system_running = False
        return jsonify({
            "success": True,
            "enabled": False,
            "running": runtime.system_running,
            "message": f"线路 {cam_id} 已关闭",
        })

    if runtime.camera_manager is None:
        runtime.line_enabled[cam_id] = False
        return jsonify({"success": False, "message": "相机管理器未初始化"}), 500

    cam_config = camera_config_manager.get_camera_config(cam_id)
    if not cam_config or not cam_config.get("enabled") or not cam_config.get("ip"):
        runtime.line_enabled[cam_id] = False
        return jsonify({"success": False, "message": f"线路 {cam_id} 尚未配置可用相机"}), 400

    try:
        if not runtime.system_running:
            runtime.system_running = True
        available_cameras = runtime.camera_manager.enumerate_cameras()
        ok, error_msg = _start_camera(cam_id, cam_config, available_cameras)
        if not ok:
            runtime.line_enabled[cam_id] = False
            if not runtime.cameras:
                runtime.system_running = False
            return jsonify({"success": False, "message": error_msg or f"线路 {cam_id} 启动失败", "running": runtime.system_running}), 500
        return jsonify({
            "success": True,
            "enabled": True,
            "running": runtime.system_running,
            "message": f"线路 {cam_id} 已启动",
        })
    except Exception as e:
        runtime.line_enabled[cam_id] = False
        if not runtime.cameras:
            runtime.system_running = False
        logger.error(f"线路 {cam_id} 启动失败: {e}")
        return jsonify({"success": False, "message": str(e), "running": runtime.system_running}), 500


@app.route("/api/stop", methods=["POST"])
def stop_system():
    """停止所有相机。"""

    if not runtime.system_running:
        return jsonify({"success": False, "message": "系统未运行"}), 409

    try:
        logger.info("停止系统...")
        runtime.system_running = False
        for cam_id in list(runtime.cameras.keys()):
            _stop_camera(cam_id)
        logger.info("系统停止成功")
        return jsonify({"success": True, "message": "系统停止成功", "running": False})
    except Exception as e:
        logger.error(f"停止失败: {e}")
        return jsonify({"success": False, "message": f"停止失败: {str(e)}"}), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    """获取系统状态（主要轮询端点）"""
    camera_status = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        state, camera_stats, result = runtime.get_camera_snapshot(i)
        camera_status[str(i)] = {
            "state": state["state"],
            "lineEnabled": runtime.line_enabled.get(i, True),
            "serial": state["serial"],
            "model": state["model"],
            "triggerMode": state["triggerMode"],
            "fps": state["fps"],
            "totalTriggers": state["totalTriggers"],
            "lastFrameTime": state["lastFrameTime"],
            "stats": camera_stats,
            "error": state["error"],
        }

        if result is not None:
            camera_status[str(i)]["result"] = result

    return jsonify(
        {
            "cameras": camera_status,
            "system": {
                "running": runtime.system_running,
                "modelLoaded": inference_worker.model_loaded,
            },
        }
    )


@app.route("/api/frame/<int:cam_id>", methods=["GET"])
def get_frame(cam_id):
    """获取最新帧（JPEG）"""
    img = runtime.get_latest_frame(cam_id)
    if img is None:
        # 相机已配置但尚未产生第一帧时，不视为接口不存在；用 204 告知前端暂时无图像，避免轮询日志持续刷 404。
        return "", 204

    try:
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
    result = runtime.get_latest_result(cam_id)
    if result is None:
        return jsonify({"error": "No result available"}), 404

    return jsonify(result)


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """获取统计数据"""
    return jsonify(runtime.get_stats_snapshot())


@app.route("/api/stats/reset/<int:cam_id>", methods=["POST"])
def reset_stats(cam_id):
    """重置统计"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"error": "Invalid camera ID"}), 400

    stats = runtime.reset_camera_stats(cam_id)
    logger.info(f"重置 Camera {cam_id} 统计")
    return jsonify({"success": True, "stats": stats})


# ========== 相机工作线程 ==========


def camera_worker(cam_id):
    """
    相机工作线程（触发模式）
    阻塞等待传感器触发 → 抓帧 → 推理 → 更新结果 → 继续等待下一个触发
    """
    logger.info(f"Camera {cam_id} worker 启动（触发模式：等待传感器信号...）")
    cam = runtime.cameras[cam_id]
    frame_count = 0
    start_time = time.time()
    wait_count = 0

    while runtime.system_running and cam.running:
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
            runtime.set_latest_frame(cam_id, frame)

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
                    runtime.set_latest_result(cam_id, result)
                    runtime.increment_stat(cam_id, "detected")
                    plc_config = get_plc_config()
                    model_name = inference_worker.camera_product_map.get(cam_id)
                    reject_labels = _get_model_reject_labels(model_name)
                    should_reject = result["label"] in reject_labels
                    if should_reject:
                        runtime.increment_stat(cam_id, "defective")
                    if plc_config.get("enabled", True) and should_reject:
                        try:
                            plc_service.with_base_url(plc_config.get("base_url", plc_service.base_url)).write_reject_signal(cam_id)
                        except (PlcWriteError, ValueError) as e:
                            logger.error(f"Camera {cam_id}: 结果写入 PLC 失败: {e}")
                    logger.info(
                        f"Camera {cam_id}: #{frame_count} → {result['label']} ({result['confidence']:.2f})"
                    )
                else:
                    logger.warning(f"Camera {cam_id}: 推理超时，跳过此帧")
                    continue
            else:
                # 模型未就绪，记录但不推理
                logger.warning(f"Camera {cam_id}: 模型未就绪，无法推理")
                runtime.increment_stat(cam_id, "detected")

            # 照片存盘 — 异步写入，不阻塞抓帧循环。各类别照片的保存开关
            # 来自 /api/save-settings，并且在后端进程内直接生效。
            try:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                millis = int((time.time() * 1000) % 1000)
                if submitted and result:
                    plc_config = get_plc_config()
                    tag = result["label"]
                    model_name = inference_worker.camera_product_map.get(cam_id)
                    reject_labels = _get_model_reject_labels(model_name)
                    setting_key = "saveBad" if tag in reject_labels else "saveGood"
                    should_save = runtime.save_settings.get(cam_id, {}).get(setting_key, True)
                    subdir = tag
                else:
                    tag = "未分类"
                    should_save = True
                    subdir = tag
                if should_save:
                    filename = f"CAM{cam_id}_{timestamp}_{millis:03d}.bmp"
                    save_path = Config.CAPTURE_DIR / f"cam{cam_id}" / subdir / filename
                    # 异步提交存盘（非阻塞，存盘在后台线程慢慢写）
                    submit_save(frame.copy(), save_path)
            except Exception as e:
                logger.error(f"Camera {cam_id}: 提交存盘失败: {e}")

            # 更新状态
            elapsed = time.time() - start_time
            fps = round(frame_count / elapsed, 2) if elapsed > 0 else 0
            runtime.update_camera_state(
                cam_id,
                lastFrameTime=time.strftime("%Y-%m-%dT%H:%M:%S"),
                totalTriggers=frame_count,
                fps=fps,
            )

        except Exception as e:
            logger.error(f"Camera {cam_id} worker 错误: {e}")
            runtime.update_camera_state(cam_id, error=str(e), state="error")
            # 短暂等待后重试
            time.sleep(1)

    logger.info(f"Camera {cam_id} worker 停止（共处理 {frame_count} 张图片）")


# ========== 模型测试 API ==========


@app.route("/api/test", methods=["POST"])
def test_model():
    """使用真实 inference_queue、推理 Worker 和异步存盘队列执行测试。"""
    import tempfile
    from PIL import Image
    from .inference_worker import get_inference_result, submit_inference, set_camera_product

    IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    STEP_LABELS = {
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
        model_categories = ["类别1", "类别2"]
        model_path = Config.get_active_model_path(model_name)
        if model_path is not None:
            metadata_path = model_path.with_suffix(".json")
            try:
                if metadata_path.exists():
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                    if isinstance(metadata.get("categories"), list) and metadata["categories"]:
                        model_categories = [str(item) for item in metadata["categories"]]
            except Exception:
                pass
        if mode not in ("labeled", "unlabeled"):
            return jsonify({"success": False, "message": "无效的测试模式"}), 400
        if runtime.system_running:
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

        step_values = {key: [] for key in STEP_LABELS}
        set_camera_product(test_cam_id, model_name)

        sources = []
        if mode == "labeled":
            category_root = (data.get("category_root_path") or "").strip()
            if category_root:
                root = Path(category_root)
                if not root.is_dir():
                    return jsonify({"success": False, "message": "类别根目录不存在"}), 400
                for category_dir in sorted(root.iterdir(), key=lambda item: item.name):
                    if not category_dir.is_dir():
                        continue
                    sources.extend((path, category_dir.name) for path in sorted(category_dir.iterdir()) if path.suffix.lower() in IMG_EXTS)
            else:
                class_a_path = (data.get("class_a_path") or "").strip()
                class_b_path = (data.get("class_b_path") or "").strip()
                if not class_a_path and not class_b_path:
                    return jsonify({"success": False, "message": "请指定类别根目录"}), 400
                for expected, folder_value in zip(model_categories[:2], (class_a_path, class_b_path)):
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
        # 模型路由和文件枚举属于测试启动准备，不计入图片处理耗时。
        pipeline_start = time.perf_counter()
        results = []
        counts = {"total": 0, "correct": 0}
        category_counts = {name: {"total": 0, "correct": 0} for name in model_categories}

        try:
            with tempfile.TemporaryDirectory(prefix="vision_test_captures_", dir=str(Config.DATA_DIR)) as temp_dir:
                save_root = Path(temp_dir) / "captures"
                for image_path, expected in sources:
                    image = None
                    try:
                        # 与实际相机帧进入 worker 前一致：读取并转换为 RGB 图像对象。读取本身不计入测试耗时。
                        with Image.open(image_path) as source_image:
                            image = source_image.convert("RGB")
                        image_start = time.perf_counter()

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
                            bucket = category_counts.setdefault(expected, {"total": 0, "correct": 0})
                            bucket["total"] += 1
                            if is_correct:
                                bucket["correct"] += 1
                        result = {"filename": image_path.name, "predicted": predicted, "confidence": round(confidence, 4)}
                        if expected is not None:
                            result.update({"expected": expected, "correct": is_correct})
                        step_values["result_output_ms"].append((time.perf_counter() - t0) * 1000)

                        # 模拟实际 _submit_save：先异步入队，再等待同一个异步 Worker 写盘完成。
                        t0 = time.perf_counter()
                        save_copy = image.copy()
                        step_values["frame_copy_ms"].append((time.perf_counter() - t0) * 1000)
                        save_subdir = predicted or "未分类"
                        save_path = save_root / save_subdir / f"{image_path.stem}.bmp"
                        done_event = threading.Event()
                        completion = {}
                        t0 = time.perf_counter()
                        save_submitted = submit_save(save_copy, save_path, done_event, completion)
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
                "category_counts": {
                    name: {
                        "total": bucket["total"],
                        "correct": bucket["correct"],
                        "accuracy": round(bucket["correct"] / bucket["total"], 4) if bucket["total"] else None,
                    }
                    for name, bucket in category_counts.items()
                },
                "categories": model_categories,
            })
        return jsonify(response)
    except Exception as e:
        logger.error(f"模型测试失败: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500

# ========== 启动服务器 ==========


def run_server():
    """启动 Flask 服务器"""

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
    runtime.env_check_result = run_environment_check()

    if runtime.env_check_result["passed"]:
        logger.info("环境检测通过，继续初始化相机管理器")
    else:
        logger.warning(
            f"环境检测未通过: {runtime.env_check_result['errorCount']} 个错误, "
            f"{runtime.env_check_result['warningCount']} 个警告"
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
    start_save_worker()

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

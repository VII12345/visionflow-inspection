"""相机运行服务：初始化相机管理器、启停相机与触发工作线程。"""

import threading
import time

from .config import Config
from .logger import logger
from .mvs_camera_manager import MVSCameraManager
from .inference_worker import submit_inference, get_inference_result
from . import model_loader
from .plc_service import get_plc_config, PlcWriteError, plc_service
from .runtime_state import runtime
from .capture_service import submit_save
from .model_repository import get_model_reject_labels as _get_model_reject_labels


def should_save_photo(save_only_reject, save_settings, cam_id, tag, reject_labels):
    """判定某张照片是否应保存。

    - 开启"仅保存剔除照片"：只有命中剔除类别才保存；
    - 否则按相机级 saveGood/saveBad 开关决定。
    """
    if save_only_reject:
        return tag in reject_labels
    setting_key = "saveBad" if tag in reject_labels else "saveGood"
    return bool(save_settings.get(cam_id, {}).get(setting_key, True))


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


def stop_camera(cam_id):
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


def start_camera(cam_id, cam_config, available_cameras):
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

    stop_camera(cam_id)
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
        stop_camera(cam_id)
        runtime.update_camera_state(cam_id, state="error", error=str(e))
        return False, error_msg


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
            if model_loader.model_loaded:
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
                    model_name = model_loader.camera_product_map.get(cam_id)
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
                    model_name = model_loader.camera_product_map.get(cam_id)
                    reject_labels = _get_model_reject_labels(model_name)
                    should_save = should_save_photo(
                        runtime.save_only_reject,
                        runtime.save_settings,
                        cam_id,
                        tag,
                        reject_labels,
                    )
                    subdir = tag
                else:
                    tag = "未分类"
                    should_save = not runtime.save_only_reject
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

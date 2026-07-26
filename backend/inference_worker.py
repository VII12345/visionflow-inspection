"""
推理队列 Worker
单线程推理避免 PyTorch 并发问题
"""

import queue
import threading
import time
from pathlib import Path

import torch
from PIL import Image

from .config import Config
from .logger import logger


# 全局推理队列
inference_queue = queue.Queue(maxsize=Config.INFERENCE_QUEUE_SIZE)
result_queues = {i: queue.Queue() for i in range(1, Config.CAMERA_COUNT + 1)}

# 全局模型（按产品名缓存）
models = {}  # {model_name: JarClassifier}
model_loaded = False
camera_product_map = {}  # {cam_id: model_name}  每个摄像头用哪个产品的模型


def set_camera_product(cam_id, model_name):
    """设置摄像头使用的产品模型"""
    camera_product_map[cam_id] = model_name
    # 预加载对应模型
    if model_name and model_name not in models:
        load_model(model_name)
    logger.info(f"Cam{cam_id} → 模型: {model_name or '默认(种子)'}")


def load_model(model_name=None):
    """加载模型。model_name=None 时加载第一个已训练的模型。"""
    global models, model_loaded

    try:
        from .training import JarClassifier

        model_path = Config.get_active_model_path(model_name)
        logger.info(f"加载模型: {model_path or '无'} (请求: {model_name or '自动'})")

        m = JarClassifier().to(Config.DEVICE)
        if model_path is not None and model_path.exists():
            state_dict = torch.load(
                model_path, map_location=Config.DEVICE, weights_only=True
            )
            m.load_state_dict(state_dict)
            m.eval()
            logger.info("模型加载成功")
        else:
            logger.warning(f"模型文件不存在: {model_path}，使用未训练模型")
            m.eval()

        # 缓存
        cache_key = model_name or "__default__"
        models[cache_key] = m
        model_loaded = True
        return True
    except Exception as e:
        logger.error(f"模型加载失败: {e}", exc_info=True)
        model_loaded = False
        return False


def get_model_for_product(model_name=None):
    """获取指定产品的模型（自动加载+缓存）"""
    cache_key = model_name or "__default__"
    if cache_key not in models:
        load_model(model_name)
    return models.get(cache_key)


def reload_all_models(device_str=None):
    """热切换所有已缓存模型到指定设备。device_str=None 时使用 Config.DEVICE。"""
    global models, model_loaded
    if device_str is None:
        device_str = Config.DEVICE

    target_device = torch.device(device_str)
    reloaded = 0
    for cache_key, m in list(models.items()):
        try:
            # 移动模型参数和缓冲区到目标设备
            m.to(target_device)
            m.eval()
            reloaded += 1
            logger.info(f"模型 '{cache_key}' 已切换到 {target_device}")
        except Exception as e:
            logger.error(f"模型 '{cache_key}' 切换设备失败: {e}")

    if reloaded > 0:
        model_loaded = True
        logger.info(f"推理设备已切换至 {target_device}，共重载 {reloaded} 个模型")


def _unpack_inference_item(item):
    """兼容生产三元组和测试计时四元组。"""
    if len(item) >= 4:
        return item[0], item[1], item[2], item[3] or {}
    return item[0], item[1], item[2], {}


def inference_worker():
    """推理 worker — 生产运行和真实模拟测试共用同一条队列/线程/模型路径。"""
    global model_loaded

    m = get_model_for_product()
    if m is None or not model_loaded:
        logger.error("推理 worker 启动失败：模型未加载")
        return

    logger.info("推理 worker 启动（微批处理模式，批窗口 5ms）")
    from .training import classify_frames_batch, classify_single

    BATCH_WINDOW = 0.005

    while True:
        try:
            first_item = inference_queue.get(timeout=1)
            cam_id, image, timestamp, metadata = _unpack_inference_item(first_item)
            first_received_perf = time.perf_counter()
            metadata["worker_received_perf"] = first_received_perf
            items = [(cam_id, image, timestamp, metadata)]

            deadline = time.perf_counter() + BATCH_WINDOW
            while time.perf_counter() < deadline:
                try:
                    extra = inference_queue.get_nowait()
                    extra_cam, extra_image, extra_ts, extra_meta = _unpack_inference_item(extra)
                    extra_meta["worker_received_perf"] = first_received_perf
                    items.append((extra_cam, extra_image, extra_ts, extra_meta))
                except queue.Empty:
                    break

            groups: dict[str, list[tuple[int, float, dict]]] = {}
            frames_by_group: dict[str, list[Image.Image]] = {}
            for cid, img, ts, meta in items:
                product_model = camera_product_map.get(cid)
                key = product_model or "__default__"
                groups.setdefault(key, []).append((cid, ts, meta))
                frames_by_group.setdefault(key, []).append(img)

            for key, meta_list in groups.items():
                model_prepare_start = time.perf_counter()
                cam_model = get_model_for_product(None if key == "__default__" else key)
                model_prepare_ms = (time.perf_counter() - model_prepare_start) * 1000
                frames = frames_by_group[key]
                timed_meta = next((meta for _, _, meta in meta_list if meta.get("timed")), None)
                worker_timing = {} if timed_meta is not None and len(frames) == 1 else None

                if len(frames) == 1:
                    label, confidence = classify_single(cam_model, frames[0], timing=worker_timing)
                    batch_results = [(label, confidence)]
                else:
                    batch_results = classify_frames_batch(cam_model, frames)

                for (cid, ts, meta), (label, confidence) in zip(meta_list, batch_results):
                    result = {"label": label, "confidence": confidence, "timestamp": ts}
                    if meta.get("timed"):
                        worker_received = meta.get("worker_received_perf", first_received_perf)
                        result["timing"] = {
                            "inference_queue_wait_ms": round(max(0.0, (worker_received - meta.get("submitted_perf", worker_received)) * 1000), 2),
                            "inference_batch_window_ms": round(max(0.0, (time.perf_counter() - worker_received) * 1000), 2),
                            "model_prepare_ms": round(model_prepare_ms, 2),
                            **{key: round(value, 2) for key, value in (worker_timing or {}).items()},
                        }
                    result_queues[cid].put(result)

        except queue.Empty:
            continue
        except Exception as e:
            logger.error(f"推理错误: {e}")

def start_inference_worker():
    """启动推理 worker"""
    thread = threading.Thread(target=inference_worker, daemon=True)
    thread.start()
    logger.info("推理 worker 线程已启动")


def submit_inference(cam_id: int, image: Image.Image, timed: bool = False):
    """提交推理任务；测试计时模式仍使用生产 inference_queue。"""
    try:
        if timed:
            inference_queue.put((cam_id, image, time.time(), {"timed": True, "submitted_perf": time.perf_counter()}), timeout=0.1)
        else:
            inference_queue.put((cam_id, image, time.time()), timeout=0.1)
        return True
    except queue.Full:
        logger.warning(f"推理队列已满，丢弃 Camera {cam_id} 的帧")
        return False


def get_inference_result(cam_id: int, timeout=0.1):
    """获取推理结果（非阻塞）"""
    try:
        result = result_queues[cam_id].get(timeout=timeout)
        return result
    except queue.Empty:
        return None


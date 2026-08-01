"""
推理队列 Worker
单线程推理避免 PyTorch 并发问题
"""

import queue
import threading
import time

from PIL import Image

from . import model_loader
from .config import Config
from .logger import logger


# 全局推理队列
inference_queue = queue.Queue(maxsize=Config.INFERENCE_QUEUE_SIZE)
result_queues = {i: queue.Queue() for i in range(1, Config.CAMERA_COUNT + 1)}


def _unpack_inference_item(item):
    """兼容生产三元组和测试计时四元组。"""
    if len(item) >= 4:
        return item[0], item[1], item[2], item[3] or {}
    return item[0], item[1], item[2], {}


def inference_worker():
    """推理 worker — 生产运行和真实离线测试共用同一条队列/线程/模型路径。"""

    m = model_loader.get_model_for_product()
    if m is None or not model_loader.model_loaded:
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
            # 必须在批窗口收集结束后立即记录，否则会把后面的模型准备、
            # 预处理和模型推理时间错误地算进“推理批窗口”。
            batch_window_end = time.perf_counter()

            groups: dict[str, list[tuple[int, float, dict]]] = {}
            frames_by_group: dict[str, list[Image.Image]] = {}
            for cid, img, ts, meta in items:
                product_model = model_loader.get_camera_product(cid)
                key = product_model or "__default__"
                groups.setdefault(key, []).append((cid, ts, meta))
                frames_by_group.setdefault(key, []).append(img)

            for key, meta_list in groups.items():
                model_prepare_start = time.perf_counter()
                cam_model = model_loader.get_model_for_product(None if key == "__default__" else key)
                model_prepare_ms = (time.perf_counter() - model_prepare_start) * 1000
                frames = frames_by_group[key]
                timed_meta = next((meta for _, _, meta in meta_list if meta.get("timed")), None)
                worker_timing = {} if timed_meta is not None and len(frames) == 1 else None

                if len(frames) == 1:
                    label, confidence = classify_single(cam_model, frames[0], timing=worker_timing, labels=model_loader.model_categories.get(key))
                    batch_results = [(label, confidence)]
                else:
                    batch_results = classify_frames_batch(cam_model, frames, labels=model_loader.model_categories.get(key))

                for (cid, ts, meta), (label, confidence) in zip(meta_list, batch_results):
                    result = {"label": label, "confidence": confidence, "timestamp": ts}
                    if meta.get("timed"):
                        worker_received = meta.get("worker_received_perf", first_received_perf)
                        result["timing"] = {
                            "inference_queue_wait_ms": round(max(0.0, (worker_received - meta.get("submitted_perf", worker_received)) * 1000), 2),
                            "inference_batch_window_ms": round(max(0.0, (batch_window_end - worker_received) * 1000), 2),
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


# 向后兼容：模型缓存状态现归 model_loader 管理。
from .model_loader import (  # noqa: E402,F401
    camera_product_map,
    get_model_for_product,
    load_model,
    model_categories,
    model_loaded,
    models,
    preload_all_models,
    reload_all_models,
    set_camera_product,
    warmup_model,
)

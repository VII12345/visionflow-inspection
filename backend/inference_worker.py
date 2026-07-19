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
        logger.info(f"加载模型: {model_path} (请求: {model_name or '自动'})")

        m = JarClassifier().to(Config.DEVICE)
        if model_path.exists():
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


def inference_worker():
    """推理 worker 线程 — 每个摄像头使用对应产品的模型"""
    global model_loaded

    # 预加载默认模型
    m = get_model_for_product()
    if m is None or not model_loaded:
        logger.error("推理 worker 启动失败：模型未加载")
        return

    logger.info("推理 worker 启动")

    from .training import classify_single

    while True:
        try:
            cam_id, image, timestamp = inference_queue.get(timeout=1)
            # 获取该摄像头对应的产品模型，没有则用默认
            product_model = camera_product_map.get(cam_id)
            cam_model = get_model_for_product(product_model) if product_model else m
            label, confidence = classify_single(cam_model, image)
            result_queues[cam_id].put(
                {"label": label, "confidence": confidence, "timestamp": timestamp}
            )
        except queue.Empty:
            continue
        except Exception as e:
            logger.error(f"推理错误: {e}")


def start_inference_worker():
    """启动推理 worker"""
    thread = threading.Thread(target=inference_worker, daemon=True)
    thread.start()
    logger.info("推理 worker 线程已启动")


def submit_inference(cam_id: int, image: Image.Image):
    """提交推理任务"""
    try:
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

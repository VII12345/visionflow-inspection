"""模型加载与缓存：模型文件、预热、产品映射与设备热切换。"""

import threading

import torch

from .config import Config
from .logger import logger
from .model_repository import DEFAULT_CATEGORIES


# 全局模型（按产品名缓存）
models = {}  # {model_name: ProductClassifier}
model_categories = {}  # {model_name: [category_name, ...]}
model_loaded = False
camera_product_map = {}  # {cam_id: model_name}  每个摄像头用哪个产品的模型

# 相机→产品映射由 API 线程写入、相机 worker 线程读取，用锁保护
_product_map_lock = threading.Lock()


def set_camera_product(cam_id, model_name):
    """设置摄像头使用的产品模型"""
    with _product_map_lock:
        camera_product_map[cam_id] = model_name
    # 预加载对应模型
    if model_name and model_name not in models:
        load_model(model_name)
    logger.info(f"Cam{cam_id} → 模型: {model_name or '默认(种子)'}")


def get_camera_product(cam_id):
    with _product_map_lock:
        return camera_product_map.get(cam_id)


def has_camera_product(cam_id):
    with _product_map_lock:
        return cam_id in camera_product_map


def remove_camera_product(cam_id):
    with _product_map_lock:
        camera_product_map.pop(cam_id, None)


def warmup_model(model, model_name="__default__"):
    """在正式识别前初始化 CUDA/PyTorch 算子并执行一次空推理。"""
    try:
        device = next(model.parameters()).device
        if device.type == "cuda" and torch.cuda.is_available():
            torch.cuda.init()
        dummy = torch.zeros((1, 3, 224, 224), device=device)
        with torch.no_grad():
            model(dummy)
        if device.type == "cuda" and torch.cuda.is_available():
            torch.cuda.synchronize(device)
        logger.info(f"模型预热完成: {model_name} ({device})")
        return True
    except Exception as exc:
        logger.warning(f"模型预热失败，将在首次识别时重试: {model_name} - {exc}")
        return False


def preload_all_models():
    """服务启动时预加载并预热 data/ 中所有已训练模型。"""
    if Config.DEVICE.startswith("cuda") and torch.cuda.is_available():
        torch.cuda.init()
        logger.info("CUDA 运行时已提前初始化")

    model_paths = sorted(Config.DATA_DIR.glob("*_classifier_*.pth"))
    loaded = 0
    if model_paths:
        # 默认模型供 Worker 启动使用，同时把具名模型全部放入缓存。
        if load_model():
            loaded += 1
        for model_path in model_paths:
            model_name = model_path.stem.rsplit("_classifier_", 1)[-1]
            if model_name and model_name not in models and load_model(model_name):
                loaded += 1
    else:
        # 没有训练模型时仍预热未训练模型，避免第一次识别再初始化运行时。
        if load_model():
            loaded += 1
    logger.info(f"启动预加载完成: {loaded} 个模型已加载并预热")


def load_model(model_name=None):
    """加载模型。model_name=None 时加载第一个已训练的模型。"""
    global models, model_categories, model_loaded

    try:
        from .training import ProductClassifier

        model_path = Config.get_active_model_path(model_name)
        logger.info(f"加载模型: {model_path or '无'} (请求: {model_name or '自动'})")

        categories = list(DEFAULT_CATEGORIES)
        state_dict = None
        metadata_path = None
        if model_path is not None:
            metadata_path = model_path.with_suffix(".json")
            if metadata_path.exists():
                try:
                    import json
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                    if isinstance(metadata.get("categories"), list) and metadata["categories"]:
                        categories = [str(item) for item in metadata["categories"]]
                except Exception as exc:
                    logger.warning(f"模型类别元数据读取失败: {exc}")
            if model_path.exists():
                state_dict = torch.load(model_path, map_location=Config.DEVICE, weights_only=True)
        num_classes = len(categories)
        if isinstance(state_dict, dict) and "head.4.weight" in state_dict:
            num_classes = int(state_dict["head.4.weight"].shape[0])
        m = ProductClassifier(num_classes=num_classes).to(Config.DEVICE)
        if state_dict is not None:
            m.load_state_dict(state_dict)
            m.eval()
            logger.info("模型加载成功")
        else:
            logger.warning(f"模型文件不存在: {model_path}，使用未训练模型")
            m.eval()

        warmup_model(m, model_name or "__default__")

        # 缓存
        cache_key = model_name or "__default__"
        models[cache_key] = m
        model_categories[cache_key] = categories
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
            warmup_model(m, cache_key)
            reloaded += 1
            logger.info(f"模型 '{cache_key}' 已切换到 {target_device}")
        except Exception as e:
            logger.error(f"模型 '{cache_key}' 切换设备失败: {e}")

    if reloaded > 0:
        model_loaded = True
        logger.info(f"推理设备已切换至 {target_device}，共重载 {reloaded} 个模型")

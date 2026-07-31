"""模型元数据的读取、查询和持久化。"""

import json
from pathlib import Path

from .config import Config
from .logger import logger
from .plc_service import get_plc_config


DEFAULT_CATEGORIES = ["类别1", "类别2"]


def read_model_metadata(model_path: Path | None, fallback_categories=None):
    """读取模型旁的 JSON 元数据，并返回规范化后的类别列表。"""
    categories = list(fallback_categories or DEFAULT_CATEGORIES)
    metadata = {}
    metadata_path = model_path.with_suffix(".json") if model_path else None
    try:
        if metadata_path and metadata_path.exists():
            raw = json.loads(metadata_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                metadata = raw
                stored_categories = raw.get("categories")
                if isinstance(stored_categories, list) and stored_categories:
                    categories = [str(item) for item in stored_categories if str(item).strip()]
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"读取模型元数据失败: {exc}")
    return metadata, categories, metadata_path


def get_model_reject_labels(model_name=None):
    """返回指定模型的剔除类别，并兼容旧版全局 PLC 配置。"""
    model_path = Config.get_active_model_path(model_name)
    if model_path is None:
        return list(get_plc_config().get("reject_labels", []))
    metadata, categories, _ = read_model_metadata(model_path)
    stored = metadata.get("reject_labels")
    if isinstance(stored, list):
        return [str(item) for item in stored if str(item) in categories]
    return [
        str(item)
        for item in get_plc_config().get("reject_labels", [])
        if str(item) in categories
    ]


def list_model_records():
    """扫描数据目录并返回前端需要的模型摘要。"""
    models = []
    for model_path in sorted(Config.DATA_DIR.glob("*_classifier_*.pth")):
        name = model_path.stem.rsplit("_classifier_", 1)[-1]
        stat = model_path.stat()
        metadata, categories, _ = read_model_metadata(model_path)
        stored_reject_labels = metadata.get("reject_labels")
        reject_labels = (
            [str(item) for item in stored_reject_labels if str(item) in categories]
            if isinstance(stored_reject_labels, list)
            else get_model_reject_labels(name)
        )
        descriptions = metadata.get("category_descriptions", {}) or {}
        models.append(
            {
                "name": name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
                "categories": categories,
                "num_classes": len(categories),
                "reject_labels": reject_labels,
                "category_descriptions": {
                    str(key): str(value)
                    for key, value in descriptions.items()
                    if str(key) in categories and str(value).strip()
                },
            }
        )
    return models


def update_model_settings(model_name, raw_labels, raw_descriptions):
    """校验并保存指定模型的剔除类别和类别说明。"""
    model_path = Config.get_active_model_path(model_name)
    if model_path is None:
        raise FileNotFoundError("模型不存在")
    if not isinstance(raw_labels, list):
        raise ValueError("剔除类别格式无效")

    metadata, categories, metadata_path = read_model_metadata(model_path)
    reject_labels = []
    for item in raw_labels:
        label = str(item).strip()
        if label and label in categories and label not in reject_labels:
            reject_labels.append(label)

    descriptions = {}
    if isinstance(raw_descriptions, dict):
        descriptions = {
            category: str(raw_descriptions.get(category, "")).strip()
            for category in categories
            if str(raw_descriptions.get(category, "")).strip()
        }

    metadata.update(
        {
            "categories": categories,
            "num_classes": len(categories),
            "reject_labels": reject_labels,
            "category_descriptions": descriptions,
        }
    )
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "model": model_name,
        "categories": categories,
        "reject_labels": reject_labels,
        "category_descriptions": descriptions,
    }

"""模型元数据的读取、查询和持久化。"""

import datetime
import json
import re
from pathlib import Path

from .camera_config_manager import camera_config_manager
from .config import Config
from .logger import logger
from .plc_service import get_plc_config


DEFAULT_CATEGORIES = ["类别1", "类别2"]


class ModelInUseError(RuntimeError):
    """模型被其他配置引用，无法删除。"""

    def __init__(self, references):
        self.references = references
        super().__init__("模型被其他配置引用，无法删除")


def resolve_model_path(model_name=None):
    """解析模型路径；显式指定名称时不回退到其他模型。"""
    trained = sorted(Config.DATA_DIR.glob("*_classifier_*.pth"))
    if model_name:
        return next(
            (path for path in trained if path.stem.rsplit("_classifier_", 1)[-1] == model_name),
            None,
        )
    return trained[0] if trained else None


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
    model_path = resolve_model_path(model_name)
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


def _model_version(metadata, stat):
    """从元数据/文件推导版本信息：训练时间/准确率/设备。"""
    accuracy = None
    for key in ("eval_accuracy", "accuracy", "best_accuracy"):
        if key in metadata:
            try:
                accuracy = round(float(metadata[key]), 4)
            except (TypeError, ValueError):
                accuracy = None
            break
    trained_at = metadata.get("trained_at")
    if not trained_at:
        try:
            trained_at = datetime.datetime.fromtimestamp(stat.st_mtime).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except (OSError, ValueError):
            trained_at = None
    return {
        "trained_at": trained_at,
        "accuracy": accuracy,
        "device": metadata.get("device"),
    }


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
                "version": _model_version(metadata, stat),
            }
        )
    return models


def update_model_settings(model_name, raw_labels, raw_descriptions):
    """校验并保存指定模型的剔除类别和类别说明。"""
    model_path = resolve_model_path(model_name)
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


# ========== 模型引用与删除/重命名 ==========


def _model_refs_path():
    return Config.DATA_DIR / "model_refs.json"


def find_model_references(model_name):
    """返回引用该模型的配置列表（相机配置 + 后端引用登记）。"""
    references = []
    camera_config = camera_config_manager.get_config()
    for cam_id, cam_cfg in (camera_config.get("cameras", {}) or {}).items():
        if isinstance(cam_cfg, dict) and cam_cfg.get("model") == model_name:
            references.append(
                {
                    "type": "camera",
                    "label": f"相机 {cam_id}",
                    "detail": cam_cfg.get("name") or f"Cam{cam_id}",
                }
            )
    try:
        if _model_refs_path().exists():
            refs = json.loads(_model_refs_path().read_text(encoding="utf-8"))
            if isinstance(refs, list):
                for item in refs:
                    if isinstance(item, dict) and item.get("model") == model_name:
                        references.append(
                            {
                                "type": str(item.get("type", "product")),
                                "label": str(item.get("label", "未知配置")),
                                "detail": str(item.get("detail", "")),
                            }
                        )
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"读取模型引用登记失败: {exc}")
    return references


def delete_model(model_name):
    """删除模型文件；被引用时抛出 ModelInUseError（含引用列表）。"""
    model_path = resolve_model_path(model_name)
    if model_path is None:
        raise FileNotFoundError("模型不存在")
    references = find_model_references(model_name)
    if references:
        raise ModelInUseError(references)
    metadata_path = model_path.with_suffix(".json")
    model_path.unlink()
    if metadata_path.exists():
        metadata_path.unlink()
    logger.info(f"已删除模型: {model_name}")
    return {"model": model_name}


def _update_references_after_rename(old_name, new_name):
    """重命名后同步相机配置与后端引用登记中的模型名称。"""
    try:
        camera_config = camera_config_manager.get_config()
        changed = False
        for cam_cfg in (camera_config.get("cameras", {}) or {}).values():
            if isinstance(cam_cfg, dict) and cam_cfg.get("model") == old_name:
                cam_cfg["model"] = new_name
                changed = True
        if changed:
            camera_config_manager.save_config(camera_config)
    except Exception as exc:
        logger.warning(f"更新相机配置模型引用失败: {exc}")
    try:
        if _model_refs_path().exists():
            refs = json.loads(_model_refs_path().read_text(encoding="utf-8"))
            if isinstance(refs, list):
                for item in refs:
                    if isinstance(item, dict) and item.get("model") == old_name:
                        item["model"] = new_name
                _model_refs_path().write_text(
                    json.dumps(refs, ensure_ascii=False, indent=2), encoding="utf-8"
                )
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"更新模型引用登记失败: {exc}")


def rename_model(model_name, new_name):
    """重命名模型文件（含元数据）。"""
    new_name = str(new_name or "").strip()
    if not new_name:
        raise ValueError("新名称不能为空")
    if not re.match(r"^[A-Za-z0-9_.\-]+$", new_name):
        raise ValueError("模型名称只能包含字母、数字、-、_ 和 .")
    if new_name == model_name:
        return {"model": model_name}
    model_path = resolve_model_path(model_name)
    if model_path is None:
        raise FileNotFoundError("模型不存在")
    new_model_path = Config.DATA_DIR / f"model_classifier_{new_name}.pth"
    if new_model_path.exists():
        raise ValueError("目标名称已存在")
    metadata_path = model_path.with_suffix(".json")
    new_metadata_path = new_model_path.with_suffix(".json")
    model_path.rename(new_model_path)
    if metadata_path.exists():
        metadata_path.rename(new_metadata_path)
    _update_references_after_rename(model_name, new_name)
    logger.info(f"模型重命名: {model_name} -> {new_name}")
    return {"model": new_name}

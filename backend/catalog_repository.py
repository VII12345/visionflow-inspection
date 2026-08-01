"""产品列表与线体配置的持久化（data/catalog_config.json）。

产品与线体分配关系此前只保存在前端本地，换机/清缓存即丢失；
本模块让后端成为目录配置的权威存储，前端启动时从后端加载。
"""

import json
import threading

from .config import Config
from .logger import logger


# 串行化目录配置的读-改-写，避免并发保存互相覆盖
_catalog_lock = threading.RLock()
_UNSET = object()


def catalog_file_path():
    return Config.DATA_DIR / "catalog_config.json"


def catalog_file_exists():
    return catalog_file_path().exists()


def default_catalog():
    return {
        "products": [],
        "line_config": [
            {"line": i + 1, "name": f"线体 {i + 1}", "productId": None, "model": "-"}
            for i in range(Config.CAMERA_COUNT)
        ],
    }


def normalize_products(raw):
    """规范化产品列表；缺失字段补默认值。"""
    products = []
    if not isinstance(raw, list):
        return products
    for item in raw:
        if not isinstance(item, dict):
            continue
        model = str(item.get("model", "")).strip()
        try:
            product_id = int(item.get("id", 0))
        except (TypeError, ValueError):
            product_id = 0
        name = str(item.get("name", "") or model or f"产品 {product_id}").strip()
        products.append(
            {
                "id": product_id,
                "name": name,
                "model": model,
                "size": str(item.get("size", "") or ""),
                "learned": bool(item.get("learned", False)),
            }
        )
    return products


def _coerce_product_id(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_line_config(raw):
    """按当前相机数量规范化线体配置（保留既有配置，缺省用默认线体名）。"""
    lines = []
    if not isinstance(raw, list):
        raw = []
    for i in range(1, Config.CAMERA_COUNT + 1):
        item = raw[i - 1] if i - 1 < len(raw) and isinstance(raw[i - 1], dict) else {}
        lines.append(
            {
                "line": i,
                "name": str(item.get("name", "") or f"线体 {i}").strip(),
                "productId": _coerce_product_id(item.get("productId")),
                "model": str(item.get("model", "") or "-").strip(),
            }
        )
    return lines


def load_catalog():
    """读取目录配置；文件不存在时返回默认值。"""
    path = catalog_file_path()
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                return {
                    "products": normalize_products(payload.get("products", [])),
                    "line_config": normalize_line_config(payload.get("line_config", [])),
                }
        except (OSError, ValueError, TypeError) as exc:
            logger.warning(f"读取目录配置失败，使用默认值: {exc}")
    return default_catalog()


def save_catalog(catalog):
    """校验并持久化目录配置。"""
    path = catalog_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = {
        "products": normalize_products(catalog.get("products", [])),
        "line_config": normalize_line_config(catalog.get("line_config", [])),
    }
    path.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info(f"目录配置已保存: {len(normalized['products'])} 个产品, {len(normalized['line_config'])} 条线体")
    return normalized


def update_catalog(products=_UNSET, line_config=_UNSET):
    """在锁内完成读-改-写，只更新传入的字段，防止并发保存互相覆盖。"""
    with _catalog_lock:
        catalog = load_catalog()
        if products is not _UNSET:
            catalog["products"] = normalize_products(products)
        if line_config is not _UNSET:
            catalog["line_config"] = normalize_line_config(line_config)
        return save_catalog(catalog)

"""产品与线体配置 API。"""

from flask import Blueprint, jsonify, request

from .catalog_repository import (
    catalog_file_exists,
    load_catalog,
    normalize_line_config,
    normalize_products,
    save_catalog,
)
from .logger import logger


catalog_bp = Blueprint("catalog", __name__)


@catalog_bp.route("/api/catalog", methods=["GET"])
def get_catalog():
    """获取产品与线体配置；initialized 表示后端是否已有目录文件。"""
    catalog = load_catalog()
    return jsonify(
        {
            "success": True,
            "products": catalog["products"],
            "line_config": catalog["line_config"],
            "initialized": catalog_file_exists(),
        }
    )


@catalog_bp.route("/api/catalog", methods=["POST"])
def update_catalog():
    """保存产品/线体配置（可只传其中一项）。"""
    data = request.get_json(silent=True) or {}
    catalog = load_catalog()
    if "products" in data:
        catalog["products"] = normalize_products(data.get("products"))
    if "line_config" in data:
        catalog["line_config"] = normalize_line_config(data.get("line_config"))
    try:
        saved = save_catalog(catalog)
    except OSError as exc:
        logger.error(f"保存目录配置失败: {exc}", exc_info=True)
        return jsonify({"success": False, "message": str(exc)}), 500
    return jsonify(
        {
            "success": True,
            "products": saved["products"],
            "line_config": saved["line_config"],
        }
    )

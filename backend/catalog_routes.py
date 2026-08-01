"""产品与线体配置 API。"""

from flask import Blueprint, jsonify, request

from .catalog_repository import (
    catalog_file_exists,
    load_catalog,
    update_catalog as update_catalog_repo,
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
    """保存产品/线体配置（可只传其中一项，锁内原子更新）。"""
    data = request.get_json(silent=True) or {}
    try:
        kwargs = {}
        if "products" in data:
            kwargs["products"] = data.get("products")
        if "line_config" in data:
            kwargs["line_config"] = data.get("line_config")
        saved = update_catalog_repo(**kwargs)
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

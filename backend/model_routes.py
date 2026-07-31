"""模型目录与模型设置 API。"""

from flask import Blueprint, jsonify, request

from .logger import logger
from .model_repository import list_model_records, update_model_settings


model_bp = Blueprint("models", __name__)


@model_bp.route("/api/models", methods=["GET"])
def list_models():
    try:
        return jsonify({"success": True, "models": list_model_records()})
    except OSError as exc:
        logger.error(f"扫描模型文件失败: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500


@model_bp.route("/api/models/<model_name>/settings", methods=["POST"])
def save_model_settings(model_name):
    data = request.get_json(silent=True) or {}
    try:
        saved = update_model_settings(
            model_name,
            data.get("reject_labels", []),
            data.get("category_descriptions", {}),
        )
        return jsonify({"success": True, **saved})
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except OSError as exc:
        logger.error(f"保存模型设置失败: {exc}", exc_info=True)
        return jsonify({"success": False, "error": f"保存模型设置失败: {exc}"}), 500

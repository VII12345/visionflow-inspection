"""照片保存设置、目录浏览和照片管理 API。"""

from flask import Blueprint, jsonify, request, send_file

from .capture_service import (
    cleanup_photos,
    list_image_directories_data,
    persist_save_settings,
)
from .config import Config
from .logger import logger
from .model_repository import get_model_reject_labels
from .photo_service import (
    delete_photo as delete_photo_file,
    find_photo,
    list_camera_photos,
    photo_mime,
)
from .runtime_state import runtime


photo_bp = Blueprint("photos", __name__)


@photo_bp.route("/api/save-settings", methods=["GET"])
def get_save_settings():
    return jsonify({"success": True, "settings": runtime.save_settings})


@photo_bp.route("/api/save-settings/<int:cam_id>", methods=["POST"])
def update_save_settings(cam_id):
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    data = request.get_json(silent=True) or {}
    values = {
        "saveGood": data.get("saveGood", True),
        "saveBad": data.get("saveBad", True),
    }
    if any(not isinstance(value, bool) for value in values.values()):
        return jsonify({"success": False, "error": "saveGood/saveBad 必须是布尔值"}), 400
    runtime.save_settings[cam_id] = values
    try:
        persist_save_settings()
    except OSError as exc:
        logger.error(f"保存照片保存设置失败: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500
    logger.info(f"更新保存设置 Cam{cam_id}: {values}")
    return jsonify({"success": True, "settings": values})


@photo_bp.route("/api/image-directories", methods=["GET"])
def list_image_directories():
    return jsonify({"success": True, "directories": list_image_directories_data()})


@photo_bp.route("/api/photos/<int:cam_id>", methods=["GET"])
def list_photos(cam_id):
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    result = list_camera_photos(
        Config.CAPTURE_DIR / f"cam{cam_id}",
        get_model_reject_labels(),
    )
    return jsonify({"success": True, **result})


@photo_bp.route("/api/photos/<int:cam_id>/<filename>", methods=["GET"])
def get_photo(cam_id, filename):
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"error": "Invalid camera ID"}), 400
    file_path = find_photo(Config.CAPTURE_DIR / f"cam{cam_id}", filename)
    if file_path is None:
        return jsonify({"error": "Photo not found"}), 404
    return send_file(str(file_path), mimetype=photo_mime(file_path))


@photo_bp.route("/api/photos/<int:cam_id>/<filename>", methods=["DELETE"])
def delete_photo(cam_id, filename):
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    file_path = find_photo(Config.CAPTURE_DIR / f"cam{cam_id}", filename)
    if file_path is None:
        return jsonify({"success": False, "error": "Photo not found"}), 404
    try:
        delete_photo_file(file_path)
        logger.info(f"已删除照片: {file_path}")
        return jsonify({"success": True, "message": f"已删除 {filename}"})
    except OSError as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@photo_bp.route("/api/photos/cleanup", methods=["POST"])
def trigger_cleanup():
    deleted = cleanup_photos()
    return jsonify(
        {
            "success": True,
            "message": f"清理完成，删除了 {deleted} 张照片",
            "deleted": deleted,
        }
    )

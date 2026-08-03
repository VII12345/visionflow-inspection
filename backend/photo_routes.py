"""照片保存设置、目录浏览和照片管理 API。"""

import csv
import io
import zipfile
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file

from .capture_service import (
    cleanup_photos,
    list_image_directories_data,
    persist_save_settings,
)
from .config import Config, IMAGE_EXTENSIONS
from .logger import logger
from .model_repository import get_model_reject_labels
from .photo_service import (
    delete_photo as delete_photo_file,
    find_photo,
    iter_photo_records,
    list_camera_photos,
    photo_mime,
)
from .runtime_state import runtime


photo_bp = Blueprint("photos", __name__)

# 单次导出最大张数（防止一次性打包占用过多内存/IO）
MAX_EXPORT_COUNT = 2000


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


# ========== 照片分页 / 筛选 / 导出 / 报表 / 趋势 ==========


def _iter_all_photos(camera_id=None):
    """按相机遍历所有照片记录（时间倒序）。"""
    cameras = [camera_id] if camera_id else list(range(1, Config.CAMERA_COUNT + 1))
    reject_labels = set(get_model_reject_labels())
    for cam_id in cameras:
        capture_dir = Config.CAPTURE_DIR / f"cam{cam_id}"
        if not capture_dir.is_dir():
            continue
        yield from iter_photo_records(capture_dir, reject_labels, cam_id=cam_id)


def _apply_filters(photos, camera_id=None, start=None, end=None, category=None):
    """按相机、时间区间和类别筛选照片。"""
    for photo in photos:
        if camera_id is not None and photo["camId"] != camera_id:
            continue
        if start is not None and photo["timestamp"] < start:
            continue
        if end is not None and photo["timestamp"] > end:
            continue
        if category:
            cat = category.lower()
            if cat in ("ok", "ng"):
                if photo["result"].lower() != cat:
                    continue
            else:
                if photo["subdir"].lower() != cat:
                    continue
        yield photo


def _parse_filters(args_or_data):
    camera_id = None
    if args_or_data.get("camera_id") not in (None, ""):
        try:
            camera_id = int(args_or_data.get("camera_id"))
        except (TypeError, ValueError):
            camera_id = None
    start = args_or_data.get("start")
    end = args_or_data.get("end")
    if isinstance(start, str) and start.strip():
        try:
            start = float(start)
        except ValueError:
            start = None
    if isinstance(end, str) and end.strip():
        try:
            end = float(end)
        except ValueError:
            end = None
    category = str(args_or_data.get("category", "") or "").strip() or None
    return camera_id, start, end, category


@photo_bp.route("/api/photos", methods=["GET"])
def list_photos_paginated():
    """分页 + 筛选的照片列表（跨相机或指定相机）。"""
    camera_id, start, end, category = _parse_filters(request.args)
    page = max(1, request.args.get("page", 1, type=int))
    page_size = min(200, max(1, request.args.get("page_size", 50, type=int)))
    start_index = (page - 1) * page_size
    total = 0
    items = []
    # 只物化当前页，避免把全部照片读进内存；total 仍需遍历计数
    for photo in _apply_filters(_iter_all_photos(camera_id), camera_id, start, end, category):
        if total < start_index:
            total += 1
            continue
        if len(items) < page_size:
            items.append(photo)
        total += 1
    return jsonify(
        {
            "success": True,
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": items,
        }
    )


@photo_bp.route("/api/photos/export", methods=["POST"])
def export_photos():
    """按筛选条件批量导出照片为 zip。"""
    data = request.get_json(silent=True) or {}
    camera_id, start, end, category = _parse_filters(data)
    file_names = data.get("file_names")
    allowed = {str(name) for name in file_names} if isinstance(file_names, list) and file_names else None

    buffer = io.BytesIO()
    added = 0
    truncated = False
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for photo in _apply_filters(_iter_all_photos(camera_id), camera_id, start, end, category):
            if allowed is not None and photo["filename"] not in allowed:
                continue
            if added >= MAX_EXPORT_COUNT:
                truncated = True
                break
            source = (
                Config.CAPTURE_DIR / f"cam{photo['camId']}" / photo["subdir"] / photo["filename"]
            )
            if not source.exists():
                continue
            arc_name = f"cam{photo['camId']}/{photo['subdir']}/{photo['filename']}"
            archive.write(str(source), arcname=arc_name)
            added += 1
    buffer.seek(0)
    if truncated:
        logger.warning(f"照片导出达到上限 {MAX_EXPORT_COUNT} 张，结果已截断")
    logger.info(f"照片导出完成: {added} 张")
    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="photos_export.zip",
    )


@photo_bp.route("/api/photos/report.csv", methods=["GET"])
def photo_report_csv():
    """按日期 + 类别统计照片数量，返回 CSV。"""
    camera_id, start, end, category = _parse_filters(request.args)
    counts = {}
    for photo in _apply_filters(_iter_all_photos(camera_id), camera_id, start, end, category):
        day = datetime.fromtimestamp(photo["timestamp"]).strftime("%Y-%m-%d")
        cat = photo["result"] if photo["result"] != "--" else "未分类"
        key = (day, cat)
        counts[key] = counts.get(key, 0) + 1
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["日期", "类别", "数量"])
    for day, cat in sorted(counts):
        writer.writerow([day, cat, counts[(day, cat)]])
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="photo_report.csv",
    )


@photo_bp.route("/api/photos/trend", methods=["GET"])
def photo_trend():
    """良率趋势：按天或按小时统计 OK/NG 与良率序列。"""
    camera_id, start, end, _category = _parse_filters(request.args)
    interval = request.args.get("interval", "day")
    if interval not in ("day", "hour"):
        interval = "day"
    buckets = {}
    for photo in _apply_filters(_iter_all_photos(camera_id), camera_id, start, end, None):
        dt = datetime.fromtimestamp(photo["timestamp"])
        if interval == "hour":
            key = dt.strftime("%Y-%m-%d %H:00")
            order = int(dt.strftime("%Y%m%d%H"))
        else:
            key = dt.strftime("%Y-%m-%d")
            order = int(dt.strftime("%Y%m%d"))
        bucket = buckets.setdefault(key, {"order": order, "total": 0, "ok": 0, "ng": 0})
        bucket["total"] += 1
        if photo["result"] == "OK":
            bucket["ok"] += 1
        elif photo["result"] == "NG":
            bucket["ng"] += 1
    points = [
        {
            "time": key,
            "total": bucket["total"],
            "ok": bucket["ok"],
            "ng": bucket["ng"],
            "yield_rate": (
                round(bucket["ok"] / bucket["total"], 4) if bucket["total"] else None
            ),
        }
        for key, bucket in sorted(buckets.items(), key=lambda item: item[1]["order"])
    ]
    return jsonify({"success": True, "interval": interval, "points": points})

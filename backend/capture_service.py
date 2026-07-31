"""照片保存设置、目录扫描、清理和异步写盘服务。"""

import json
import os
import queue
import threading
import time
from pathlib import Path

from .config import Config
from .logger import logger
from .photo_service import cleanup_captures
from .runtime_state import runtime


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def default_save_settings():
    return {
        cam_id: {"saveGood": True, "saveBad": True}
        for cam_id in range(1, Config.CAMERA_COUNT + 1)
    }


def save_settings_path():
    return Config.DATA_DIR / "save_settings.json"


def load_save_settings():
    settings = default_save_settings()
    path = save_settings_path()
    if not path.exists():
        return settings
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            for raw_cam_id, item in raw.items():
                try:
                    cam_id = int(raw_cam_id)
                except (TypeError, ValueError):
                    continue
                if not 1 <= cam_id <= Config.MAX_CAMERA_COUNT or not isinstance(item, dict):
                    continue
                settings[cam_id] = {
                    "saveGood": item.get("saveGood", True) is True,
                    "saveBad": item.get("saveBad", True) is True,
                }
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"加载照片保存设置失败，使用默认值: {exc}")
    return settings


def persist_save_settings(settings=None):
    values = settings if settings is not None else runtime.save_settings
    path = save_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(values, ensure_ascii=False, indent=2), encoding="utf-8")


def image_directory_roots():
    """返回允许网页端浏览的图片目录根路径。"""
    roots = [Config.DATA_DIR, Path(__file__).resolve().parent.parent / "test"]
    configured = os.getenv("VISION_IMAGE_ROOTS", "")
    if configured:
        roots.extend(Path(item) for item in configured.split(os.pathsep) if item.strip())

    unique = []
    seen = set()
    for root in roots:
        try:
            resolved = root.expanduser().resolve()
        except OSError:
            continue
        key = str(resolved).lower() if os.name == "nt" else str(resolved)
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    return unique


def list_image_directories_data():
    directories = []
    for root in image_directory_roots():
        if not root.is_dir():
            continue
        try:
            candidates = [root, *root.rglob("*")]
            for directory in candidates:
                if not directory.is_dir() or directory.is_symlink():
                    continue
                try:
                    image_count = sum(
                        1
                        for item in directory.iterdir()
                        if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS
                    )
                    if image_count == 0:
                        continue
                    relative = "." if directory == root else str(directory.relative_to(root))
                    directories.append(
                        {
                            "path": str(directory),
                            "name": directory.name or str(directory),
                            "relativePath": relative,
                            "root": str(root),
                            "imageCount": image_count,
                        }
                    )
                except (OSError, ValueError):
                    continue
        except OSError as exc:
            logger.warning(f"扫描图片目录失败 {root}: {exc}")
    directories.sort(key=lambda item: (item["root"].lower(), item["relativePath"].lower()))
    return directories


def cleanup_photos():
    deleted = cleanup_captures(
        Config.CAPTURE_DIR,
        Config.CAMERA_COUNT,
        Config.MAX_PHOTO_AGE_DAYS,
        Config.PHOTO_RETENTION_COUNT,
    )
    if deleted > 0:
        logger.info(f"照片清理完成: 删除了 {deleted} 张照片")
    return deleted


def _unpack_save_item(item):
    if len(item) >= 4:
        return item[0], item[1], item[2], item[3]
    return item[0], item[1], None, None


def _write_save_item(item):
    frame, target, done_event, completion = _unpack_save_item(item)
    write_start = time.perf_counter()
    error = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        frame.save(target, "BMP")
        logger.debug(f"异步存盘完成: {target.name}")
    except Exception as exc:
        error = exc
        logger.error(f"异步存盘失败: {exc}")
    finally:
        if completion is not None:
            completion["write_ms"] = (time.perf_counter() - write_start) * 1000
            completion["error"] = str(error) if error else None
        if done_event is not None:
            done_event.set()
    return error


def _save_worker():
    logger.info("异步存盘 worker 启动")
    runtime._save_queue_running = True
    while runtime._save_queue_running:
        try:
            item = runtime._save_queue.get(timeout=1)
            if item is None:
                break
            _write_save_item(item)
        except queue.Empty:
            continue
        except Exception as exc:
            logger.error(f"异步存盘 worker 错误: {exc}")
    while not runtime._save_queue.empty():
        try:
            item = runtime._save_queue.get_nowait()
            if item is not None:
                _write_save_item(item)
        except Exception:
            pass
    logger.info("异步存盘 worker 停止")


def submit_save(frame, target, done_event=None, completion=None):
    """提交存盘任务；测试可传 event 等待写盘完成。"""
    try:
        item = (
            (frame, target)
            if done_event is None and completion is None
            else (frame, target, done_event, completion if completion is not None else {})
        )
        runtime._save_queue.put(item, timeout=0.05)
        return True
    except queue.Full:
        logger.warning(f"存盘队列已满，丢弃: {target.name}")
        if done_event is not None:
            done_event.set()
        return False


def start_save_worker():
    if runtime._save_queue_running:
        return
    threading.Thread(target=_save_worker, daemon=True).start()


def stop_save_worker():
    runtime._save_queue_running = False
    try:
        runtime._save_queue.put(None, timeout=0.1)
    except queue.Full:
        pass


runtime.save_settings = load_save_settings()

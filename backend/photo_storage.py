"""照片保存设置、目录扫描与清理。"""

import json
import os
from pathlib import Path

from .config import Config, IMAGE_EXTENSIONS
from .logger import logger
from .photo_service import cleanup_captures


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
    from .runtime_state import runtime

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

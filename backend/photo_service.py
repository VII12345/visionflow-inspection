"""Local photo storage operations used by the Flask API and workers."""

import time
from datetime import datetime
from pathlib import Path


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
MIME_TYPES = {
    ".png": "image/png",
    ".bmp": "image/bmp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def iter_photo_subdirs(capture_dir: Path):
    if not capture_dir.exists():
        return []
    return sorted(
        (item for item in capture_dir.iterdir() if item.is_dir()),
        key=lambda item: item.name,
    )


def list_camera_photos(capture_dir: Path, reject_labels):
    """Return photo records and result counts for one camera directory."""
    photos = []
    ok_count = 0
    ng_count = 0
    reject_labels = set(reject_labels or [])

    for subdir in iter_photo_subdirs(capture_dir):
        sub = subdir.name
        try:
            files = sorted(
                subdir.iterdir(),
                key=lambda item: item.stat().st_mtime,
                reverse=True,
            )
        except OSError:
            continue
        for file_path in files:
            if not file_path.is_file() or file_path.suffix.lower() not in PHOTO_EXTENSIONS:
                continue
            try:
                stat = file_path.stat()
            except OSError:
                continue
            result_tag = "NG" if sub in reject_labels else ("--" if sub == "未分类" else "OK")
            if result_tag == "OK":
                ok_count += 1
            elif result_tag == "NG":
                ng_count += 1
            photos.append(
                {
                    "filename": file_path.name,
                    "subdir": sub,
                    "size": stat.st_size,
                    "mtime": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    "timestamp": stat.st_mtime,
                    "result": result_tag,
                }
            )
    return {"photos": photos, "okCount": ok_count, "ngCount": ng_count}


def find_photo(capture_dir: Path, filename: str):
    """Find a file by basename inside a camera's category directories."""
    safe_name = Path(filename).name
    for subdir in iter_photo_subdirs(capture_dir):
        candidate = subdir / safe_name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def photo_mime(path: Path):
    return MIME_TYPES.get(path.suffix.lower(), "image/jpeg")


def delete_photo(path: Path):
    path.unlink()


def cleanup_captures(capture_root: Path, camera_count: int, max_age_days: int, retention_count: int):
    """Delete expired and over-limit files from all camera directories."""
    now = time.time()
    max_age_seconds = max_age_days * 86400
    total_deleted = 0

    for cam_id in range(1, camera_count + 1):
        capture_dir = capture_root / f"cam{cam_id}"
        if not capture_dir.exists():
            continue
        files = []
        for subdir in iter_photo_subdirs(capture_dir):
            try:
                for file_path in subdir.iterdir():
                    if file_path.is_file() and file_path.suffix.lower() in PHOTO_EXTENSIONS:
                        files.append((file_path, file_path.stat().st_mtime))
            except OSError:
                continue
        if not files:
            continue

        files.sort(key=lambda item: item[1])
        remaining = []
        for file_path, mtime in files:
            if now - mtime > max_age_seconds:
                try:
                    file_path.unlink()
                    total_deleted += 1
                except OSError:
                    pass
            else:
                remaining.append((file_path, mtime))

        while len(remaining) > retention_count:
            file_path, _ = remaining.pop(0)
            try:
                file_path.unlink()
                total_deleted += 1
            except OSError:
                pass
    return total_deleted

"""照片保存服务聚合入口：目录/清理（photo_storage）+ 异步存盘（save_queue）。"""

from .photo_storage import (
    IMAGE_EXTENSIONS,
    cleanup_photos,
    default_save_settings,
    image_directory_roots,
    list_image_directories_data,
    load_save_settings,
    persist_save_settings,
    save_settings_path,
)
from .runtime_state import runtime
from .save_queue import (
    start_save_worker,
    stop_save_worker,
    submit_save,
)

__all__ = [
    "IMAGE_EXTENSIONS",
    "default_save_settings",
    "save_settings_path",
    "load_save_settings",
    "persist_save_settings",
    "image_directory_roots",
    "list_image_directories_data",
    "cleanup_photos",
    "start_save_worker",
    "stop_save_worker",
    "submit_save",
]


runtime.save_settings = load_save_settings()

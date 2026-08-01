import json
import tempfile
import threading
import unittest
from pathlib import Path
from queue import Queue
from unittest.mock import patch

from PIL import Image

from backend.capture_service import (
    list_image_directories_data,
    load_save_settings,
    persist_save_settings,
    start_save_worker,
    stop_save_worker,
    submit_save,
)
from backend.config import Config
from backend.runtime_state import runtime


class CaptureServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.patches = [
            patch.object(Config, "DATA_DIR", self.root),
            patch.object(Config, "CAPTURE_DIR", self.root / "captures"),
            patch.object(Config, "CAMERA_COUNT", 2),
        ]
        for item in self.patches:
            item.start()
        runtime._save_queue = Queue()
        runtime._save_queue_running = False
        runtime.save_settings = load_save_settings()

    def tearDown(self):
        stop_save_worker()
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    def test_save_settings_round_trip(self):
        runtime.save_settings[1] = {"saveGood": False, "saveBad": True}

        persist_save_settings()
        loaded = load_save_settings()

        self.assertEqual(loaded[1], {"saveGood": False, "saveBad": True})
        stored = json.loads((self.root / "save_settings.json").read_text(encoding="utf-8"))
        self.assertFalse(stored["1"]["saveGood"])

    def test_image_directory_scan_only_returns_directories_with_images(self):
        image_dir = self.root / "batch" / "OK"
        image_dir.mkdir(parents=True)
        (image_dir / "one.jpg").write_bytes(b"image")
        (self.root / "batch" / "readme.txt").write_text("text", encoding="utf-8")

        directories = list_image_directories_data()

        # 扫描返回的路径基于 resolve 后的根目录，比较时同样用规范化路径
        self.assertTrue(any(item["path"] == str(image_dir.resolve()) and item["imageCount"] == 1 for item in directories))
        self.assertFalse(any(item["path"] == str((self.root / "batch").resolve()) for item in directories))

    def test_async_save_writes_frame_and_reports_completion(self):
        target = self.root / "captures" / "cam1" / "OK" / "frame.bmp"
        done = threading.Event()
        completion = {}
        start_save_worker()

        submitted = submit_save(Image.new("RGB", (4, 4), "white"), target, done, completion)

        self.assertTrue(submitted)
        self.assertTrue(done.wait(3), "异步保存任务未在预期时间内完成")
        self.assertTrue(target.exists())
        self.assertIsNone(completion["error"])
        self.assertGreaterEqual(completion["write_ms"], 0)


if __name__ == "__main__":
    unittest.main()

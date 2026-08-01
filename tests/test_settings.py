import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.camera_run_service import should_save_photo
from backend.config import Config
from backend.runtime_state import runtime
from backend.system_routes import system_bp


class SaveOnlyRejectTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        runtime.save_only_reject = False
        app = Flask(__name__)
        app.register_blueprint(system_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_default_disabled(self):
        response = self.client.get("/api/settings/save-only-reject")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["enabled"])

    def test_enable_then_persist(self):
        response = self.client.post("/api/settings/save-only-reject", json={"enabled": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["enabled"])
        self.assertTrue(runtime.save_only_reject)
        stored = json.loads((self.data_dir / "save_only_reject.json").read_text(encoding="utf-8"))
        self.assertTrue(stored["enabled"])

        # 重新读取仍是开启状态
        response = self.client.get("/api/settings/save-only-reject")
        self.assertTrue(response.get_json()["enabled"])

    def test_disable(self):
        self.client.post("/api/settings/save-only-reject", json={"enabled": True})
        response = self.client.post("/api/settings/save-only-reject", json={"enabled": False})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["enabled"])
        self.assertFalse(runtime.save_only_reject)

    def test_should_save_photo_only_reject(self):
        reject_labels = ["划痕", "缺角"]
        save_settings = {1: {"saveGood": True, "saveBad": False}}

        # 开启仅保存剔除照片：只有剔除类别才保存
        self.assertTrue(should_save_photo(True, save_settings, 1, "划痕", reject_labels))
        self.assertFalse(should_save_photo(True, save_settings, 1, "合格", reject_labels))
        self.assertFalse(should_save_photo(True, save_settings, 1, "未分类", reject_labels))

        # 关闭时按相机级开关
        self.assertFalse(should_save_photo(False, save_settings, 1, "划痕", reject_labels))
        self.assertTrue(should_save_photo(False, save_settings, 1, "合格", reject_labels))


if __name__ == "__main__":
    unittest.main()

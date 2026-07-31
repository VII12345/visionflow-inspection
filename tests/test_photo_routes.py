import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from PIL import Image

from backend.capture_service import load_save_settings
from backend.config import Config
from backend.photo_routes import photo_bp
from backend.runtime_state import runtime


class PhotoRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.capture_dir = self.root / "captures"
        self.patches = [
            patch.object(Config, "DATA_DIR", self.root),
            patch.object(Config, "CAPTURE_DIR", self.capture_dir),
            patch.object(Config, "CAMERA_COUNT", 2),
            patch("backend.photo_routes.get_model_reject_labels", return_value=["NG"]),
        ]
        for item in self.patches:
            item.start()
        runtime.save_settings = load_save_settings()
        app = Flask(__name__)
        app.register_blueprint(photo_bp)
        self.client = app.test_client()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    def test_save_settings_validate_and_persist(self):
        invalid = self.client.post(
            "/api/save-settings/1",
            json={"saveGood": "yes", "saveBad": True},
        )
        self.assertEqual(invalid.status_code, 400)

        response = self.client.post(
            "/api/save-settings/1",
            json={"saveGood": False, "saveBad": True},
        )

        self.assertEqual(response.status_code, 200)
        stored = json.loads((self.root / "save_settings.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["1"], {"saveGood": False, "saveBad": True})

    def test_photo_list_download_and_delete(self):
        photo_dir = self.capture_dir / "cam1" / "NG"
        photo_dir.mkdir(parents=True)
        photo_path = photo_dir / "defect.bmp"
        Image.new("RGB", (4, 4), "red").save(photo_path)

        listed = self.client.get("/api/photos/1")
        downloaded = self.client.get("/api/photos/1/defect.bmp")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.mimetype, "image/bmp")
        downloaded.close()
        deleted = self.client.delete("/api/photos/1/defect.bmp")

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.get_json()["ngCount"], 1)
        self.assertEqual(listed.get_json()["photos"][0]["result"], "NG")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(photo_path.exists())

    def test_invalid_camera_is_rejected(self):
        response = self.client.get("/api/photos/99")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()

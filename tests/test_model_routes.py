import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.config import Config
from backend.model_routes import model_bp


class ModelRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        app = Flask(__name__)
        app.register_blueprint(model_bp)
        self.client = app.test_client()
        model_path = self.data_dir / "model_classifier_demo.pth"
        model_path.write_bytes(b"model")
        model_path.with_suffix(".json").write_text(
            json.dumps({"categories": ["合格", "划痕"]}, ensure_ascii=False),
            encoding="utf-8",
        )

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_list_models_returns_public_model_summary(self):
        response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["models"][0]["name"], "demo")
        self.assertEqual(payload["models"][0]["num_classes"], 2)

    def test_save_model_settings_validates_and_persists(self):
        response = self.client.post(
            "/api/models/demo/settings",
            json={
                "reject_labels": ["划痕", "不存在"],
                "category_descriptions": {"划痕": "表面划痕"},
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["reject_labels"], ["划痕"])
        stored = json.loads(
            (self.data_dir / "model_classifier_demo.json").read_text(encoding="utf-8")
        )
        self.assertEqual(stored["category_descriptions"], {"划痕": "表面划痕"})

    def test_unknown_model_returns_not_found(self):
        response = self.client.post(
            "/api/models/missing/settings", json={"reject_labels": []}
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()["success"])


if __name__ == "__main__":
    unittest.main()

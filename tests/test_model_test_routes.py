import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.config import Config
from backend.model_test_routes import model_test_bp
from backend.runtime_state import runtime


class ModelTestRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        runtime.system_running = False
        app = Flask(__name__)
        app.register_blueprint(model_test_bp)
        self.client = app.test_client()

    def tearDown(self):
        runtime.system_running = False
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def create_model(self, name="demo"):
        path = self.data_dir / f"model_classifier_{name}.pth"
        path.write_bytes(b"model")
        return path

    def test_requires_model_name(self):
        response = self.client.post("/api/test", json={"mode": "labeled"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("模型名称", response.get_json()["message"])

    def test_rejects_invalid_mode_before_loading_model(self):
        response = self.client.post(
            "/api/test", json={"model_name": "missing", "mode": "invalid"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("测试模式", response.get_json()["message"])

    def test_rejects_unknown_model_without_fallback(self):
        self.create_model("existing")
        response = self.client.post(
            "/api/test", json={"model_name": "missing", "mode": "labeled"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("模型不存在", response.get_json()["message"])

    def test_rejects_offline_test_while_system_is_running(self):
        self.create_model()
        runtime.system_running = True
        response = self.client.post(
            "/api/test", json={"model_name": "demo", "mode": "labeled"}
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("离线测试", response.get_json()["message"])


if __name__ == "__main__":
    unittest.main()

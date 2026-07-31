import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.config import Config
from backend.runtime_state import runtime
from backend.training_routes import training_bp


class TrainingRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        runtime.training_state = {
            "running": False,
            "progress": 0,
            "epoch": 0,
            "total_epochs": Config.TRAINING_EPOCHS,
            "message": "",
            "history": None,
        }
        runtime._training_stop_flag = False
        runtime._training_thread = None
        app = Flask(__name__)
        app.register_blueprint(training_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_status_returns_runtime_state(self):
        runtime.training_state["progress"] = 42

        response = self.client.get("/api/training/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["progress"], 42)

    def test_start_rejects_request_without_dataset(self):
        response = self.client.post(
            "/api/training/start",
            json={"modelName": "demo"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("请选择图片文件夹", response.get_json()["message"])
        self.assertFalse(runtime.training_state["running"])

    def test_stop_sets_stop_flag_and_message(self):
        runtime.training_state["running"] = True

        response = self.client.post("/api/training/stop")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(runtime._training_stop_flag)
        self.assertFalse(runtime.training_state["running"])
        self.assertEqual(runtime.training_state["message"], "训练已手动停止")

    def test_history_prefers_persisted_file(self):
        expected = {"best_epoch": 3, "val_acc": [0.9]}
        (self.data_dir / "training_history.json").write_text(
            json.dumps(expected), encoding="utf-8"
        )

        response = self.client.get("/api/training/history")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["history"], expected)


if __name__ == "__main__":
    unittest.main()

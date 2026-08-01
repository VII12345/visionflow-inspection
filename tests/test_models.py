import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.config import Config
from backend import model_repository
from backend.camera_config_manager import camera_config_manager
from backend.model_routes import model_bp


def _make_model(data_dir: Path, name: str):
    model_path = data_dir / f"model_classifier_{name}.pth"
    model_path.write_bytes(b"model")
    model_path.with_suffix(".json").write_text(
        json.dumps({"categories": ["合格", "划痕"], "num_classes": 2}, ensure_ascii=False),
        encoding="utf-8",
    )
    return model_path


class ModelLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        _make_model(self.data_dir, "demo")
        app = Flask(__name__)
        app.register_blueprint(model_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_delete_unreferenced_model(self):
        response = self.client.delete("/api/models/demo")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        self.assertFalse((self.data_dir / "model_classifier_demo.pth").exists())
        self.assertFalse((self.data_dir / "model_classifier_demo.json").exists())

    def test_delete_unknown_model_returns_404(self):
        response = self.client.delete("/api/models/missing")

        self.assertEqual(response.status_code, 404)

    def test_delete_referenced_by_camera_returns_409(self):
        with patch.object(
            camera_config_manager,
            "get_config",
            return_value={"cameras": {"1": {"model": "demo", "name": "Cam1"}}},
        ):
            response = self.client.delete("/api/models/demo")

        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertTrue(any(ref.get("type") == "camera" for ref in payload["references"]))
        self.assertTrue((self.data_dir / "model_classifier_demo.pth").exists())

    def test_delete_referenced_by_refs_file_returns_409(self):
        (self.data_dir / "model_refs.json").write_text(
            json.dumps([{"model": "demo", "type": "product", "label": "成品一号"}], ensure_ascii=False),
            encoding="utf-8",
        )
        response = self.client.delete("/api/models/demo")

        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertEqual(payload["references"][0]["label"], "成品一号")

    def test_rename_model_updates_files_and_references(self):
        with patch.object(
            camera_config_manager,
            "get_config",
            return_value={"cameras": {"1": {"model": "demo", "name": "Cam1"}}},
        ) as get_config, patch.object(
            camera_config_manager, "save_config", return_value=True
        ) as save_config:
            response = self.client.patch("/api/models/demo", json={"name": "demo-v2"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["model"], "demo-v2")
        self.assertTrue((self.data_dir / "model_classifier_demo-v2.pth").exists())
        self.assertFalse((self.data_dir / "model_classifier_demo.pth").exists())
        # 相机配置引用同步更新
        self.assertEqual(get_config()["cameras"]["1"]["model"], "demo-v2")
        save_config.assert_called_once()

    def test_rename_updates_refs_file(self):
        (self.data_dir / "model_refs.json").write_text(
            json.dumps([{"model": "demo", "type": "product", "label": "成品一号"}], ensure_ascii=False),
            encoding="utf-8",
        )
        response = self.client.patch("/api/models/demo", json={"name": "demo-v2"})

        self.assertEqual(response.status_code, 200)
        stored = json.loads((self.data_dir / "model_refs.json").read_text(encoding="utf-8"))
        self.assertEqual(stored[0]["model"], "demo-v2")

    def test_rename_duplicate_name_returns_400(self):
        _make_model(self.data_dir, "other")
        response = self.client.patch("/api/models/demo", json={"name": "other"})

        self.assertEqual(response.status_code, 400)

    def test_rename_invalid_name_returns_400(self):
        response = self.client.patch("/api/models/demo", json={"name": "包含中文"})

        self.assertEqual(response.status_code, 400)

    def test_list_models_includes_version(self):
        response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        version = payload["models"][0]["version"]
        self.assertIn("trained_at", version)
        self.assertIn("accuracy", version)
        self.assertIn("device", version)


if __name__ == "__main__":
    unittest.main()

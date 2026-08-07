import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.catalog_repository import normalize_line_config, normalize_products
from backend.catalog_routes import catalog_bp
from backend.config import Config


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        app = Flask(__name__)
        app.register_blueprint(catalog_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_get_default_catalog_not_initialized(self):
        response = self.client.get("/api/catalog")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["products"], [])
        self.assertEqual(len(payload["line_config"]), Config.CAMERA_COUNT)
        self.assertFalse(payload["initialized"])

    def test_save_products_then_read_back(self):
        response = self.client.post(
            "/api/catalog",
            json={
                "products": [
                    {"id": 1, "name": "成品一号", "model": "demo", "size": "73mm"},
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["products"][0]["model"], "demo")

        fetched = self.client.get("/api/catalog").get_json()
        self.assertTrue(fetched["initialized"])
        self.assertEqual(fetched["products"][0]["name"], "成品一号")
        # 文件确实落盘
        stored = json.loads(
            (self.data_dir / "catalog_config.json").read_text(encoding="utf-8")
        )
        self.assertEqual(stored["products"][0]["model"], "demo")

    def test_save_line_config_normalizes_to_camera_count(self):
        response = self.client.post(
            "/api/catalog",
            json={
                "line_config": [
                    {"line": 1, "name": "一号线", "productId": 3, "model": "demo"},
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        lines = response.get_json()["line_config"]
        self.assertEqual(len(lines), Config.CAMERA_COUNT)
        self.assertEqual(lines[0]["name"], "一号线")
        self.assertEqual(lines[0]["productId"], 3)
        # 未指定的线体用默认名称
        self.assertEqual(lines[1]["name"], "线体 2")

    def test_products_are_replaced_not_merged(self):
        self.client.post("/api/catalog", json={"products": [{"id": 1, "model": "a"}]})
        self.client.post("/api/catalog", json={"products": [{"id": 2, "model": "b"}]})

        fetched = self.client.get("/api/catalog").get_json()
        self.assertEqual([p["model"] for p in fetched["products"]], ["b"])

    def test_partial_updates_preserve_other_field(self):
        # 只更新产品不应清掉线体配置，只更新线体不应清掉产品
        self.client.post("/api/catalog", json={"products": [{"id": 1, "model": "demo"}]})
        self.client.post(
            "/api/catalog", json={"line_config": [{"line": 1, "name": "一号线"}]}
        )

        fetched = self.client.get("/api/catalog").get_json()
        self.assertEqual(fetched["products"][0]["model"], "demo")
        self.assertEqual(fetched["line_config"][0]["name"], "一号线")

    def test_normalize_products_fills_defaults(self):
        products = normalize_products(
            [{"model": "demo"}, {"id": "2", "name": "", "model": "demo2"}, "bad"]
        )
        self.assertEqual(len(products), 2)
        self.assertEqual(products[0]["name"], "demo")
        self.assertEqual(products[0]["learned"], False)
        self.assertEqual(products[1]["id"], 2)
        self.assertEqual(products[1]["size"], "")
        self.assertEqual(products[0]["remark"], "")

    def test_normalize_line_config_coerces_product_id(self):
        lines = normalize_line_config(
            [
                {"name": "A", "productId": "5", "model": "m"},
                {"name": "B", "productId": None, "model": "-"},
            ]
        )
        self.assertEqual(lines[0]["productId"], 5)
        self.assertIsNone(lines[1]["productId"])


if __name__ == "__main__":
    unittest.main()

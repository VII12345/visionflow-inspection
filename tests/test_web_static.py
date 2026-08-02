import os
import tempfile
import unittest
from pathlib import Path

from flask import Flask

from backend.server import register_web_static


class WebStaticTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.web_dist = Path(self.temp_dir.name) / "dist"
        self.web_dist.mkdir()
        (self.web_dist / "index.html").write_text("<div id=root>测试入口</div>", encoding="utf-8")
        (self.web_dist / "assets").mkdir()
        (self.web_dist / "assets" / "index.css").write_text("body{}", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def _make_client(self):
        os.environ["VISION_WEB_DIST"] = str(self.web_dist)
        try:
            app = Flask(__name__)
            register_web_static(app)
            return app.test_client()
        finally:
            os.environ.pop("VISION_WEB_DIST", None)

    def test_index_served_at_root(self):
        client = self._make_client()
        response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("测试入口".encode("utf-8"), response.data)

    def test_asset_served_with_mime(self):
        client = self._make_client()
        response = client.get("/assets/index.css")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content_type, "text/css; charset=utf-8")

    def test_unknown_path_falls_back_to_index(self):
        client = self._make_client()
        response = client.get("/some/unknown/route")
        self.assertEqual(response.status_code, 200)
        self.assertIn("测试入口".encode("utf-8"), response.data)

    def test_api_paths_not_shadowed(self):
        client = self._make_client()
        response = client.get("/api/not-a-real-endpoint")
        self.assertEqual(response.status_code, 404)
        self.assertIn(b"error", response.data)


if __name__ == "__main__":
    unittest.main()

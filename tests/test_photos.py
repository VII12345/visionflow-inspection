import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from PIL import Image

from backend.config import Config
from backend.photo_routes import photo_bp


def _write_photo(capture_dir: Path, cam_id: int, subdir: str, name: str, mtime=None):
    photo_dir = capture_dir / f"cam{cam_id}" / subdir
    photo_dir.mkdir(parents=True, exist_ok=True)
    photo_path = photo_dir / name
    Image.new("RGB", (4, 4), "white").save(photo_path)
    if mtime is not None:
        os.utime(photo_path, (mtime, mtime))
    return photo_path


class PhotoBrowseTests(unittest.TestCase):
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
        app = Flask(__name__)
        app.register_blueprint(photo_bp)
        self.client = app.test_client()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    def _seed(self):
        _write_photo(self.capture_dir, 1, "OK", "a.bmp", 1700000000)
        _write_photo(self.capture_dir, 1, "NG", "b.bmp", 1700000100)
        _write_photo(self.capture_dir, 2, "OK", "c.bmp", 1700000200)
        _write_photo(self.capture_dir, 2, "NG", "d.bmp", 1700000300)
        _write_photo(self.capture_dir, 1, "OK", "e.bmp", 1700000400)

    def test_pagination(self):
        self._seed()
        response = self.client.get("/api/photos?page=2&page_size=2")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["total"], 5)
        self.assertEqual(payload["page"], 2)
        self.assertEqual(len(payload["items"]), 2)

    def test_filter_by_camera(self):
        self._seed()
        response = self.client.get("/api/photos?camera_id=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["total"], 3)
        self.assertTrue(all(item["camId"] == 1 for item in payload["items"]))

    def test_filter_by_category(self):
        self._seed()
        response = self.client.get("/api/photos?category=NG&page_size=10")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["total"], 2)
        self.assertTrue(all(item["result"] == "NG" for item in payload["items"]))

    def test_filter_by_time_range(self):
        self._seed()
        response = self.client.get(f"/api/photos?start={1699999900}&end={1700000250}&page_size=10")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        # a(…000) / b(…100) / c(…200) 在区间内，d/e 超出
        self.assertEqual(payload["total"], 3)

    def test_export_zip_contains_photos(self):
        self._seed()
        response = self.client.post(
            "/api/photos/export", json={"camera_id": 1, "category": "NG"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/zip")
        data = response.data
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
        self.assertEqual(names, ["cam1/NG/b.bmp"])
        response.close()

    def test_trend_by_day(self):
        self._seed()
        response = self.client.get("/api/photos/trend?interval=day&start=1700000000&end=1700009999")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["success"], True)
        self.assertEqual(len(payload["points"]), 1)
        point = payload["points"][0]
        self.assertEqual(point["total"], 5)
        self.assertEqual(point["ok"], 3)
        self.assertEqual(point["ng"], 2)
        self.assertAlmostEqual(point["yield_rate"], 0.6)

    def test_report_csv_has_header_and_rows(self):
        self._seed()
        response = self.client.get("/api/photos/report.csv")

        self.assertEqual(response.status_code, 200)
        text = response.data.decode("utf-8-sig")
        self.assertIn("日期", text)
        self.assertIn("OK", text)
        self.assertIn("NG", text)
        response.close()


if __name__ == "__main__":
    unittest.main()

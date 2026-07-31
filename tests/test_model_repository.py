import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import Config
from backend.model_repository import (
    get_model_reject_labels,
    list_model_records,
    read_model_metadata,
    update_model_settings,
)


class ModelRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def create_model(self, name="demo", metadata=None):
        model_path = self.data_dir / f"model_classifier_{name}.pth"
        model_path.write_bytes(b"model")
        if metadata is not None:
            model_path.with_suffix(".json").write_text(
                json.dumps(metadata, ensure_ascii=False),
                encoding="utf-8",
            )
        return model_path

    def test_read_model_metadata_normalizes_categories(self):
        model_path = self.create_model(
            metadata={"categories": ["合格", "划痕"], "reject_labels": ["划痕"]}
        )

        metadata, categories, metadata_path = read_model_metadata(model_path)

        self.assertEqual(categories, ["合格", "划痕"])
        self.assertEqual(metadata["reject_labels"], ["划痕"])
        self.assertEqual(metadata_path, model_path.with_suffix(".json"))

    def test_update_model_settings_filters_unknown_and_duplicate_labels(self):
        model_path = self.create_model(metadata={"categories": ["合格", "划痕", "缺角"]})

        saved = update_model_settings(
            "demo",
            ["划痕", "未知", "划痕", "缺角"],
            {"合格": "正常产品", "划痕": "表面划痕", "未知": "忽略"},
        )

        self.assertEqual(saved["reject_labels"], ["划痕", "缺角"])
        self.assertEqual(
            saved["category_descriptions"],
            {"合格": "正常产品", "划痕": "表面划痕"},
        )
        stored = json.loads(model_path.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(stored["reject_labels"], ["划痕", "缺角"])

    def test_list_model_records_and_reject_labels_use_metadata(self):
        self.create_model(
            "beta",
            {
                "categories": ["OK", "NG"],
                "reject_labels": ["NG", "missing"],
                "category_descriptions": {"NG": "不良", "missing": "忽略"},
            },
        )

        records = list_model_records()

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["name"], "beta")
        self.assertEqual(records[0]["reject_labels"], ["NG"])
        self.assertEqual(records[0]["category_descriptions"], {"NG": "不良"})
        self.assertEqual(get_model_reject_labels("beta"), ["NG"])


if __name__ == "__main__":
    unittest.main()

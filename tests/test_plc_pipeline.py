import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import Config
from backend.plc_client import PlcService
from backend.plc_config import get_plc_config, save_plc_config


class PipelineSignalConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        self.path_patch = patch.object(Config, "PLC_CONFIG_FILE", self.data_dir / "plc_config.json")
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_pipeline_signal_address_round_trips(self):
        config = get_plc_config()
        self.assertEqual(config["cameras"]["1"]["pipeline_signal"], "")
        config["cameras"]["1"]["pipeline_signal"] = "MB20"
        saved = save_plc_config(config)
        loaded = get_plc_config()
        self.assertEqual(saved["cameras"]["1"]["pipeline_signal"], "MB20")
        self.assertEqual(loaded["cameras"]["1"]["pipeline_signal"], "MB20")

    def test_legacy_config_loads_with_optional_empty_pipeline_signal(self):
        legacy = get_plc_config()
        for mapping in legacy["cameras"].values():
            mapping.pop("pipeline_signal", None)
        (self.data_dir / "plc_config.json").write_text(json.dumps(legacy), encoding="utf-8")
        loaded = get_plc_config()
        self.assertEqual(loaded["cameras"]["1"]["pipeline_signal"], "")

    def test_pipeline_bool_semantics_encode_as_byte_zero_or_one(self):
        config = {"cameras": {"1": {"pipeline_signal": "MB20"}}}
        client = PlcService()
        with patch.object(client, "write_byte", return_value={"ok": True}) as write_byte:
            client.write_pipeline_signal(1, True, config=config)
            client.write_pipeline_signal(1, False, config=config)
        self.assertEqual(write_byte.call_args_list[0].args, ("MB20", 1))
        self.assertEqual(write_byte.call_args_list[1].args, ("MB20", 0))

    def test_unconfigured_pipeline_signal_is_noop(self):
        client = PlcService()
        with patch.object(client, "write_byte") as write_byte:
            self.assertIsNone(client.write_pipeline_signal(1, True, config={"cameras": {"1": {"pipeline_signal": ""}}}))
        write_byte.assert_not_called()


if __name__ == "__main__":
    unittest.main()
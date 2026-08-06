"""logger 日志存储结构（按天文件夹 + 会话文件 + 旧日志迁移）的单元测试。"""

import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend import logger as logger_mod
from backend.config import Config


class LoggerPathsTest(unittest.TestCase):
    def setUp(self):
        self._saved = (logger_mod._active_log_file, logger_mod._active_log_error_file)
        logger_mod._active_log_file = None
        logger_mod._active_log_error_file = None

    def tearDown(self):
        logger_mod._active_log_file, logger_mod._active_log_error_file = self._saved

    def test_session_paths_under_day_folder(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            with patch.object(Config, "LOG_DIR", log_dir):
                main, error = logger_mod._session_log_paths()
            self.assertEqual(main.parent, log_dir / time.strftime("%Y-%m-%d"))
            self.assertTrue(main.name.startswith("vision_system_") and main.name.endswith(".log"))
            self.assertTrue(error.name.startswith("vision_system_error_") and error.name.endswith(".log"))
            self.assertTrue(main.parent.exists())

    def test_session_paths_are_stable(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            with patch.object(Config, "LOG_DIR", log_dir):
                first = logger_mod._session_log_paths()
                second = logger_mod._session_log_paths()
            self.assertEqual(first, second)

    def test_migrate_legacy_logs(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            old_main = Path(tmp) / "vision_system.log"
            old_err = Path(tmp) / "vision_system_error.log"
            old_main.write_text("old", encoding="utf-8")
            old_err.write_text("err", encoding="utf-8")
            with (
                patch.object(Config, "LOG_DIR", log_dir),
                patch.object(Config, "LOG_FILE", old_main),
                patch.object(Config, "LOG_ERROR_FILE", old_err),
            ):
                logger_mod._migrate_legacy_logs()
            self.assertFalse(old_main.exists())
            names = {p.name for p in log_dir.glob("legacy_*.log")}
            self.assertIn("legacy_vision_system.log", names)
            self.assertIn("legacy_vision_system_error.log", names)

    def test_get_active_log_files_returns_both(self):
        with TemporaryDirectory() as tmp:
            with patch.object(Config, "LOG_DIR", Path(tmp) / "logs"):
                files = logger_mod.get_active_log_files()
            self.assertIn("main", files)
            self.assertIn("error", files)


if __name__ == "__main__":
    unittest.main()

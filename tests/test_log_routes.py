"""日志读取接口（log_routes）的单元测试。

覆盖尾部读取（截断/多行/UTF-8）、文本解析（多行堆栈归并）与接口（当前会话/历史文件
读取、级别过滤、文件列表、下载白名单、路径穿越防护）。全部使用临时目录，不读写真实
data 目录。
"""

import unittest
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend import log_routes as lr
from backend.config import Config


class TailLinesTest(unittest.TestCase):
    def test_returns_last_n_lines(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "log.txt"
            p.write_text("".join(f"line {i}\n" for i in range(100)), encoding="utf-8")
            self.assertEqual(lr._tail_lines(p, 5), [f"line {i}" for i in range(95, 100)])

    def test_missing_or_empty_returns_empty(self):
        with TemporaryDirectory() as tmp:
            self.assertEqual(lr._tail_lines(Path(tmp) / "nope.txt", 10), [])
            p = Path(tmp) / "empty.txt"
            p.write_text("", encoding="utf-8")
            self.assertEqual(lr._tail_lines(p, 10), [])

    def test_truncated_window_drops_partial_first_line(self):
        # 文件远大于读取块时，读窗不覆盖开头，首行是被截断的半行，应被丢弃。
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "big.txt"
            p.write_text("".join(f"line {i} " + "x" * 200 + "\n" for i in range(2000)), encoding="utf-8")
            tail = lr._tail_lines(p, 3)
            self.assertEqual(len(tail), 3)
            self.assertTrue(all(line.startswith("line ") for line in tail))

    def test_multiline_utf8_safe(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "log.txt"
            p.write_text("中文消息行\n" * 50, encoding="utf-8")
            self.assertEqual(lr._tail_lines(p, 3), ["中文消息行"] * 3)


class ParseLinesTest(unittest.TestCase):
    def test_groups_multiline_traceback(self):
        raw = [
            "2026-08-06 10:00:00 [ERROR] a.b: boom",
            'Traceback (most recent call last):',
            '  File "x.py", line 1, in <module>',
            "2026-08-06 10:00:01 [INFO] a.b: ok",
        ]
        entries = lr._parse_lines(raw)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["level"], "ERROR")
        self.assertIn("Traceback", entries[0]["message"])
        self.assertIn("x.py", entries[0]["message"])
        self.assertEqual(entries[1]["message"], "ok")


class LogsApiTest(unittest.TestCase):
    def setUp(self):
        from flask import Flask

        app = Flask(__name__)
        app.register_blueprint(lr.log_bp)
        self.client = app.test_client()

    def _mk(self, parent, name, lines):
        parent.mkdir(parents=True, exist_ok=True)
        p = parent / name
        p.write_text("".join(lines), encoding="utf-8")
        return p

    def _patch_active(self, log_dir, main, error):
        """把日志目录与当前会话文件指向临时目录。"""
        stack = ExitStack()
        stack.enter_context(patch.object(Config, "LOG_DIR", log_dir))
        stack.enter_context(patch.object(lr, "get_active_log_files", return_value={"main": main, "error": error}))
        return stack

    def test_get_logs_reads_active_session(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            day = log_dir / "2026-08-06"
            main = self._mk(day, "vision_system_20260806_100000.log",
                            [f"2026-08-06 10:00:00 [INFO] test: m{i}\n" for i in range(20)])
            error = self._mk(day, "vision_system_error_20260806_100000.log", [])
            with self._patch_active(log_dir, main, error):
                d = self.client.get("/api/logs?lines=5").get_json()
            self.assertTrue(d["success"])
            self.assertEqual(len(d["lines"]), 5)
            self.assertEqual(d["lines"][-1]["message"], "m19")
            self.assertIn("vision_system_20260806_100000.log", d["file"])

    def test_get_logs_by_historical_file(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            day = log_dir / "2026-08-05"
            hist = self._mk(day, "vision_system_20260805_090000.log",
                            ["2026-08-05 09:00:00 [INFO] test: hist\n"])
            cur_day = log_dir / "2026-08-06"
            main = self._mk(cur_day, "vision_system_20260806_100000.log", ["2026-08-06 [INFO] test: cur\n"])
            error = self._mk(cur_day, "vision_system_error_20260806_100000.log", [])
            with self._patch_active(log_dir, main, error):
                d = self.client.get("/api/logs?file=2026-08-05/vision_system_20260805_090000.log").get_json()
            self.assertTrue(d["success"])
            self.assertEqual(d["lines"][0]["message"], "hist")
            # 路径穿越应被拒
            r = self.client.get("/api/logs?file=..%2F..%2Fsecret.txt")
            self.assertEqual(r.status_code, 404)

    def test_level_filter(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            day = log_dir / "2026-08-06"
            main = self._mk(day, "vision_system_20260806_100000.log", [
                "2026-08-06 10:00:00 [INFO] test: i\n",
                "2026-08-06 10:00:00 [WARNING] test: w\n",
                "2026-08-06 10:00:00 [ERROR] test: e\n",
            ])
            error = self._mk(day, "vision_system_error_20260806_100000.log", [])
            with self._patch_active(log_dir, main, error):
                d = self.client.get("/api/logs?level=WARNING").get_json()
            self.assertEqual([x["level"] for x in d["lines"]], ["WARNING", "ERROR"])

    def test_bad_source_rejected(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            main = self._mk(log_dir / "2026-08-06", "vision_system_20260806_100000.log", [])
            error = self._mk(log_dir / "2026-08-06", "vision_system_error_20260806_100000.log", [])
            with self._patch_active(log_dir, main, error):
                r = self.client.get("/api/logs?source=bad")
            self.assertEqual(r.status_code, 400)

    def test_download_validates_name(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            main = self._mk(log_dir / "2026-08-06", "vision_system_20260806_100000.log", ["hello"])
            error = self._mk(log_dir / "2026-08-06", "vision_system_error_20260806_100000.log", [])
            with self._patch_active(log_dir, main, error):
                r = self.client.get("/api/logs/download?file=2026-08-06/vision_system_20260806_100000.log")
                try:
                    self.assertEqual(r.status_code, 200)
                finally:
                    r.close()
                r2 = self.client.get("/api/logs/download?file=..%2F..%2Fsecret.txt")
                try:
                    self.assertEqual(r2.status_code, 404)
                finally:
                    r2.close()

    def test_files_lists_recursively(self):
        with TemporaryDirectory() as tmp:
            log_dir = Path(tmp) / "logs"
            self._mk(log_dir / "2026-08-05", "vision_system_20260805_090000.log", ["a"])
            self._mk(log_dir / "2026-08-06", "vision_system_20260806_100000.log", ["b"])
            self._mk(log_dir / "2026-08-06", "vision_system_error_20260806_100000.log", ["c"])
            with patch.object(Config, "LOG_DIR", log_dir), patch.object(lr, "get_active_log_files", return_value={"main": Path("x"), "error": Path("y")}):
                d = self.client.get("/api/logs/files").get_json()
            names = {f["name"] for f in d["files"]}
            self.assertIn("2026-08-05/vision_system_20260805_090000.log", names)
            self.assertIn("2026-08-06/vision_system_error_20260806_100000.log", names)


if __name__ == "__main__":
    unittest.main()

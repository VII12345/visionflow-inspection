"""LECPServer 自动启动管理（lecpserver_launcher）的单元测试。

覆盖 exe 定位、pid 文件读写、端口探测与窗口隐藏；不真正拉起 LECPServer.exe。
"""

import socket
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend import lecpserver_launcher as launcher
from backend.config import Config


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ResolveExeTest(unittest.TestCase):
    def _exe(self, tmp, name="LECPServer.exe"):
        path = Path(tmp) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        return path

    def test_first_existing_wins(self):
        with TemporaryDirectory() as tmp:
            first = self._exe(tmp, "a")
            second = self._exe(tmp, "b")
            with patch.object(launcher, "_candidate_paths", return_value=[first, second]):
                self.assertEqual(launcher.resolve_lecpserver_exe(), first)

    def test_skips_missing_until_hit(self):
        with TemporaryDirectory() as tmp:
            existing = self._exe(tmp, "b")
            missing = Path(tmp) / "missing" / "LECPServer.exe"
            with patch.object(launcher, "_candidate_paths", return_value=[missing, existing]):
                self.assertEqual(launcher.resolve_lecpserver_exe(), existing)

    def test_all_missing_returns_none(self):
        with TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing" / "LECPServer.exe"
            with patch.object(launcher, "_candidate_paths", return_value=[missing]):
                self.assertIsNone(launcher.resolve_lecpserver_exe())


class PidFileTest(unittest.TestCase):
    def test_roundtrip(self):
        with TemporaryDirectory() as tmp:
            with (
                patch.object(Config, "DATA_DIR", Path(tmp)),
                patch.object(Config, "LECPSERVER_PID_FILE", Path(tmp) / "lecpserver.pid"),
            ):
                launcher._write_pidfile(12345, "C:/x/LECPServer.exe")
                data = launcher._read_pidfile()
                self.assertEqual(data["pid"], 12345)
                self.assertEqual(data["exe"], "C:/x/LECPServer.exe")
                launcher._remove_pidfile()
                self.assertIsNone(launcher._read_pidfile())

    def test_corrupted_file_returns_none(self):
        with TemporaryDirectory() as tmp:
            pidfile = Path(tmp) / "lecpserver.pid"
            pidfile.write_text("not json", encoding="utf-8")
            with patch.object(Config, "LECPSERVER_PID_FILE", pidfile):
                self.assertIsNone(launcher._read_pidfile())


class ProbePortTest(unittest.TestCase):
    def test_open_port_probes_true(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = sock.getsockname()[1]
            self.assertTrue(launcher._probe_port("127.0.0.1", port))

    def test_closed_port_probes_false(self):
        port = _free_port()
        self.assertFalse(launcher._probe_port("127.0.0.1", port, timeout=0.3))


class HideWindowsTest(unittest.TestCase):
    def test_unknown_pid_returns_zero(self):
        self.assertEqual(launcher._hide_windows_for_pid(-1), 0)


class ProbeAddressTest(unittest.TestCase):
    def test_parses_plc_base_url(self):
        with patch("backend.lecpserver_launcher.get_plc_config",
                   return_value={"base_url": "http://10.0.0.9:9000/"}):
            self.assertEqual(launcher._plc_probe_address(), ("10.0.0.9", 9000))

    def test_falls_back_when_config_bad(self):
        with (
            patch("backend.lecpserver_launcher.get_plc_config", side_effect=Exception("bad")),
            patch.object(Config, "LECPSERVER_HOST", "127.0.0.1"),
            patch.object(Config, "LECPSERVER_PORT", 8088),
        ):
            self.assertEqual(launcher._plc_probe_address(), ("127.0.0.1", 8088))


if __name__ == "__main__":
    unittest.main()

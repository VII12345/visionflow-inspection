"""LECPServer 自动启动管理（lecpserver_launcher）的单元测试。

覆盖 exe 定位、pid 文件读写、端口探测与窗口隐藏；不真正拉起 LECPServer.exe。
"""

import socket
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend import lecpserver_launcher as launcher
from backend.config import Config


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _fresh_state():
    """每个测试用全新 _state，避免跨用例污染。"""
    launcher._state = {
        "supported": False,
        "enabled": True,
        "exe": None,
        "port_open_at_start": False,
        "managed": False,
        "pid": None,
        "ready": False,
        "ready_after_sec": None,
        "error": None,
    }


class _FakeProc:
    def __init__(self, pid=12345):
        self.pid = pid
        self.returncode = None

    def poll(self):
        return None


class _FakeThread:
    def __init__(self, target=None, args=(), kwargs=None, **kw):
        self.target = target
        self.args = args
        self.kwargs = kwargs or {}

    def start(self):
        pass


@contextmanager
def _patched_config(tmp):
    """把 Config 的数据目录与 pid 文件指向临时目录。"""
    with (
        patch.object(Config, "DATA_DIR", Path(tmp)),
        patch.object(Config, "LECPSERVER_PID_FILE", Path(tmp) / "lecpserver.pid"),
    ):
        yield


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


class CleanupOrphanTest(unittest.TestCase):
    def test_live_orphan_is_killed_and_returns_true(self):
        with TemporaryDirectory() as tmp:
            killed = []
            with (
                _patched_config(tmp),
                patch("psutil.Process", return_value=type("P", (), {"name": lambda self: "LECPServer.exe"})()),
                patch.object(launcher, "_kill_tree", side_effect=lambda pid: killed.append(pid)),
            ):
                launcher._write_pidfile(4242, "C:/x/LECPServer.exe")
                self.assertTrue(launcher._cleanup_orphan())
            self.assertEqual(killed, [4242])
            self.assertFalse((Path(tmp) / "lecpserver.pid").exists())

    def test_dead_orphan_returns_false_and_cleans_pidfile(self):
        with TemporaryDirectory() as tmp:
            with (
                _patched_config(tmp),
                patch("psutil.Process", side_effect=psutil_no_such_process()),
            ):
                launcher._write_pidfile(4242, "C:/x/LECPServer.exe")
                self.assertFalse(launcher._cleanup_orphan())
            self.assertFalse((Path(tmp) / "lecpserver.pid").exists())

    def test_pid_reuse_non_lecpserver_not_killed(self):
        with TemporaryDirectory() as tmp:
            killed = []
            with (
                _patched_config(tmp),
                patch("psutil.Process", return_value=type("P", (), {"name": lambda self: "notepad.exe"})()),
                patch.object(launcher, "_kill_tree", side_effect=lambda pid: killed.append(pid)),
            ):
                launcher._write_pidfile(4242, "C:/x/LECPServer.exe")
                self.assertFalse(launcher._cleanup_orphan())
            self.assertEqual(killed, [])

    def test_no_pidfile_returns_false(self):
        with TemporaryDirectory() as tmp:
            with _patched_config(tmp):
                self.assertFalse(launcher._cleanup_orphan())


def psutil_no_such_process():
    import psutil
    return lambda pid: (_ for _ in ()).throw(psutil.NoSuchProcess(pid))


class EnsureStartedTest(unittest.TestCase):
    def _base_patches(self):
        return (
            patch.object(Config, "IS_WINDOWS", True),
            patch.object(Config, "LECPSERVER_AUTO_START", True),
            patch.object(launcher, "resolve_lecpserver_exe",
                         return_value=Path("C:/lecpserver/LECPServer.exe")),
            patch.object(launcher, "_write_pidfile"),
            patch.object(launcher, "_assign_kill_on_close_job", return_value=None),
            patch("threading.Thread", _FakeThread),
        )

    def test_reclaims_live_orphan_then_manages_new_instance(self):
        _fresh_state()
        spawned = []
        with ExitStack() as stack:
            for cm in self._base_patches():
                stack.enter_context(cm)
            stack.enter_context(patch.object(launcher, "_probe_port", side_effect=[True, False, False]))
            stack.enter_context(patch.object(launcher, "_cleanup_orphan", return_value=True))
            stack.enter_context(patch.object(launcher, "_spawn", side_effect=lambda exe: (_FakeProc(), spawned.append(exe))[0]))
            st = launcher.ensure_started()
        self.assertEqual(len(spawned), 1)
        self.assertTrue(st["managed"])
        self.assertEqual(st["pid"], 12345)
        self.assertFalse(st["port_open_at_start"])

    def test_port_open_without_orphan_is_user_manual_and_skipped(self):
        _fresh_state()
        with ExitStack() as stack:
            for cm in self._base_patches():
                stack.enter_context(cm)
            stack.enter_context(patch.object(launcher, "_probe_port", return_value=True))
            stack.enter_context(patch.object(launcher, "_cleanup_orphan", return_value=False))
            stack.enter_context(patch.object(launcher, "_spawn", side_effect=AssertionError("不应启动")))
            st = launcher.ensure_started()
        self.assertFalse(st["managed"])
        self.assertTrue(st["port_open_at_start"])
        self.assertTrue(st["ready"])

    def test_port_free_starts_managed(self):
        _fresh_state()
        spawned = []
        with ExitStack() as stack:
            for cm in self._base_patches():
                stack.enter_context(cm)
            stack.enter_context(patch.object(launcher, "_probe_port", return_value=False))
            stack.enter_context(patch.object(launcher, "_cleanup_orphan", return_value=False))
            stack.enter_context(patch.object(launcher, "_spawn", side_effect=lambda exe: (_FakeProc(), spawned.append(exe))[0]))
            st = launcher.ensure_started()
        self.assertEqual(len(spawned), 1)
        self.assertTrue(st["managed"])


class AssignKillOnCloseJobTest(unittest.TestCase):
    def test_non_windows_returns_none(self):
        with patch.object(launcher.os, "name", "posix"):
            self.assertIsNone(launcher._assign_kill_on_close_job(_FakeProc()))


if __name__ == "__main__":
    unittest.main()

"""LECPServer 自动启动/关闭管理。

应用启动时由 server_bootstrap 调用 ensure_started()，在后台把 LECPServer.exe
拉起来（窗口隐藏）并等待其 webapi 就绪；进程退出时 stop() 关闭由本进程启动的
实例。若 8088 端口已被占用（用户手动开着 LECPServer），则跳过启动且退出时不杀。

LECPServer.exe 的 manifest 是 requireAdministrator，因此本模块（以及整个应用）
需要以管理员权限运行：打包时 backend.spec 用 uac_admin=True、Tauri 主程序用
manifest.xml 声明 requireAdministrator。

后端被 Tauri 硬杀导致 atexit 不执行时，靠 data/lecpserver.pid 跨启动清理孤儿。
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from .config import Config
from .logger import logger
from .plc_config import get_plc_config

_SW_HIDE = 0
_SW_MINIMIZE = 6
_SWP_HIDEWINDOW = 0x0080
_SWP_NOMOVE = 0x0002
_SWP_NOSIZE = 0x0001
_WM_SYSCOMMAND = 0x0112
_SC_MINIMIZE = 0xF020

_state = {
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
_state_lock = threading.Lock()


def status():
    """返回当前 LECPServer 管理状态快照。"""
    with _state_lock:
        return dict(_state)


def resolve_lecpserver_exe():
    """按优先级定位 LECPServer.exe；全部未命中返回 None。"""
    for candidate in _candidate_paths():
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _candidate_paths():
    if Config.LECPSERVER_EXE:
        yield Path(Config.LECPSERVER_EXE)
    if Config.LECPSERVER_DIR:
        yield Path(Config.LECPSERVER_DIR) / "LECPServer.exe"
    if getattr(sys, "frozen", False):
        # 打包：resources/lecpserver 与 backend 同级，或在其父目录 resources/ 下
        yield Path(sys.executable).parent / "lecpserver" / "LECPServer.exe"
        yield Path(sys.executable).parent.parent / "lecpserver" / "LECPServer.exe"
    else:
        project = Path(__file__).resolve().parent.parent
        yield project / "resources" / "lecpserver" / "LECPServer.exe"
        yield project / "view" / "resources" / "lecpserver" / "LECPServer.exe"


def ensure_started():
    """幂等；启动 LECPServer（如需要），就绪轮询放后台线程，不阻塞调用方。"""
    if not Config.IS_WINDOWS:
        with _state_lock:
            _state["supported"] = False
        logger.info("LECPServer 自动启动仅支持 Windows，已跳过")
        return status()
    with _state_lock:
        _state["supported"] = True
        _state["enabled"] = Config.LECPSERVER_AUTO_START
    if not Config.LECPSERVER_AUTO_START:
        logger.info("LECPSERVER_AUTO_START=0，跳过自动启动")
        return status()

    exe = resolve_lecpserver_exe()
    with _state_lock:
        _state["exe"] = str(exe) if exe else None
    if exe is None:
        logger.warning("未找到 LECPServer.exe，自动启动已跳过（可用 LECPSERVER_EXE 环境变量指定）")
        with _state_lock:
            _state["error"] = "未找到 LECPServer.exe"
        return status()

    host, port = _plc_probe_address()
    if _probe_port(host, port):
        with _state_lock:
            _state["port_open_at_start"] = True
            _state["managed"] = False
            _state["ready"] = True
            _state["error"] = None
        logger.info(f"LECPServer 已在运行（{host}:{port}），跳过自动启动")
        return status()

    _cleanup_orphan()
    try:
        proc = _spawn(exe)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 740:
            message = "启动 LECPServer 失败: 需要管理员权限。请以管理员身份运行本程序（LECPServer.exe 的 manifest 为 requireAdministrator）"
        else:
            message = f"启动 LECPServer 失败: {exc}"
        with _state_lock:
            _state["error"] = message
        logger.error(message)
        return status()

    with _state_lock:
        _state["managed"] = True
        _state["pid"] = proc.pid
        _state["error"] = None
    _write_pidfile(proc.pid, exe)
    logger.info(f"LECPServer 已启动 (pid={proc.pid}, exe={exe})")
    threading.Thread(
        target=_wait_ready_and_hide,
        args=(proc, proc.pid),
        daemon=True,
        name="lecpserver-wait-ready",
    ).start()
    return status()


def stop():
    """只停止由本进程启动的 LECPServer 实例；幂等。"""
    with _state_lock:
        if not _state["managed"]:
            return
        pid = _state["pid"]
        _state["managed"] = False
        _state["pid"] = None
    if pid is None:
        data = _read_pidfile()
        pid = data["pid"] if data else None
    if pid:
        logger.info(f"停止 LECPServer (pid={pid})")
        _kill_tree(pid)
    _remove_pidfile()


# ========== 内部实现 ==========


def _plc_probe_address():
    """从 PLC 配置解析探测地址，保证探测对象与 PLC 客户端写的地址一致。"""
    try:
        cfg = get_plc_config()
        parsed = urlparse(cfg.get("base_url") or "")
        host = parsed.hostname or Config.LECPSERVER_HOST
        port = parsed.port or Config.LECPSERVER_PORT
        return host, port
    except Exception:
        return Config.LECPSERVER_HOST, Config.LECPSERVER_PORT


def _probe_port(host, port, timeout=1.0):
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def _spawn(exe):
    startupinfo = None
    creationflags = 0
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = _SW_HIDE if Config.LECPSERVER_HIDE_MODE == "hide" else _SW_MINIMIZE
        creationflags = subprocess.CREATE_NO_WINDOW
    return subprocess.Popen(
        [str(exe)],
        cwd=str(exe.parent),  # 读同目录 plc.conf/modules.conf，probing 相对 dlls\
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        startupinfo=startupinfo,
        creationflags=creationflags,
    )


def _hide_windows_for_pid(pid):
    """隐藏或最小化属于 pid 的所有顶层窗口；非 Windows 直接返回 0。

    LECPServer 是 WinForms+内嵌浏览器窗口，对 ShowWindow 有重新显示行为：
    hide 模式先 SetWindowPos(SWP_HIDEWINDOW)（绕过 WM_SHOWWINDOW 处理）再
    ShowWindow；minimize 模式发 SC_MINIMIZE（实测可保持最小化）。本进程与
    LECPServer 同权限（整个应用以管理员运行）时这些调用不受访问限制。
    """
    if os.name != "nt":
        return 0
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    minimize = Config.LECPSERVER_HIDE_MODE != "hide"
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lparam):
        wpid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value == pid:
            found.append(hwnd)
        return True

    try:
        user32.EnumWindows(_cb, 0)
    except Exception:
        return 0
    for hwnd in found:
        try:
            if minimize:
                user32.SendMessageW(hwnd, _WM_SYSCOMMAND, _SC_MINIMIZE, 0)
            else:
                user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, _SWP_HIDEWINDOW | _SWP_NOMOVE | _SWP_NOSIZE)
                user32.ShowWindow(hwnd, _SW_HIDE)
        except Exception:
            pass
    return len(found)


def _wait_ready_and_hide(proc, pid):
    host, port = _plc_probe_address()
    start = time.time()
    # 第一遍隐藏尽量早，压掉窗口闪现
    _hide_windows_for_pid(pid)
    deadline = start + Config.LECPSERVER_READY_TIMEOUT
    ready_after = None
    while time.time() < deadline:
        if proc.poll() is not None:
            with _state_lock:
                _state["error"] = f"LECPServer 进程提前退出 (exit={proc.returncode})"
                _state["pid"] = None
                _state["managed"] = False
            _remove_pidfile()
            logger.error(_state["error"])
            return
        if _probe_port(host, port):
            ready_after = time.time() - start
            break
        time.sleep(1.0)
    if ready_after is None:
        with _state_lock:
            _state["error"] = f"LECPServer 启动后 {Config.LECPSERVER_READY_TIMEOUT}s 内 webapi 未就绪"
        logger.warning(_state["error"])
    else:
        with _state_lock:
            _state["ready"] = True
            _state["ready_after_sec"] = round(ready_after, 1)
        logger.info(f"LECPServer webapi 就绪 ({ready_after:.1f}s)")
    # 持续压制窗口：进程存活期间每几秒最小化/隐藏一次，覆盖启动期迟建与重建的窗口。
    # （本实例退出或被 stop() 杀掉后 proc.poll() 非空，循环随之结束）
    while proc.poll() is None:
        _hide_windows_for_pid(pid)
        time.sleep(Config.LECPSERVER_HIDE_INTERVAL)


def _pidfile_path():
    return Path(Config.LECPSERVER_PID_FILE)


def _write_pidfile(pid, exe):
    try:
        Config.DATA_DIR.mkdir(exist_ok=True)
        payload = {
            "pid": pid,
            "exe": str(exe),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        _pidfile_path().write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:
        logger.warning(f"写入 LECPServer pid 文件失败: {exc}")


def _read_pidfile():
    try:
        data = json.loads(_pidfile_path().read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("pid"), int):
            return data
    except (OSError, ValueError, TypeError):
        pass
    return None


def _remove_pidfile():
    try:
        _pidfile_path().unlink(missing_ok=True)
    except OSError:
        pass


def _kill_tree(pid):
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                capture_output=True,
                timeout=15,
            )
            return
        except Exception as exc:
            logger.warning(f"taskkill 失败，回退 psutil: {exc}")
    try:
        import psutil

        proc = psutil.Process(pid)
        for child in proc.children(recursive=True):
            try:
                child.kill()
            except psutil.Error:
                pass
        proc.kill()
    except Exception as exc:
        logger.warning(f"结束 LECPServer 进程失败: {exc}")


def _cleanup_orphan():
    data = _read_pidfile()
    if data is None:
        return
    pid = data["pid"]
    _remove_pidfile()
    try:
        import psutil

        proc = psutil.Process(pid)
        name = (proc.name() or "").lower()
        if "lepcserver" not in name:
            logger.info(f"忽略 pid 文件中的非 LECPServer 进程 (pid={pid}, name={name})")
            return
        logger.info(f"清理上次遗留的 LECPServer 进程 (pid={pid})")
        _kill_tree(pid)
    except psutil.NoSuchProcess:
        logger.info("pid 文件中的 LECPServer 进程已不存在，跳过清理")
    except psutil.Error as exc:
        logger.warning(f"清理遗留 LECPServer 进程失败: {exc}")

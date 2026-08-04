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
# 窗口压制诊断日志节流
_hide_state = {"last_log": 0.0}


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
    # 即时隐藏：WinEvent 钩子在窗口被显示的瞬间同步 SW_HIDE，消除闪现
    threading.Thread(
        target=_win_event_hide_loop,
        args=(proc.pid,),
        daemon=True,
        name="lecpserver-window-hide",
    ).start()
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
    # 用 SW_HIDE 启动，尽量让窗口从头就不出现（无闪现）。若应用忽略 nCmdShow
    # 仍显示窗口，则等 webapi 就绪后由窗口压制线程 SW_HIDE 掉。健康检查会在
    # 隐藏后确认 8088 仍存活。
    startupinfo = None
    creationflags = 0
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = _SW_HIDE
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
    """隐藏（默认）或最小化 pid（含子进程）的可见顶层窗口；非 Windows 返回 0。

    hide 模式用 SetWindowPos(SWP_HIDEWINDOW)+ShowWindow(SW_HIDE) 完全隐藏
    （任务栏也不留）；minimize 模式发 SC_MINIMIZE 最小化到任务栏。实测在
    同权限（整应用提权）下两种都有效。带节流诊断日志。
    """
    if os.name != "nt":
        return 0
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    pids = {pid}
    try:
        import psutil

        try:
            for child in psutil.Process(pid).children(recursive=True):
                pids.add(child.pid)
        except (psutil.Error, ValueError):
            pass
    except ImportError:
        pass

    windows = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lparam):
        wpid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value in pids and user32.IsWindowVisible(hwnd):
            windows.append(hwnd)
        return True

    try:
        user32.EnumWindows(_cb, 0)
    except Exception:
        return 0

    hide = Config.LECPSERVER_HIDE_MODE == "hide"
    for hwnd in windows:
        try:
            if hide:
                user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, _SWP_HIDEWINDOW | _SWP_NOMOVE | _SWP_NOSIZE)
                user32.ShowWindow(hwnd, _SW_HIDE)
            else:
                user32.SendMessageW(hwnd, _WM_SYSCOMMAND, _SC_MINIMIZE, 0)
                user32.ShowWindow(hwnd, _SW_MINIMIZE)
        except Exception:
            pass

    # 节流诊断：窗口数 + 仍可见数（hide 模式下 0 表示隐藏成功），便于现场定位
    now = time.time()
    if windows and (now - _hide_state["last_log"] > 15):
        _hide_state["last_log"] = now
        still_visible = sum(1 for h in windows if user32.IsWindowVisible(h))
        logger.info(
            f"LECPServer 窗口压制: 找到 {len(windows)} 个可见窗口, "
            f"仍可见 {still_visible} (mode={Config.LECPSERVER_HIDE_MODE}, pid={pid})"
        )
    return len(windows)


def _win_event_hide_loop(pid):
    """用 WinEvent 钩子即时隐藏 pid 的顶层窗口，消除启动闪现。

    LECPServer（WinForms）会忽略 SW_HIDE 的 nCmdShow 并主动显示主窗口，轮询
    压制有延迟仍会闪现。SetWinEventHook(EVENT_OBJECT_SHOW) 在窗口被显示的
    事件派发瞬间同步 SW_HIDE，用户看不到它。此线程跑消息循环，进程退出后由
    后端结束（daemon）。
    """
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    EVENT_OBJECT_SHOW = 0x8002
    WINEVENT_OUTOFCONTEXT = 0x0000

    WINEVENTPROC = ctypes.WINFUNCTYPE(
        None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND,
        wintypes.LONG, wintypes.LONG, wintypes.DWORD, wintypes.DWORD,
    )

    @WINEVENTPROC
    def _cb(_hook, _event, hwnd, id_object, _id_child, _thread, _time):
        if id_object != 0:  # 仅处理 OBJID_WINDOW
            return
        try:
            wpid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value == pid:
                user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, _SWP_HIDEWINDOW | _SWP_NOMOVE | _SWP_NOSIZE)
                user32.ShowWindow(hwnd, _SW_HIDE)
        except Exception:
            pass

    hook = user32.SetWinEventHook(
        EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, None, _cb, pid, 0, WINEVENT_OUTOFCONTEXT
    )
    if not hook:
        logger.warning("注册 LECPServer 窗口隐藏钩子失败，退化为轮询压制")
        return
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        user32.DispatchMessageW(ctypes.byref(msg))
    user32.UnhookWinEvent(hook)


def _wait_ready_and_hide(proc, pid):
    host, port = _plc_probe_address()
    start = time.time()
    deadline = start + Config.LECPSERVER_READY_TIMEOUT
    ready_after = None
    while time.time() < deadline:
        # 启动期间就持续隐藏窗口（配合 SW_HIDE 启动，消除闪现）。健康检查会确认
        # 隐藏不影响 webapi；若影响，ready 会超时并记 warning。
        _hide_windows_for_pid(pid)
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
        # 未就绪时保留窗口可见，便于现场查看 LECPServer 的错误界面
        return
    with _state_lock:
        _state["ready"] = True
        _state["ready_after_sec"] = round(ready_after, 1)
    logger.info(f"LECPServer webapi 就绪 ({ready_after:.1f}s)")
    # 就绪后继续持续隐藏窗口；进程存活期间每几秒压一次，覆盖迟建/重建的窗口。
    # （本实例退出或被 stop() 杀掉后 proc.poll() 非空，循环随之结束）
    logger.info("LECPServer 窗口压制线程已启动")
    cycle = 0
    while proc.poll() is None:
        _hide_windows_for_pid(pid)
        cycle += 1
        if cycle % 5 == 0 and not _probe_port(host, port):
            logger.warning("LECPServer webapi 在窗口压制后停止响应，请检查 LECPServer 状态")
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

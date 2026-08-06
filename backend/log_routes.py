"""日志读取接口：尾部查看（支持级别过滤/历史文件）、文件列表、下载。

日志按 data/logs/<日期>/ 组织，每次启动一个会话文件。前端"日志"页签轮询
GET /api/logs 读当前会话；带 file 参数可读任意历史文件。鉴权由 server.py 的
require_auth_middleware 统一 gate，本蓝图无需额外处理。
"""

import os
import re
import time
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from .config import Config
from .logger import get_active_log_files

log_bp = Blueprint("logs", __name__)

_LEVEL_PRIORITY = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_ENTRY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\S+): (.*)$")


def _source_paths():
    """当前会话的主/错误日志文件。"""
    return get_active_log_files()


def _all_log_files():
    """递归列出 data/logs/ 下所有日志文件（各天文件夹 + 归档 + 分片）。"""
    files = []
    root = Config.LOG_DIR
    if not root.exists():
        return files
    for p in root.rglob("*.log*"):
        try:
            st = p.stat()
        except OSError:
            continue
        files.append({
            "name": str(p.relative_to(root)).replace("\\", "/"),
            "source": "error" if "error" in p.name else "main",
            "size": st.st_size,
            "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
        })
    # 最新修改在前，方便前端默认选中当前会话
    files.sort(key=lambda f: f["modified"], reverse=True)
    return files


def _resolve_log_file(name: str):
    """把相对 data/logs/ 的文件名解析为绝对路径；仅允许 logs/ 内文件，防路径穿越。"""
    root = Config.LOG_DIR
    target = (root / name).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def _tail_lines(path: Path, n: int) -> list[str]:
    """从磁盘反向读取文件末尾最多 n 行（保证行完整，不整文件载入）。"""
    if not path.exists():
        return []
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        if size == 0:
            return []
        block = 8192
        read = min(block, size)
        f.seek(size - read)
        data = f.read(read)
        while data.count(b"\n") < n and read < size:
            read = min(read + block, size)
            f.seek(size - read)
            data = f.read(read)
    text = data.decode("utf-8", errors="replace")
    lines = [line.rstrip("\r") for line in text.split("\n")]
    # 去掉因恰好切在换行边界产生的末尾空行；Windows 下日志为 \r\n，已随上行去除 \r。
    while lines and lines[-1] == "":
        lines.pop()
    if read < size and lines:
        # 读窗不覆盖文件开头时，首行为被截断的半行，丢弃。
        lines = lines[1:]
    return lines[-n:] if n > 0 else []


def _parse_lines(raw_lines: list[str]) -> list[dict]:
    """解析文本行为结构化记录；多行异常堆栈的续行并入前一条的 message。"""
    entries = []
    for line in raw_lines:
        match = _ENTRY_RE.match(line)
        if match:
            entries.append({
                "time": match.group(1),
                "level": match.group(2),
                "logger": match.group(3),
                "message": match.group(4),
            })
        elif entries:
            entries[-1]["message"] += "\n" + line
    return entries


@log_bp.route("/api/logs", methods=["GET"])
def get_logs():
    """返回最近日志。file 指定历史文件（相对 logs/）；否则 source=main|error 读当前会话。"""
    file_param = request.args.get("file", "").strip()
    if file_param:
        path = _resolve_log_file(file_param)
        if path is None:
            return jsonify({"success": False, "error": "文件不存在"}), 404
        source = "error" if "error" in path.name else "main"
        display = file_param
    else:
        source = request.args.get("source", "main")
        paths = _source_paths()
        if source not in paths:
            return jsonify({"success": False, "error": "source 无效"}), 400
        path = paths[source]
        display = path.name

    try:
        lines = max(1, min(int(request.args.get("lines", 500)), 5000))
    except (TypeError, ValueError):
        lines = 500
    min_priority = _LEVEL_PRIORITY.get((request.args.get("level") or "").upper(), 0)

    raw = _tail_lines(path, max(lines * 2, 500))
    entries = _parse_lines(raw)
    if min_priority:
        entries = [e for e in entries if _LEVEL_PRIORITY.get(e["level"], 0) >= min_priority]
    return jsonify({
        "success": True,
        "source": source,
        "file": display,
        "lines": entries[-lines:],
    })


@log_bp.route("/api/logs/files", methods=["GET"])
def get_log_files():
    return jsonify({"success": True, "files": _all_log_files()})


@log_bp.route("/api/logs/download", methods=["GET"])
def download_log():
    """下载指定日志文件；仅允许 data/logs/ 内的文件，防路径穿越。"""
    name = request.args.get("file", "")
    target = _resolve_log_file(name)
    if target is not None:
        return send_file(target, as_attachment=True, download_name=Path(name).name)
    return jsonify({"success": False, "error": "文件不存在"}), 404

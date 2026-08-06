"""日志读取接口：尾部查看（支持级别过滤）、轮转文件列表、下载。

前端"日志"页签通过 GET /api/logs 轮询最近日志；文件按天轮转，当前内容在
Config.LOG_FILE（主）与 Config.LOG_ERROR_FILE（错误）中，旧文件为带日期的后缀。
鉴权由 server.py 的 require_auth_middleware 统一 gate，本蓝图无需额外处理。
"""

import os
import re
import time
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from .config import Config

log_bp = Blueprint("logs", __name__)

_LEVEL_PRIORITY = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_ENTRY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\S+): (.*)$")


def _source_paths():
    return {"main": Config.LOG_FILE, "error": Config.LOG_ERROR_FILE}


def _log_files():
    """列出主/错误日志及其全部按天轮转的历史文件。"""
    files = []
    for source, path in _source_paths().items():
        parent = path.parent
        for p in sorted(parent.glob(path.name + "*")):
            try:
                st = p.stat()
            except OSError:
                continue
            files.append({
                "name": p.name,
                "source": source,
                "size": st.st_size,
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            })
    files.sort(key=lambda f: f["name"])
    return files


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
    """返回最近日志；source=main|error，lines 限制返回条数，level 过滤最低级别。"""
    source = request.args.get("source", "main")
    paths = _source_paths()
    if source not in paths:
        return jsonify({"success": False, "error": "source 无效"}), 400
    try:
        lines = max(1, min(int(request.args.get("lines", 500)), 5000))
    except (TypeError, ValueError):
        lines = 500
    min_priority = _LEVEL_PRIORITY.get((request.args.get("level") or "").upper(), 0)

    raw = _tail_lines(paths[source], max(lines * 2, 500))
    entries = _parse_lines(raw)
    if min_priority:
        entries = [e for e in entries if _LEVEL_PRIORITY.get(e["level"], 0) >= min_priority]
    return jsonify({
        "success": True,
        "source": source,
        "file": paths[source].name,
        "lines": entries[-lines:],
    })


@log_bp.route("/api/logs/files", methods=["GET"])
def get_log_files():
    return jsonify({"success": True, "files": _log_files()})


@log_bp.route("/api/logs/download", methods=["GET"])
def download_log():
    """下载指定日志文件；文件名必须命中日志目录内 glob 白名单，防路径穿越。"""
    name = request.args.get("file", "")
    target = Path(Config.LOG_FILE).parent / name
    if name in {f["name"] for f in _log_files()} and target.is_file():
        return send_file(target, as_attachment=True, download_name=name)
    return jsonify({"success": False, "error": "文件不存在"}), 404

"""
日志系统：日志记录异步化（QueueHandler + QueueListener）。

相机 worker 每帧会记录日志；把磁盘/控制台写出放到后台监听线程，使
`logger.info()` 只做一次入队（微秒级），避免任何 I/O 出现在采集/推理的
热路径上。监听线程为 daemon，进程退出时可能丢弃队尾少量记录（可接受）。

存储结构（data/logs/）：
- 按天分文件夹：logs/<YYYY-MM-DD>/
- 每次启动一个文件：vision_system_<启动时间戳>.log（主日志，全级别）
  与 vision_system_error_<启动时间戳>.log（错误日志，ERROR+）
- 单个会话文件超过 10MB 自动分片（.log.1/.log.2），彻底避免单文件过大。
- 改造前的旧日志（data 根目录 vision_system.log）启动时自动迁入 logs/ 归档。
"""

import logging
import logging.handlers
import queue
import sys
import time
from pathlib import Path

from .config import Config

# 本次进程启动时间戳，用于会话日志文件名（进程启动即确定，跨零点也保持）。
_started = time.strftime("%Y%m%d_%H%M%S")
_active_log_file = None
_active_log_error_file = None


def _session_log_paths():
    """返回本次会话的主/错误日志路径；首次调用创建当天目录并缓存。"""
    global _active_log_file, _active_log_error_file
    if _active_log_file is not None:
        return _active_log_file, _active_log_error_file
    day_dir = Config.LOG_DIR / time.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    _active_log_file = day_dir / f"vision_system_{_started}.log"
    _active_log_error_file = day_dir / f"vision_system_error_{_started}.log"
    return _active_log_file, _active_log_error_file


def get_active_log_files():
    """当前会话日志文件路径快照，供日志读取接口使用。"""
    main_file, error_file = _session_log_paths()
    return {"main": main_file, "error": error_file}


def _migrate_legacy_logs():
    """把改造前写在 data 根目录的旧日志挪进 logs/ 归档，保持目录结构统一。"""
    try:
        Config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        for old in (Config.LOG_FILE, Config.LOG_ERROR_FILE):
            if old.is_file():
                dest = Config.LOG_DIR / f"legacy_{old.name}"
                if dest.exists():
                    dest = Config.LOG_DIR / f"legacy_{old.stem}_{_started}{old.suffix}"
                old.rename(dest)
    except OSError as exc:
        logger.warning(f"迁移旧日志文件失败: {exc}")


def setup_logger(name='vision_system'):
    """配置日志系统"""
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    # 日志格式
    formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # 热路径只做入队；真正的写盘/控制台输出由监听线程异步执行。
    # 注意：QueueHandler 不要设 formatter，否则入队时格式化的消息会被
    # 监听线程的 handler 再次格式化（双重前缀）。
    log_queue = queue.Queue(-1)
    queue_handler = logging.handlers.QueueHandler(log_queue)
    logger.addHandler(queue_handler)

    handlers = []
    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    # 文件输出：按天分文件夹 + 每次启动一个文件，单文件超 10MB 自动分片。
    try:
        Config.ensure_directories()
        _migrate_legacy_logs()
        main_file, error_file = _session_log_paths()
        main_handler = logging.handlers.RotatingFileHandler(
            main_file, maxBytes=10 * 1024 * 1024, backupCount=2, encoding="utf-8"
        )
        main_handler.setLevel(logging.DEBUG)
        main_handler.setFormatter(formatter)
        handlers.append(main_handler)

        error_handler = logging.handlers.RotatingFileHandler(
            error_file, maxBytes=10 * 1024 * 1024, backupCount=2, encoding="utf-8"
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(formatter)
        handlers.append(error_handler)
    except Exception as e:
        logger.warning(f"无法创建日志文件: {e}")

    listener = logging.handlers.QueueListener(
        log_queue, *handlers, respect_handler_level=True
    )
    listener.start()
    # 持有引用，避免监听线程被 GC 回收后日志丢失
    logger._queue_listener = listener
    return logger


# 全局 logger
logger = setup_logger()

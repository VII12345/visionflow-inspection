"""
日志系统：日志记录异步化（QueueHandler + QueueListener）。

相机 worker 每帧会记录日志；把磁盘/控制台写出放到后台监听线程，使
`logger.info()` 只做一次入队（微秒级），避免任何 I/O 出现在采集/推理的
热路径上。监听线程为 daemon，进程退出时可能丢弃队尾少量记录（可接受）。
"""
import logging
import logging.handlers
import queue
import sys

from .config import Config


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

    # 文件输出：主日志 + 独立错误日志，均按天轮转且保留全部历史（backupCount=0）。
    # 主日志保留所有级别（含错误），错误日志是 WARNING/ERROR 的独立副本，便于现场排障。
    try:
        Config.ensure_directories()
        main_handler = logging.handlers.TimedRotatingFileHandler(
            Config.LOG_FILE, when="midnight", backupCount=0, encoding="utf-8"
        )
        main_handler.setLevel(logging.DEBUG)
        main_handler.setFormatter(formatter)
        handlers.append(main_handler)

        error_handler = logging.handlers.TimedRotatingFileHandler(
            Config.LOG_ERROR_FILE, when="midnight", backupCount=0, encoding="utf-8"
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

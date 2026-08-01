"""照片异步存盘队列与 worker 线程。"""

import queue
import threading
import time

from .logger import logger
from .runtime_state import runtime


def _unpack_save_item(item):
    if len(item) >= 4:
        return item[0], item[1], item[2], item[3]
    return item[0], item[1], None, None


def _write_save_item(item):
    frame, target, done_event, completion = _unpack_save_item(item)
    write_start = time.perf_counter()
    error = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        frame.save(target, "BMP")
        logger.debug(f"异步存盘完成: {target.name}")
    except Exception as exc:
        error = exc
        logger.error(f"异步存盘失败: {exc}")
    finally:
        if completion is not None:
            completion["write_ms"] = (time.perf_counter() - write_start) * 1000
            completion["error"] = str(error) if error else None
        if done_event is not None:
            done_event.set()
    return error


def _save_worker():
    logger.info("异步存盘 worker 启动")
    runtime._save_queue_running = True
    while runtime._save_queue_running:
        try:
            item = runtime._save_queue.get(timeout=1)
            if item is None:
                break
            _write_save_item(item)
        except queue.Empty:
            continue
        except Exception as exc:
            logger.error(f"异步存盘 worker 错误: {exc}")
    while not runtime._save_queue.empty():
        try:
            item = runtime._save_queue.get_nowait()
            if item is not None:
                _write_save_item(item)
        except Exception:
            pass
    logger.info("异步存盘 worker 停止")


def submit_save(frame, target, done_event=None, completion=None):
    """提交存盘任务；测试可传 event 等待写盘完成。"""
    try:
        item = (
            (frame, target)
            if done_event is None and completion is None
            else (frame, target, done_event, completion if completion is not None else {})
        )
        runtime._save_queue.put(item, timeout=0.05)
        return True
    except queue.Full:
        logger.warning(f"存盘队列已满，丢弃: {target.name}")
        if done_event is not None:
            done_event.set()
        return False


def start_save_worker():
    if runtime._save_queue_running:
        return
    threading.Thread(target=_save_worker, daemon=True).start()


def stop_save_worker():
    runtime._save_queue_running = False
    try:
        runtime._save_queue.put(None, timeout=0.1)
    except queue.Full:
        pass

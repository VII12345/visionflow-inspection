"""模型批量测试 API。"""

import json
import queue
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from . import inference_worker, model_loader
from .capture_service import submit_save
from .config import Config
from .logger import logger
from .model_repository import resolve_model_path
from .runtime_state import runtime


model_test_bp = Blueprint("model_test", __name__)


# ========== 模型测试 API ==========


@model_test_bp.route("/api/test", methods=["POST"])
def test_model():
    """使用真实 inference_queue、推理 Worker 和异步存盘队列执行测试。"""
    import tempfile
    from PIL import Image
    from .inference_worker import get_inference_result, submit_inference
    from .model_loader import set_camera_product

    IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    STEP_LABELS = {
        "inference_submit_ms": "提交推理队列",
        "inference_queue_wait_ms": "推理队列等待",
        "inference_batch_window_ms": "推理批窗口",
        "model_prepare_ms": "Worker 获取模型",
        "preprocess_ms": "图像预处理",
        "model_call_ms": "调用模型",
        "recognition_ms": "识别/置信度计算",
        "inference_result_wait_ms": "等待推理结果",
        "inference_result_handoff_ms": "推理结果交接",
        "result_output_ms": "输出结果",
        "frame_copy_ms": "帧复制",
        "save_submit_ms": "提交保存队列",
        "save_queue_wait_ms": "保存队列等待",
        "save_queue_wait_excluding_write_ms": "写盘前队列等待",
        "image_save_ms": "实际写盘",
        "detection_pipeline_ms": "检测主流程",
        "pipeline_ms": "单张完整流程",
    }

    def timing_stats(values):
        if not values:
            return {"avg_ms": 0.0, "min_ms": 0.0, "max_ms": 0.0, "total_ms": 0.0}
        return {
            "avg_ms": round(sum(values) / len(values), 2),
            "min_ms": round(min(values), 2),
            "max_ms": round(max(values), 2),
            "total_ms": round(sum(values), 2),
        }

    try:
        data = request.get_json(force=True) or {}
        model_name = (data.get("model_name") or "").strip()
        mode = data.get("mode", "labeled")
        if not model_name:
            return jsonify({"success": False, "message": "请指定模型名称"}), 400
        if mode not in ("labeled", "unlabeled"):
            return jsonify({"success": False, "message": "无效的测试模式"}), 400
        model_categories = ["类别1", "类别2"]
        model_path = resolve_model_path(model_name)
        if model_path is None:
            return jsonify({"success": False, "message": "模型不存在"}), 404
        if model_path is not None:
            metadata_path = model_path.with_suffix(".json")
            try:
                if metadata_path.exists():
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                    if isinstance(metadata.get("categories"), list) and metadata["categories"]:
                        model_categories = [str(item) for item in metadata["categories"]]
            except Exception:
                pass
        if runtime.system_running:
            return jsonify({"success": False, "message": "系统运行中不能执行离线测试，请先停止实际检测"}), 409

        # 使用 Cam1 的真实 result_queue 作为测试通道；系统未运行时不会与真实相机竞争。
        test_cam_id = 1
        old_mapping_exists = model_loader.has_camera_product(test_cam_id)
        old_mapping = model_loader.get_camera_product(test_cam_id)
        result_queue = inference_worker.result_queues[test_cam_id]
        while True:
            try:
                result_queue.get_nowait()
            except queue.Empty:
                break

        step_values = {key: [] for key in STEP_LABELS}
        set_camera_product(test_cam_id, model_name)

        sources = []
        if mode == "labeled":
            category_root = (data.get("category_root_path") or "").strip()
            if category_root:
                root = Path(category_root)
                if not root.is_dir():
                    return jsonify({"success": False, "message": "类别根目录不存在"}), 400
                for category_dir in sorted(root.iterdir(), key=lambda item: item.name):
                    if not category_dir.is_dir():
                        continue
                    sources.extend((path, category_dir.name) for path in sorted(category_dir.iterdir()) if path.suffix.lower() in IMG_EXTS)
            else:
                class_a_path = (data.get("class_a_path") or "").strip()
                class_b_path = (data.get("class_b_path") or "").strip()
                if not class_a_path and not class_b_path:
                    return jsonify({"success": False, "message": "请指定类别根目录"}), 400
                for expected, folder_value in zip(model_categories[:2], (class_a_path, class_b_path)):
                    if not folder_value:
                        continue
                    folder = Path(folder_value)
                    if not folder.is_dir():
                        continue
                    sources.extend((path, expected) for path in sorted(folder.iterdir()) if path.suffix.lower() in IMG_EXTS)
        else:
            folder_value = (data.get("folder_path") or "").strip()
            if not folder_value:
                return jsonify({"success": False, "message": "请指定测试图片目录"}), 400
            folder = Path(folder_value)
            if not folder.is_dir():
                return jsonify({"success": False, "message": "目录不存在"}), 400
            sources = [(path, None) for path in sorted(folder.iterdir()) if path.suffix.lower() in IMG_EXTS]
        # 模型路由和文件枚举属于测试启动准备，不计入图片处理耗时。
        pipeline_start = time.perf_counter()
        results = []
        counts = {"total": 0, "correct": 0}
        category_counts = {name: {"total": 0, "correct": 0} for name in model_categories}

        try:
            with tempfile.TemporaryDirectory(prefix="vision_test_captures_", dir=str(Config.DATA_DIR)) as temp_dir:
                save_root = Path(temp_dir) / "captures"
                for image_path, expected in sources:
                    image = None
                    try:
                        # 与实际相机帧进入 worker 前一致：读取并转换为 RGB 图像对象。读取本身不计入测试耗时。
                        with Image.open(image_path) as source_image:
                            image = source_image.convert("RGB")
                        image_start = time.perf_counter()

                        # 与实际运行完全相同：提交 inference_queue，由推理 Worker 处理。
                        t0 = time.perf_counter()
                        submitted = submit_inference(test_cam_id, image, timed=True)
                        step_values["inference_submit_ms"].append((time.perf_counter() - t0) * 1000)
                        if not submitted:
                            raise RuntimeError("推理队列已满")

                        t0 = time.perf_counter()
                        inference_result = get_inference_result(test_cam_id, timeout=30.0)
                        step_values["inference_result_wait_ms"].append((time.perf_counter() - t0) * 1000)
                        if not inference_result:
                            raise RuntimeError("等待推理结果超时")

                        worker_timing = inference_result.get("timing", {})
                        worker_timing_keys = (
                            "inference_queue_wait_ms",
                            "inference_batch_window_ms",
                            "model_prepare_ms",
                            "preprocess_ms",
                            "model_call_ms",
                            "recognition_ms",
                        )
                        for key in worker_timing_keys:
                            if key in worker_timing:
                                step_values[key].append(float(worker_timing[key]))
                        inference_wait_ms = step_values["inference_result_wait_ms"][-1]
                        worker_timing_total = sum(float(worker_timing.get(key, 0.0)) for key in worker_timing_keys)
                        # “等待推理结果”是提交线程看到的完整墙钟时间，Worker 子项之外还包含
                        # 结果入队、线程唤醒和跨线程交接；把这段剩余时间单独列出，避免父子重复相加。
                        step_values["inference_result_handoff_ms"].append(
                            max(0.0, inference_wait_ms - worker_timing_total)
                        )

                        # 模拟实际 Worker 结果交回相机线程后的输出/统计更新。
                        t0 = time.perf_counter()
                        predicted = inference_result["label"]
                        confidence = float(inference_result["confidence"])
                        is_correct = expected is not None and predicted == expected
                        counts["total"] += 1
                        if expected is not None:
                            if is_correct:
                                counts["correct"] += 1
                            bucket = category_counts.setdefault(expected, {"total": 0, "correct": 0})
                            bucket["total"] += 1
                            if is_correct:
                                bucket["correct"] += 1
                        result = {"filename": image_path.name, "predicted": predicted, "confidence": round(confidence, 4)}
                        if expected is not None:
                            result.update({"expected": expected, "correct": is_correct})
                        step_values["result_output_ms"].append((time.perf_counter() - t0) * 1000)

                        # 模拟实际 _submit_save：先异步入队，再等待同一个异步 Worker 写盘完成。
                        t0 = time.perf_counter()
                        save_copy = image.copy()
                        step_values["frame_copy_ms"].append((time.perf_counter() - t0) * 1000)
                        save_subdir = predicted or "未分类"
                        save_path = save_root / save_subdir / f"{image_path.stem}.bmp"
                        done_event = threading.Event()
                        completion = {}
                        t0 = time.perf_counter()
                        save_submitted = submit_save(save_copy, save_path, done_event, completion)
                        step_values["save_submit_ms"].append((time.perf_counter() - t0) * 1000)
                        if not save_submitted:
                            save_copy.close()
                            raise RuntimeError("保存队列已满")
                        save_wait_start = time.perf_counter()
                        if not done_event.wait(timeout=30.0):
                            raise RuntimeError("等待异步保存完成超时")
                        save_queue_wait_ms = (time.perf_counter() - save_wait_start) * 1000
                        step_values["save_queue_wait_ms"].append(save_queue_wait_ms)
                        if completion.get("error"):
                            raise RuntimeError(f"图片保存失败: {completion['error']}")
                        image_save_ms = float(completion.get("write_ms", 0.0))
                        step_values["image_save_ms"].append(image_save_ms)
                        # 保存队列等待已经覆盖从入队到写盘完成的墙钟时间，实际写盘是其中的子区间。
                        # 拆出写盘前等待后，保存阶段的子项可以无重叠地相加。
                        step_values["save_queue_wait_excluding_write_ms"].append(
                            max(0.0, save_queue_wait_ms - image_save_ms)
                        )

                        detection_end = time.perf_counter()
                        result["timing"] = {
                            key: round(float(value), 2)
                            for key, value in {
                                **worker_timing,
                                "inference_submit_ms": step_values["inference_submit_ms"][-1],
                                "inference_result_wait_ms": step_values["inference_result_wait_ms"][-1],
                                "inference_result_handoff_ms": step_values["inference_result_handoff_ms"][-1],
                                "result_output_ms": step_values["result_output_ms"][-1],
                                "frame_copy_ms": step_values["frame_copy_ms"][-1],
                                "save_submit_ms": step_values["save_submit_ms"][-1],
                                "save_queue_wait_ms": step_values["save_queue_wait_ms"][-1],
                                "save_queue_wait_excluding_write_ms": step_values["save_queue_wait_excluding_write_ms"][-1],
                                "image_save_ms": step_values["image_save_ms"][-1],
                            }.items()
                        }
                        result["timing"]["detection_pipeline_ms"] = round((detection_end - image_start) * 1000 - step_values["save_queue_wait_ms"][-1] - step_values["image_save_ms"][-1], 2)
                        result["time_ms"] = round((time.perf_counter() - image_start) * 1000, 2)
                        step_values["detection_pipeline_ms"].append(result["timing"]["detection_pipeline_ms"])
                        step_values["pipeline_ms"].append(result["time_ms"])
                        results.append(result)
                    except Exception as exc:
                        logger.warning(f"测试图片处理失败 {image_path}: {exc}")
                    finally:
                        if image is not None:
                            image.close()
        finally:
            if old_mapping_exists:
                model_loader.set_camera_product(test_cam_id, old_mapping)
            else:
                model_loader.remove_camera_product(test_cam_id)

        timing = {
            **timing_stats(step_values["pipeline_ms"]),
            "pipeline_total_ms": round((time.perf_counter() - pipeline_start) * 1000, 2),
            "steps": {key: timing_stats(values) for key, values in step_values.items() if values},
            "step_labels": STEP_LABELS,
        }
        total = counts["total"]
        response = {"success": True, "mode": mode, "model_name": model_name, "total": total, "timing": timing, "results": results}
        if mode == "labeled":
            response.update({
                "correct": counts["correct"],
                "accuracy": round(counts["correct"] / total, 4) if total else 0,
                "category_counts": {
                    name: {
                        "total": bucket["total"],
                        "correct": bucket["correct"],
                        "accuracy": round(bucket["correct"] / bucket["total"], 4) if bucket["total"] else None,
                    }
                    for name, bucket in category_counts.items()
                },
                "categories": model_categories,
            })
        return jsonify(response)
    except Exception as e:
        logger.error(f"模型测试失败: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500

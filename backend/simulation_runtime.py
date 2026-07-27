"""独立的接口模拟运行服务。

该模块不读写真实相机运行状态，只有推理引擎和 PLC/存盘回调可以按需要注入。
"""

import time
from pathlib import Path


class SimulationRuntime:
    def __init__(self):
        self.running = False
        self.states = {}
        self.frames = {}
        self.outputs = {}
        self.stats = {}

    def _ensure_slot(self, cam_id):
        self.states.setdefault(cam_id, {
            "state": "ready",
            "lastFrameTime": None,
            "totalTriggers": 0,
            "fps": 0,
            "error": None,
            "source": "simulated",
        })
        self.stats.setdefault(cam_id, {"detected": 0, "defective": 0})

    def start(self, count):
        self.running = True
        for cam_id in range(1, count + 1):
            self._ensure_slot(cam_id)
            self.states[cam_id]["state"] = "running"
            self.states[cam_id]["error"] = None
        return self.status(count)

    def stop(self, count):
        self.running = False
        for cam_id in range(1, count + 1):
            self._ensure_slot(cam_id)
            self.states[cam_id]["state"] = "ready"
        return self.status(count)

    def status(self, count):
        cameras = {}
        for cam_id in range(1, count + 1):
            self._ensure_slot(cam_id)
            state = self.states[cam_id]
            item = {
                "state": state["state"] if self.running else "ready",
                "serial": None,
                "model": None,
                "triggerMode": "interface",
                "fps": state["fps"],
                "totalTriggers": state["totalTriggers"],
                "lastFrameTime": state["lastFrameTime"],
                "stats": self.stats[cam_id],
                "error": state["error"],
                "source": "simulated",
            }
            if cam_id in self.outputs:
                item["result"] = self.outputs[cam_id]
            cameras[str(cam_id)] = item
        return {
            "cameras": cameras,
            "system": {"running": self.running, "modelLoaded": False},
            "source": "simulated",
        }

    def get_output(self, cam_id=None):
        if cam_id is not None:
            return self.outputs.get(cam_id)
        if not self.outputs:
            return None
        return self.outputs[max(self.outputs, key=lambda key: self.outputs[key].get("received_at_perf", 0))]

    def get_frame(self, cam_id):
        return self.frames.get(cam_id)

    def process(self, cam_id, frame, frame_count=None, *, timing_enabled=False, wait_for_save=False, received_perf=None, model_name=None, config=None, inference_worker=None, submit_inference=None, get_inference_result=None, get_reject_labels=None, get_plc_config=None, plc_service=None, plc_error_type=None, save_settings=None, submit_save=None, logger=None):
        if not self.running:
            return {"success": False, "error": "模拟运行尚未启动，请先点击启动按钮"}
        self._ensure_slot(cam_id)
        state = self.states[cam_id]
        frame_count = frame_count or int(state.get("totalTriggers") or 0) + 1
        received_perf = received_perf or time.perf_counter()
        pipeline_start = received_perf
        timing_values = {}
        result = None
        submitted = False
        self.frames[cam_id] = frame
        state["state"] = "running"
        state["error"] = None

        active_model_name = model_name or inference_worker.camera_product_map.get(cam_id)

        if inference_worker.model_loaded:
            submit_start = time.perf_counter()
            submitted = submit_inference(cam_id, frame, timed=timing_enabled)
            if timing_enabled:
                timing_values["inference_submit_ms"] = (time.perf_counter() - submit_start) * 1000
        else:
            logger.warning("模拟运行：模型未就绪，无法推理")

        if submitted:
            wait_start = time.perf_counter()
            result = get_inference_result(cam_id, timeout=5.0)
            if timing_enabled:
                timing_values["inference_result_wait_ms"] = (time.perf_counter() - wait_start) * 1000
            if not result:
                state["error"] = "推理超时"
                return {"success": False, "error": "推理超时", "submitted": submitted, "timing": timing_values}

            self.stats[cam_id]["detected"] += 1
            reject_labels = get_reject_labels(active_model_name)
            should_reject = result["label"] in reject_labels
            if should_reject:
                self.stats[cam_id]["defective"] += 1
            plc_config = get_plc_config()
            if plc_config.get("enabled", True) and should_reject:
                try:
                    plc_service.with_base_url(plc_config.get("base_url", plc_service.base_url)).write_reject_signal(cam_id)
                except (plc_error_type, ValueError) as exc:
                    logger.error(f"模拟运行：结果写入 PLC 失败: {exc}")
        else:
            self.stats[cam_id]["detected"] += 1

        if timing_enabled:
            output_start = time.perf_counter()
            timing_values["result_output_ms"] = (time.perf_counter() - output_start) * 1000

        try:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            millis = int((time.time() * 1000) % 1000)
            if submitted and result:
                tag = result["label"]
                reject_labels = get_reject_labels(active_model_name)
                setting_key = "saveBad" if tag in reject_labels else "saveGood"
                should_save = (save_settings or {}).get(cam_id, {}).get(setting_key, True)
            else:
                tag = "未分类"
                should_save = True
            if should_save:
                filename = f"SIM_CAM{cam_id}_{timestamp}_{millis:03d}.bmp"
                save_path = config.CAPTURE_DIR / "simulation" / f"cam{cam_id}" / tag / filename
                if timing_enabled and wait_for_save:
                    done_event = __import__("threading").Event()
                    completion = {}
                    copy_start = time.perf_counter()
                    save_copy = frame.copy()
                    timing_values["frame_copy_ms"] = (time.perf_counter() - copy_start) * 1000
                    submit_save_start = time.perf_counter()
                    submitted_save = submit_save(save_copy, save_path, done_event, completion)
                    timing_values["save_submit_ms"] = (time.perf_counter() - submit_save_start) * 1000
                    if not submitted_save:
                        return {"success": False, "error": "保存队列已满", "submitted": submitted, "timing": timing_values}
                    wait_save_start = time.perf_counter()
                    if not done_event.wait(timeout=30.0):
                        return {"success": False, "error": "等待图片保存完成超时", "submitted": submitted, "timing": timing_values}
                    save_wait_ms = (time.perf_counter() - wait_save_start) * 1000
                    timing_values["save_queue_wait_ms"] = save_wait_ms
                    timing_values["image_save_ms"] = float(completion.get("write_ms", 0.0))
                    timing_values["save_queue_wait_excluding_write_ms"] = max(0.0, save_wait_ms - timing_values["image_save_ms"])
                elif submit_save:
                    submit_save(frame.copy(), save_path)
        except Exception as exc:
            logger.error(f"模拟运行：提交存盘失败: {exc}")

        state["lastFrameTime"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        state["totalTriggers"] = frame_count
        timing_values["detection_pipeline_ms"] = max(0.0, (time.perf_counter() - pipeline_start) * 1000 - timing_values.get("save_queue_wait_ms", 0.0) - timing_values.get("image_save_ms", 0.0))
        timing_values["pipeline_ms"] = (time.perf_counter() - pipeline_start) * 1000
        if result is not None and timing_enabled:
            result = {**result, "time_ms": round(timing_values["pipeline_ms"], 2), "timing": {key: round(value, 2) for key, value in timing_values.items()}}
        output = {
            "camera_id": cam_id,
            "frame_count": frame_count,
            "label": result.get("label") if result else "未分类",
            "confidence": result.get("confidence", 0) if result else 0,
            "time_ms": result.get("time_ms") if result else round(timing_values["pipeline_ms"], 2),
            "received_at": state["lastFrameTime"],
            "received_at_perf": time.perf_counter(),
            "source": "simulated",
        }
        self.outputs[cam_id] = output
        return {"success": True, "source": "simulated", "result": result, "simulation_output": output, "submitted": submitted, "timing": timing_values, "frame_count": frame_count}

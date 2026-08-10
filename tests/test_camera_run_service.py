"""相机运行服务（camera_run_service）的单元测试：检测耗时日志格式化与剔除判定。"""

import unittest
from unittest import mock

from backend.camera_run_service import _format_timing


class FormatTimingTest(unittest.TestCase):
    def test_full_single_frame_timing(self):
        text = _format_timing({
            "inference_queue_wait_ms": 1.2,
            "inference_batch_window_ms": 5.1,
            "model_prepare_ms": 3.0,
            "preprocess_ms": 8.4,
            "model_call_ms": 12.3,
            "recognition_ms": 1.4,
        }, total_ms=50.0, round_trip_ms=42.3)
        self.assertIn("总 50ms", text)
        self.assertIn("往返 42ms", text)
        for label in ("队列 1ms", "批窗 5ms", "准备 3ms", "预处理 8ms", "模型 12ms", "后处理 1ms"):
            self.assertIn(label, text)

    def test_batch_timing_keeps_only_common_fields(self):
        text = _format_timing({
            "inference_queue_wait_ms": 0.8,
            "inference_batch_window_ms": 4.9,
            "model_prepare_ms": 2.6,
        }, total_ms=40.0, round_trip_ms=33.1)
        self.assertIn("总 40ms", text)
        self.assertIn("往返 33ms", text)
        self.assertIn("队列 1ms", text)
        self.assertIn("批窗 5ms", text)
        self.assertIn("准备 3ms", text)
        # 批量合并时无预处理/模型/后处理细分
        self.assertNotIn("预处理", text)
        self.assertNotIn("后处理", text)

    def test_empty_timing_only_total_and_round_trip(self):
        text = _format_timing({}, total_ms=100.0, round_trip_ms=99.9)
        self.assertEqual(text, " [总 100ms | 往返 100ms]")


class FakeCam:
    """模拟一台相机：grab_frame 返回一帧后置 running=False 让 worker 退出循环。"""

    running = True
    trigger_timeout = 30000

    def grab_frame(self, timeout_ms=None):
        self.running = False
        return bytearray(b"frame")

    def stop_grabbing(self):
        pass

    def disconnect(self):
        pass


class CameraWorkerRejectTest(unittest.TestCase):
    """camera_worker 单帧流程：结果应附带按模型剔除类别判定的 reject 标志。"""

    CAM_ID = 1

    def setUp(self):
        from backend.camera_run_service import runtime
        from backend.camera_run_service import model_loader

        runtime.cameras[self.CAM_ID] = FakeCam()
        runtime.system_running = True
        runtime.latest_results.pop(self.CAM_ID, None)
        runtime.stats[self.CAM_ID] = {"detected": 0, "defective": 0}
        runtime.save_settings = {}
        runtime.save_only_reject = False

        self._loaded = model_loader.model_loaded
        model_loader.model_loaded = True
        self._runner = mock.patch.object(model_loader, "get_camera_product", return_value="TEST-PROD-A")
        self._runner.start()

    def tearDown(self):
        from backend.camera_run_service import runtime
        from backend.camera_run_service import model_loader

        runtime.system_running = False
        runtime.cameras.pop(self.CAM_ID, None)
        runtime.latest_results.pop(self.CAM_ID, None)
        model_loader.model_loaded = self._loaded
        self._runner.stop()

    def _run_worker(self, label, reject_labels):
        import backend.camera_run_service as crs

        with mock.patch.object(crs, "submit_inference", return_value=True), \
             mock.patch.object(crs, "get_inference_result", return_value={"label": label, "confidence": 0.9}), \
             mock.patch.object(crs, "get_plc_config", return_value={"enabled": False}), \
             mock.patch.object(crs, "_get_model_reject_labels", return_value=reject_labels), \
             mock.patch.object(crs, "submit_save"):
            crs.camera_worker(self.CAM_ID)

    def test_reject_label_sets_flag(self):
        self._run_worker("类别1", ["类别1"])
        from backend.camera_run_service import runtime
        result = runtime.latest_results[self.CAM_ID]
        self.assertIs(result["reject"], True)
        self.assertEqual(runtime.stats[self.CAM_ID]["defective"], 1)

    def test_pass_label_clears_flag(self):
        self._run_worker("类别2", ["类别1"])
        from backend.camera_run_service import runtime
        result = runtime.latest_results[self.CAM_ID]
        self.assertIs(result["reject"], False)
        self.assertEqual(runtime.stats[self.CAM_ID]["defective"], 0)


if __name__ == "__main__":
    unittest.main()

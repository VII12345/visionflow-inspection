"""相机运行服务（camera_run_service）的单元测试：检测耗时日志格式化。"""

import unittest

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


if __name__ == "__main__":
    unittest.main()

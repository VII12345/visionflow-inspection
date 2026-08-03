"""推理队列与结果队列的回归测试。

重点覆盖 B1：线体数量可在运行时调整到 1-16，而结果队列在模块导入时只按
默认 CAMERA_COUNT(4) 建立。访问第 5+ 路相机的结果队列时不得抛 KeyError。
"""

import unittest

from backend import inference_worker
from backend.config import Config


class InferenceWorkerResultQueueTest(unittest.TestCase):
    def test_get_result_beyond_default_count_returns_none(self):
        """默认 4 路之外的第 5 路相机读取结果队列，应正常返回 None 而非 KeyError。"""
        cam_id = Config.CAMERA_COUNT + 1
        existing = inference_worker.result_queues.get(cam_id)
        if existing is not None:
            while not existing.empty():
                existing.get_nowait()
        result = inference_worker.get_inference_result(cam_id, timeout=0.05)
        self.assertIsNone(result)

    def test_worker_put_beyond_default_count_creates_queue(self):
        """worker 向第 5 路写入结果时，setdefault 惰性创建队列并成功入队。"""
        cam_id = Config.CAMERA_COUNT + 1
        inference_worker.result_queues.setdefault(cam_id, __import__("queue").Queue()).put({"label": "类别1"})
        result = inference_worker.get_inference_result(cam_id, timeout=0.05)
        self.assertEqual(result["label"], "类别1")


if __name__ == "__main__":
    unittest.main()

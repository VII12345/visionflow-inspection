import unittest
from unittest.mock import patch

import backend.mvs_camera_manager as manager_module
from backend.mvs_camera_manager import MVSCameraManager


class _FakeCamera:
    def __init__(self):
        self.disconnected = False

    def disconnect(self):
        self.disconnected = True


class MvsCameraManagerTests(unittest.TestCase):
    def test_initialize_reports_missing_sdk(self):
        manager = MVSCameraManager()
        with patch.object(manager_module, "MvCamera", None):
            with self.assertRaisesRegex(RuntimeError, "MVS SDK 未加载"):
                manager.initialize()

    def test_remove_camera_disconnects_and_forgets_instance(self):
        manager = MVSCameraManager()
        camera = _FakeCamera()
        manager.cameras[1] = camera

        manager.remove_camera(1)

        self.assertTrue(camera.disconnected)
        self.assertNotIn(1, manager.cameras)

    def test_get_camera_returns_registered_instance(self):
        manager = MVSCameraManager()
        camera = _FakeCamera()
        manager.cameras[2] = camera

        self.assertIs(manager.get_camera(2), camera)
        self.assertIsNone(manager.get_camera(9))


if __name__ == "__main__":
    unittest.main()

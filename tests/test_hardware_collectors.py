import platform
import sys
import unittest
from unittest.mock import patch

from backend.hardware_collectors import (
    collect_cpu_info,
    collect_disk_info,
    collect_gpu_info,
    collect_memory_info,
    collect_network_info,
    collect_system_info,
)


class HardwareCollectorsTests(unittest.TestCase):
    def test_system_info_has_expected_keys(self):
        info = collect_system_info()
        for key in ("os", "os_version", "os_release", "hostname", "python_version"):
            self.assertIn(key, info)

    def test_cpu_info_structure(self):
        info = collect_cpu_info(platform.system())
        self.assertIn("model", info)
        self.assertIn("physical_cores", info)
        self.assertIn("logical_cores", info)
        self.assertIn("arch", info)

    def test_cpu_info_falls_back_without_psutil(self):
        with patch.dict(sys.modules, {"psutil": None}):
            info = collect_cpu_info("Windows")
        self.assertIsNone(info["physical_cores"])
        self.assertIn("cores", info)
        self.assertIn("arch", info)

    def test_memory_info_structure(self):
        info = collect_memory_info(platform.system())
        self.assertIn("total_gb", info)
        self.assertIn("speed_mhz", info)

    def test_disk_info_has_project_drive(self):
        info = collect_disk_info()
        self.assertIn("total_gb", info)
        self.assertIn("free_gb", info)
        self.assertTrue(info["project_drive"])

    def test_network_info_is_list(self):
        info = collect_network_info(platform.system())
        self.assertIsInstance(info, list)

    def test_gpu_info_has_expected_keys(self):
        info = collect_gpu_info()
        for key in ("name", "memory_total_mb", "cuda_available", "cuda_version", "count", "compute_capability"):
            self.assertIn(key, info)


if __name__ == "__main__":
    unittest.main()

import unittest

from backend.hardware_checks import evaluate_hardware_checks


def make_info(cpu=8, mem_total=16.0, mem_avail=4.0, cuda=False, gpu_mem=0, cuda_version=None, disk_free=20.0, network=None):
    return {
        "cpu": {"physical_cores": cpu, "logical_cores": cpu},
        "memory": {"total_gb": mem_total, "available_gb": mem_avail},
        "gpu": {
            "cuda_available": cuda,
            "memory_total_mb": gpu_mem,
            "cuda_version": cuda_version,
            "name": "RTX 4090" if cuda else None,
        },
        "disk": {"free_gb": disk_free},
        "network": network or [],
    }


class HardwareChecksTests(unittest.TestCase):
    def test_all_pass_on_adequate_hardware(self):
        checks = evaluate_hardware_checks(
            make_info(cuda=True, gpu_mem=8192, cuda_version="12.1", network=[{"name": "eth0", "type": "以太网", "up": True, "speed_mbps": 1000}])
        )
        self.assertTrue(checks["_all_pass"])
        self.assertTrue(checks["cpu_cores"]["pass"])
        self.assertTrue(checks["memory_total"]["pass"])
        self.assertTrue(checks["disk_free"]["pass"])
        self.assertTrue(checks["network_speed"]["pass"])

    def test_low_cpu_and_disk_fail(self):
        checks = evaluate_hardware_checks(make_info(cpu=2, disk_free=5))
        self.assertFalse(checks["cpu_cores"]["pass"])
        self.assertFalse(checks["disk_free"]["pass"])
        self.assertFalse(checks["_all_pass"])

    def test_missing_network_fails(self):
        checks = evaluate_hardware_checks(make_info(network=[]))
        self.assertFalse(checks["network_speed"]["pass"])
        self.assertIn("未检测到", checks["network_speed"]["detail"])

    def test_gpu_vram_and_cuda_version_checks(self):
        checks = evaluate_hardware_checks(
            make_info(cuda=True, gpu_mem=8192, cuda_version="12.1")
        )
        self.assertTrue(checks["gpu_cuda"]["pass"])
        self.assertTrue(checks["gpu_vram"]["pass"])
        self.assertTrue(checks["cuda_version"]["pass"])

    def test_old_cuda_version_fails(self):
        checks = evaluate_hardware_checks(
            make_info(cuda=True, gpu_mem=8192, cuda_version="10.2")
        )
        self.assertFalse(checks["cuda_version"]["pass"])


if __name__ == "__main__":
    unittest.main()

"""GPU 硬件信息采集。"""


def collect_gpu_info():
    """采集 CUDA GPU 名称、显存和算力。"""
    import torch

    gpu = {
        "name": None,
        "memory_total_mb": None,
        "memory_free_mb": None,
        "memory_used_mb": None,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda if torch.cuda.is_available() else None,
        "count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "compute_capability": None,
    }
    if torch.cuda.is_available():
        try:
            gpu["name"] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            gpu["memory_total_mb"] = round(props.total_memory / 1024 / 1024)
            gpu["compute_capability"] = f"{props.major}.{props.minor}"

            try:
                import pynvml

                pynvml.nvmlInit()
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                gpu["memory_total_mb"] = round(mem_info.total / 1024 / 1024)
                gpu["memory_free_mb"] = round(mem_info.free / 1024 / 1024)
                gpu["memory_used_mb"] = round(mem_info.used / 1024 / 1024)
                pynvml.nvmlShutdown()
            except (ImportError, Exception):
                try:
                    import torch.cuda

                    free_mem, total_mem = torch.cuda.mem_get_info(0)
                    gpu["memory_total_mb"] = round(total_mem / 1024 / 1024)
                    gpu["memory_free_mb"] = round(free_mem / 1024 / 1024)
                    gpu["memory_used_mb"] = round((total_mem - free_mem) / 1024 / 1024)
                except Exception:
                    pass
        except Exception:
            pass
    return gpu

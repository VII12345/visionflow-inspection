# -*- coding: utf-8 -*-
"""MVS SDK 模拟替身（MvCameraControl_class.py 的 drop-in 替代）。

用于在没有真实海康相机时验证整套取流→推理→存盘→前端画面链路，不修改任何
系统代码。通过 PYTHONPATH 让 `import MvCameraControl_class` 优先命中本模块。

行为：
- 每个模拟相机按时生成一帧 RGB8 图像（默认从 `data/images` 下的产品照片循环，
  使推理结果返回真实类别名；也可用 `FAKE_CAMERA_IMAGE_DIR` 指定目录）；
- `MV_CC_EnumDevices` 暴露 `FAKE_CAMERA_COUNT` 台相机（默认 4），IP 依次为
  192.168.10.50..65，序列号 FAKESIM-0001..；
- `MV_CC_GetImageBuffer` 按 `FAKE_CAMERA_INTERVAL_MS`（默认 2000ms）模拟
  一次传感器触发，超时返回 MV_E_NODATA，与硬触发语义一致；
- 其余 SDK 调用（曝光/增益/触发沿/频闪/包大小等）均为无操作记录日志。

启动示例：
    cd E:/Document/自动识别
    FAKE_CAMERA_COUNT=4 PYTHONPATH=simulator .venv/Scripts/python.exe -m backend
"""

import ctypes as C
import os
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

# ---- SDK 常量（与本项目 backend/mvs_sdk.py 用到的符号一致）----
MV_GIGE_DEVICE = 0x00000001
MV_USB_DEVICE = 0x00000004
MV_TRIGGER_MODE_ON = 1
MV_E_NODATA = 0x80000001
PixelType_Gvsp_RGB8_Packed = 0x02180014
MV_ACCESS_Exclusive = 1
MV_ACCESS_ExclusiveWithSwitch = 2

_ERR_OK = 0
_ERR_UNKNOWN = 0x80000000


# ---- ctypes 结构（仅实现后端访问到的字段）----

class MV_GIGE_DEVICE_INFO(C.Structure):
    _fields_ = [
        ("chSerialNumber", C.c_ubyte * 64),
        ("chModelName", C.c_ubyte * 256),
        ("nCurrentIp", C.c_uint32),
    ]


class MV_USB3_DEVICE_INFO(C.Structure):
    _fields_ = [("nDeviceNumber", C.c_uint32)]


class MV_DEVICE_SPEC_INFO(C.Union):
    _fields_ = [
        ("stGigEInfo", MV_GIGE_DEVICE_INFO),
        ("stUsb3VInfo", MV_USB3_DEVICE_INFO),
    ]


class MV_CC_DEVICE_INFO(C.Structure):
    _fields_ = [
        ("nTLayerType", C.c_uint32),
        ("SpecialInfo", MV_DEVICE_SPEC_INFO),
    ]


class MV_CC_DEVICE_INFO_LIST(C.Structure):
    _fields_ = [
        ("nDeviceNum", C.c_uint32),
        ("pDeviceInfo", C.POINTER(C.POINTER(MV_CC_DEVICE_INFO))),
    ]


class MV_FRAME_INFO(C.Structure):
    _fields_ = [
        ("nWidth", C.c_uint32),
        ("nHeight", C.c_uint32),
        ("nFrameLen", C.c_uint32),
        ("enPixelType", C.c_uint32),
    ]


class MV_FRAME_OUT(C.Structure):
    _fields_ = [
        ("pBufAddr", C.POINTER(C.c_ubyte)),
        ("stFrameInfo", MV_FRAME_INFO),
    ]


class MV_CC_PIXEL_CONVERT_PARAM(C.Structure):
    # 字段类型与真实 SDK（CameraParams_header.py）保持一致：
    # pSrcData/pDstBuffer 为 POINTER(c_ubyte)，后端据此做数组赋值。
    _fields_ = [
        ("nWidth", C.c_uint32),
        ("nHeight", C.c_uint32),
        ("enSrcPixelType", C.c_uint32),
        ("pSrcData", C.POINTER(C.c_ubyte)),
        ("nSrcDataLen", C.c_uint32),
        ("enDstPixelType", C.c_uint32),
        ("pDstBuffer", C.POINTER(C.c_ubyte)),
        ("nDstBufferSize", C.c_uint32),
    ]


# ---- 图像加载与 IP 工具 ----

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


def _load_frames(image_dir, max_side=640, limit=24):
    """加载目录下最多 `limit` 张图片，等比缩放，返回 numpy RGB8 列表。"""
    frames = []
    for sub in sorted(Path(image_dir).iterdir()) if Path(image_dir).is_dir() else []:
        if not sub.is_dir():
            continue
        for img_path in sorted(sub.iterdir()):
            if len(frames) >= limit:
                break
            if img_path.suffix.lower() not in _IMAGE_EXTS:
                continue
            try:
                img = Image.open(img_path).convert("RGB")
                w, h = img.size
                scale = min(1.0, max_side / max(w, h))
                if scale < 1.0:
                    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
                frames.append(np.asarray(img, dtype=np.uint8))
            except Exception:
                continue
        if len(frames) >= limit:
            break
    if not frames:
        # 目录不可用时生成渐变占位帧，保证模拟可运行
        rng = np.random.default_rng(42)
        frames = [rng.integers(0, 255, (360, 480, 3), dtype=np.uint8) for _ in range(8)]
    return frames


def _ip_to_uint(ip):
    a, b, c, d = (int(x) for x in ip.split("."))
    return (a << 24) | (b << 16) | (c << 8) | d


def _uint_to_ip(value):
    return f"{(value >> 24) & 0xFF}.{(value >> 16) & 0xFF}.{(value >> 8) & 0xFF}.{value & 0xFF}"


def _fill_c_bytes(dst, text):
    raw = text.encode("utf-8")[: len(dst) - 1]
    for i, b in enumerate(raw):
        dst[i] = b
    dst[len(raw)] = 0


# ---- 模拟相机设备 ----

class FakeCameraDevice:
    """一台按固定节奏产生帧的模拟相机。"""

    def __init__(self, index, frames, interval_seconds, ip, offset=0):
        self.index = index
        self.serial = f"FAKESIM-{index:04d}"
        self.model = "FakeSimCamera"
        self.ip = ip
        self.frames = frames or _load_frames(".")
        self.interval = interval_seconds
        self.running = False
        self.frame_index = offset
        self._next_time = 0.0
        self._buffer = None  # 保持当前帧 numpy 存活，供 pBufAddr 引用

    def grab(self, timeout_ms):
        """阻塞到下一次触发或超时；超时返回 None（等价 MV_E_NODATA）。"""
        now = time.monotonic()
        if self._next_time <= now:
            self._next_time = now + self.interval
        deadline = now + timeout_ms / 1000.0
        while True:
            now = time.monotonic()
            if now >= self._next_time:
                self._next_time = now + self.interval
                self.frame_index += 1
                self._buffer = self.frames[self.frame_index % len(self.frames)]
                return self._buffer
            if now >= deadline:
                return None
            time.sleep(min(0.02, max(0.0, deadline - now)))


# ---- MvCamera 门面 ----

class MvCamera:
    """模拟的 MvCamera：类方法做 SDK 生命周期/枚举，实例方法做单相机操作。"""

    _devices = []
    _device_infos = []          # MV_CC_DEVICE_INFO 实例（需存活）
    _device_info_ptrs = None    # 指针数组（需存活）

    @classmethod
    def MV_CC_Initialize(cls):
        return _ERR_OK

    @classmethod
    def MV_CC_Finalize(cls):
        return _ERR_OK

    @classmethod
    def MV_CC_EnumDevices(cls, tlayer_type, device_list):
        cls._device_infos = []
        n = len(cls._devices)
        arr = (C.POINTER(MV_CC_DEVICE_INFO) * max(n, 1))()
        for i, dev in enumerate(cls._devices):
            info = MV_CC_DEVICE_INFO()
            info.nTLayerType = MV_GIGE_DEVICE
            _fill_c_bytes(info.SpecialInfo.stGigEInfo.chModelName, dev.model)
            _fill_c_bytes(info.SpecialInfo.stGigEInfo.chSerialNumber, dev.serial)
            info.SpecialInfo.stGigEInfo.nCurrentIp = _ip_to_uint(dev.ip)
            cls._device_infos.append(info)
            arr[i] = C.cast(C.pointer(info), C.POINTER(MV_CC_DEVICE_INFO))
        cls._device_info_ptrs = arr
        device_list.nDeviceNum = n
        device_list.pDeviceInfo = arr
        return _ERR_OK

    def __init__(self):
        self._device = None
        self._open = False
        self._grabbing = False

    def _bind(self, device_info):
        ip = _uint_to_ip(device_info.SpecialInfo.stGigEInfo.nCurrentIp)
        for dev in self._devices:
            if dev.ip == ip:
                return dev
        return None

    def MV_CC_CreateHandle(self, device_info):
        self._device = self._bind(device_info)
        return _ERR_OK if self._device is not None else _ERR_UNKNOWN

    def MV_CC_OpenDevice(self, access_mode=MV_ACCESS_ExclusiveWithSwitch, retry_times=0):
        if self._device is None:
            return _ERR_UNKNOWN
        self._open = True
        return _ERR_OK

    def MV_CC_GetOptimalPacketSize(self):
        return 1500

    def MV_CC_SetIntValue(self, name, value):
        return _ERR_OK

    def MV_CC_SetEnumValue(self, name, value):
        return _ERR_OK

    def MV_CC_SetFloatValue(self, name, value):
        return _ERR_OK

    def MV_CC_SetBoolValue(self, name, value):
        return _ERR_OK

    def MV_CC_StartGrabbing(self):
        if self._device is None:
            return _ERR_UNKNOWN
        self._device.running = True
        self._grabbing = True
        return _ERR_OK

    def MV_CC_StopGrabbing(self):
        self._grabbing = False
        if self._device is not None:
            self._device.running = False
        return _ERR_OK

    def MV_CC_GetImageBuffer(self, frame_out, timeout_ms):
        if self._device is None:
            return _ERR_UNKNOWN
        img = self._device.grab(timeout_ms)
        if img is None:
            return MV_E_NODATA
        h, w = img.shape[:2]
        frame_out.stFrameInfo.nWidth = w
        frame_out.stFrameInfo.nHeight = h
        frame_out.stFrameInfo.nFrameLen = img.nbytes
        frame_out.stFrameInfo.enPixelType = PixelType_Gvsp_RGB8_Packed
        frame_out.pBufAddr = img.ctypes.data_as(C.POINTER(C.c_ubyte))
        return _ERR_OK

    def MV_CC_FreeImageBuffer(self, frame_out):
        return _ERR_OK

    def MV_CC_ConvertPixelType(self, param):
        n = min(param.nDstBufferSize, param.nSrcDataLen)
        C.memmove(param.pDstBuffer, param.pSrcData, n)
        return _ERR_OK

    def MV_CC_CloseDevice(self):
        self._open = False
        return _ERR_OK

    def MV_CC_DestroyHandle(self):
        return _ERR_OK


# ---- 启动时根据环境变量初始化模拟相机 ----

def _setup():
    image_dir = os.environ.get("FAKE_CAMERA_IMAGE_DIR", "")
    if not image_dir:
        image_dir = str(Path(__file__).resolve().parent.parent / "data" / "images")
    try:
        count = int(os.environ.get("FAKE_CAMERA_COUNT", "4"))
    except ValueError:
        count = 4
    count = max(1, min(16, count))
    try:
        interval_ms = int(os.environ.get("FAKE_CAMERA_INTERVAL_MS", "2000"))
    except ValueError:
        interval_ms = 2000
    interval_ms = max(200, interval_ms)

    frames = _load_frames(image_dir)
    MvCamera._devices = []
    for i in range(count):
        ip = f"192.168.10.{50 + i}"
        # 不同相机从不同帧起点开始，避免多相机画面完全相同
        offset = (i * 5) % len(frames)
        MvCamera._devices.append(
            FakeCameraDevice(i + 1, frames, interval_ms / 1000.0, ip, offset=offset)
        )

    banner = (
        "\n[FAKE MVS SDK] 已载入相机模拟替身\n"
        f"  相机数量  : {count}\n"
        f"  图像来源  : {image_dir} ({len(frames)} 张循环)\n"
        f"  触发间隔  : {interval_ms} ms\n"
        "  模拟 IP   : " + ", ".join(f"192.168.10.{50 + i}" for i in range(count)) + "\n"
        "  请在页面将相机 IP 配置为上述地址后启动系统。\n"
    )
    print(banner, flush=True)
    sys.stderr.write(banner)


_setup()

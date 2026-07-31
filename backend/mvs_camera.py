"""
真实 MVS 相机驱动
基于 Hikvision MVS SDK
"""

import sys
import os
import time
import numpy as np
from pathlib import Path
from PIL import Image
from .config import Config
from .logger import logger

# 导入 MVS SDK
if Config.IS_WINDOWS:
    Config.prepare_mvs_runtime_paths()
    sys.path.append(Config.PYTHON_IMPORT_PATH)
    os.environ["MVCAM_COMMON_RUNENV"] = Config.MVS_SDK_PATH

try:
    from MvCameraControl_class import *
except ImportError as e:
    logger.error(f"无法导入 MVS SDK: {e}")
    MvCamera = None


class MVSCamera:
    """MVS 真实相机封装"""

    def __init__(self, cam_id, device_info):
        """
        Args:
            cam_id: 相机槽位 ID (1-4)
            device_info: MV_CC_DEVICE_INFO 结构体
        """
        self.cam_id = cam_id
        self.device_info = device_info
        self.handle = None
        self.running = False

        # 解析相机信息
        if device_info.nTLayerType == MV_GIGE_DEVICE:
            gige_info = device_info.SpecialInfo.stGigEInfo

            # 型号
            self.model = ""
            for per in gige_info.chModelName:
                if per == 0:
                    break
                self.model += chr(per)

            # 序列号
            self.serial = ""
            for per in gige_info.chSerialNumber:
                if per == 0:
                    break
                self.serial += chr(per)

            # IP 地址
            nip1 = (gige_info.nCurrentIp & 0xFF000000) >> 24
            nip2 = (gige_info.nCurrentIp & 0x00FF0000) >> 16
            nip3 = (gige_info.nCurrentIp & 0x0000FF00) >> 8
            nip4 = gige_info.nCurrentIp & 0x000000FF
            self.ip = f"{nip1}.{nip2}.{nip3}.{nip4}"

            logger.info(f"MVSCamera {cam_id}: {self.model} - {self.serial} - {self.ip}")
        else:
            # USB 相机
            usb_info = device_info.SpecialInfo.stUsb3VInfo
            self.model = "USB Camera"
            self.serial = str(usb_info.nDeviceNumber)
            self.ip = "N/A"
            logger.info(f"MVSCamera {cam_id}: USB Camera - {self.serial}")

    def connect(self):
        """连接相机（如果已有连接则先断开）"""
        if MvCamera is None:
            raise RuntimeError("MVS SDK 未加载")

        # 如果已有连接，先断开（防止重复连接导致设备占用）
        if self.handle is not None:
            self.disconnect()

        try:
            # 创建句柄
            self.handle = MvCamera()
            ret = self.handle.MV_CC_CreateHandle(self.device_info)
            if ret != 0:
                raise RuntimeError(f"创建句柄失败，错误码: {ret}")

            # 打开设备（先尝试强制切换，相机配置变更后可能需要强制接管）
            ret = self.handle.MV_CC_OpenDevice(
                MV_ACCESS_ExclusiveWithSwitch
                if "MV_ACCESS_ExclusiveWithSwitch" in dir()
                else 2,
                0,
            )
            if ret != 0:
                raise RuntimeError(f"打开设备失败，错误码: {ret}")

            # GigE 相机设置包大小
            if self.device_info.nTLayerType == MV_GIGE_DEVICE:
                nPacketSize = self.handle.MV_CC_GetOptimalPacketSize()
                if int(nPacketSize) > 0:
                    ret = self.handle.MV_CC_SetIntValue(
                        "GevSCPSPacketSize", nPacketSize
                    )
                    if ret == 0:
                        logger.info(
                            f"MVSCamera {self.cam_id}: 包大小设置为 {nPacketSize}"
                        )

            logger.info(f"MVSCamera {self.cam_id}: 连接成功")
            return True

        except Exception as e:
            logger.error(f"MVSCamera {self.cam_id}: 连接失败 - {e}")
            if self.handle:
                self.handle.MV_CC_DestroyHandle()
                self.handle = None
            raise

    def disconnect(self):
        """断开相机"""
        if self.handle:
            try:
                self.stop_grabbing()
                self.handle.MV_CC_CloseDevice()
                self.handle.MV_CC_DestroyHandle()
                logger.info(f"MVSCamera {self.cam_id}: 断开成功")
            except Exception as e:
                logger.error(f"MVSCamera {self.cam_id}: 断开失败 - {e}")
            finally:
                self.handle = None

    def start_grabbing(self, trigger_source="Line0", trigger_activation="RisingEdge"):
        """
        开始取流（硬触发模式：传感器触发才拍照）

        Args:
            trigger_source: 触发源 'Line0'/'Line1'/'Software'
            trigger_activation: 触发沿 'RisingEdge'/'FallingEdge'
        """
        if not self.handle:
            raise RuntimeError("相机未连接")

        # 字符串 → SDK 枚举值映射
        TRIGGER_SOURCE_MAP = {
            "Line0": 0,
            "Line1": 1,
            "Line2": 2,
            "Line3": 3,
            "Software": 7,
        }
        TRIGGER_ACTIVATION_MAP = {
            "RisingEdge": 0,
            "FallingEdge": 1,
            "LevelHigh": 2,
            "LevelLow": 3,
        }

        trigger_source_val = TRIGGER_SOURCE_MAP.get(trigger_source, 0)
        trigger_activation_val = TRIGGER_ACTIVATION_MAP.get(trigger_activation, 0)

        try:
            # 1. 开启硬件触发模式
            ret = self.handle.MV_CC_SetEnumValue("TriggerMode", MV_TRIGGER_MODE_ON)
            if ret != 0:
                raise RuntimeError(f"设置触发模式为ON失败，错误码: {ret}")

            # 2. 设置触发源（传入整数值）
            ret = self.handle.MV_CC_SetEnumValue("TriggerSource", trigger_source_val)
            if ret != 0:
                logger.warning(
                    f"MVSCamera {self.cam_id}: 设置触发源 {trigger_source} 失败(错误码: {ret})，使用默认值"
                )

            # 3. 设置触发沿（传入整数值）
            ret = self.handle.MV_CC_SetEnumValue(
                "TriggerActivation", trigger_activation_val
            )
            if ret != 0:
                logger.warning(
                    f"MVSCamera {self.cam_id}: 设置触发沿 {trigger_activation} 失败(错误码: {ret})，使用默认值"
                )

            # 4. 开始取流
            ret = self.handle.MV_CC_StartGrabbing()
            if ret != 0:
                raise RuntimeError(f"开始取流失败，错误码: {ret}")

            self.running = True
            logger.info(
                f"MVSCamera {self.cam_id}: 取流已启动 (触发模式: ON, 源: {trigger_source}, 沿: {trigger_activation})"
            )

        except Exception as e:
            logger.error(f"MVSCamera {self.cam_id}: 启动取流失败 - {e}")
            raise

    def stop_grabbing(self):
        """停止取流"""
        if self.handle and self.running:
            try:
                ret = self.handle.MV_CC_StopGrabbing()
                if ret != 0:
                    logger.warning(
                        f"MVSCamera {self.cam_id}: 停止取流失败，错误码: {ret}"
                    )
                self.running = False
                logger.info(f"MVSCamera {self.cam_id}: 停止取流")
            except Exception as e:
                logger.error(f"MVSCamera {self.cam_id}: 停止取流错误 - {e}")

    def grab_frame(self, timeout_ms=None):
        """
        抓取一帧（硬触发模式：阻塞等待传感器触发）

        Args:
            timeout_ms: 超时毫秒，None则使用配置值（触发模式建议较大值如30000ms）

        Returns:
            PIL.Image 或 None（失败/超时时）
        """
        if not self.running:
            return None

        # 触发模式下使用较长超时，等待传感器信号
        if timeout_ms is None:
            timeout_ms = Config.CAMERA_TRIGGER_TIMEOUT_MS

        try:
            # 阻塞等待图像（触发模式下会一直等到传感器触发）
            stOutFrame = MV_FRAME_OUT()
            ret = self.handle.MV_CC_GetImageBuffer(stOutFrame, timeout_ms)

            if ret != 0:
                if ret == MV_E_NODATA or ret == 0x80000001:  # 超时，无触发信号
                    return None
                logger.warning(f"MVSCamera {self.cam_id}: 获取图像失败，错误码: {ret}")
                return None

            try:
                # 转换为 RGB
                width = stOutFrame.stFrameInfo.nWidth
                height = stOutFrame.stFrameInfo.nHeight
                nRGBSize = width * height * 3
                pRGBData = (c_ubyte * nRGBSize)()

                stConvertParam = MV_CC_PIXEL_CONVERT_PARAM()
                memset(byref(stConvertParam), 0, sizeof(stConvertParam))
                stConvertParam.nWidth = width
                stConvertParam.nHeight = height
                stConvertParam.pSrcData = stOutFrame.pBufAddr
                stConvertParam.nSrcDataLen = stOutFrame.stFrameInfo.nFrameLen
                stConvertParam.enSrcPixelType = stOutFrame.stFrameInfo.enPixelType
                stConvertParam.enDstPixelType = PixelType_Gvsp_RGB8_Packed
                stConvertParam.pDstBuffer = pRGBData
                stConvertParam.nDstBufferSize = nRGBSize

                ret = self.handle.MV_CC_ConvertPixelType(stConvertParam)
                if ret != 0:
                    logger.error(
                        f"MVSCamera {self.cam_id}: 像素转换失败，错误码: {ret}"
                    )
                    return None

                # 转换为 numpy 数组
                image_array = np.frombuffer(pRGBData, dtype=np.uint8)
                image_array = image_array.reshape((height, width, 3))

                # 转换为 PIL Image
                pil_image = Image.fromarray(image_array, mode="RGB")

                return pil_image

            finally:
                # 释放图像缓冲区
                self.handle.MV_CC_FreeImageBuffer(stOutFrame)

        except Exception as e:
            logger.error(f"MVSCamera {self.cam_id}: 抓帧异常 - {e}")
            return None

    def set_exposure_time(self, exposure_time_us):
        """设置曝光时间 (μs)"""
        if not self.handle:
            return
        try:
            ret = self.handle.MV_CC_SetFloatValue(
                "ExposureTime", float(exposure_time_us)
            )
            if ret == 0:
                logger.info(
                    f"MVSCamera {self.cam_id}: 曝光时间 = {exposure_time_us} μs"
                )
            else:
                logger.warning(f"MVSCamera {self.cam_id}: 设置曝光失败(错误码: {ret})")
        except Exception as e:
            logger.warning(f"MVSCamera {self.cam_id}: 设置曝光异常 - {e}")

    def set_gain(self, gain_db):
        """设置模拟增益 (dB)"""
        if not self.handle:
            return
        try:
            ret = self.handle.MV_CC_SetFloatValue("Gain", float(gain_db))
            if ret == 0:
                logger.info(f"MVSCamera {self.cam_id}: 增益 = {gain_db} dB")
            else:
                logger.warning(f"MVSCamera {self.cam_id}: 设置增益失败(错误码: {ret})")
        except Exception as e:
            logger.warning(f"MVSCamera {self.cam_id}: 设置增益异常 - {e}")

    def set_trigger_delay(self, delay_us):
        """设置触发延时 (μs) — 收到触发信号后延时多久开始曝光"""
        if not self.handle:
            return
        try:
            ret = self.handle.MV_CC_SetFloatValue("TriggerDelay", float(delay_us))
            if ret == 0:
                logger.info(f"MVSCamera {self.cam_id}: 触发延时 = {delay_us} μs")
            else:
                logger.warning(
                    f"MVSCamera {self.cam_id}: 设置触发延时失败(错误码: {ret})"
                )
        except Exception as e:
            logger.warning(f"MVSCamera {self.cam_id}: 设置触发延时异常 - {e}")

    def set_line_debouncer(self, time_us):
        """设置 Line0 滤波时间 (μs) — 防止信号抖动导致误触发"""
        if not self.handle:
            return
        try:
            self.handle.MV_CC_SetEnumValue("LineSelector", 0)  # Line0
            ret = self.handle.MV_CC_SetIntValue("LineDebouncerTime", int(time_us))
            if ret == 0:
                logger.info(f"MVSCamera {self.cam_id}: Line0 滤波 = {time_us} μs")
            else:
                logger.warning(f"MVSCamera {self.cam_id}: 设置滤波失败(错误码: {ret})")
        except Exception as e:
            logger.warning(f"MVSCamera {self.cam_id}: 设置滤波异常 - {e}")

    def set_strobe(self, enable, delay_us=0, duration_us=1000):
        """设置频闪输出 (Line1) — 控制外部光源
        Args:
            enable: 是否启用频闪
            delay_us: 输出延时 (μs)
            duration_us: 输出持续时间 (μs)，0=与曝光同步
        """
        if not self.handle:
            return
        try:
            self.handle.MV_CC_SetEnumValue("LineSelector", 1)  # Line1
            self.handle.MV_CC_SetEnumValue("LineSource", 5)  # ExposureStartActive
            self.handle.MV_CC_SetBoolValue("StrobeEnable", enable)
            if enable:
                self.handle.MV_CC_SetFloatValue("StrobeLineDelay", float(delay_us))
                self.handle.MV_CC_SetFloatValue(
                    "StrobeLineDuration", float(duration_us)
                )
            logger.info(
                f"MVSCamera {self.cam_id}: 频闪={'ON' if enable else 'OFF'} "
                f"延时={delay_us}μs 持续={duration_us}μs"
            )
        except Exception as e:
            logger.warning(f"MVSCamera {self.cam_id}: 设置频闪异常 - {e}")

    def get_info(self):
        """获取相机信息"""
        return {
            "serial": self.serial,
            "model": self.model,
            "type": "GigE" if self.device_info.nTLayerType == MV_GIGE_DEVICE else "USB",
            "cam_id": self.cam_id,
            "ip": self.ip,
        }

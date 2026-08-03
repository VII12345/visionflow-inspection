"""MVS 取流能力：触发配置、启停与抓帧。"""

from ctypes import byref, c_ubyte, memset, sizeof

import numpy as np
from PIL import Image

from .config import Config
from .logger import logger
from .mvs_sdk import (
    MV_CC_PIXEL_CONVERT_PARAM,
    MV_E_NODATA,
    MV_FRAME_OUT,
    MV_TRIGGER_MODE_ON,
    PixelType_Gvsp_RGB8_Packed,
)


class MVSAcquisitionMixin:
    """取流启停与帧抓取。"""

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

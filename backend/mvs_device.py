"""MVS 设备生命周期：连接/断开与设备信息解析。"""

from .logger import logger
from .mvs_sdk import *  # noqa: F401,F403


class MVSDeviceMixin:
    """设备连接、断开与信息读取。"""

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
            info = parse_gige_info(device_info.SpecialInfo.stGigEInfo)
            self.model = info["model"]
            self.serial = info["serial"]
            self.ip = info["ip"]

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

    def get_info(self):
        """获取相机信息"""
        return {
            "serial": self.serial,
            "model": self.model,
            "type": "GigE" if self.device_info.nTLayerType == MV_GIGE_DEVICE else "USB",
            "cam_id": self.cam_id,
            "ip": self.ip,
        }

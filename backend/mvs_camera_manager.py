"""MVS SDK 生命周期、设备枚举和相机实例管理。"""

# SDK 类型和常量由驱动模块按安装环境动态导入。无 SDK 时 MvCamera 为 None，
# initialize/enumerate 会在访问其他 SDK 符号前给出明确错误。
from ctypes import POINTER, cast

from .logger import logger
from .mvs_camera import MVSCamera
from .mvs_sdk import (
    MV_CC_DEVICE_INFO,
    MV_CC_DEVICE_INFO_LIST,
    MV_GIGE_DEVICE,
    MV_USB_DEVICE,
    MvCamera,
    parse_gige_info,
)


class MVSCameraManager:
    """MVS 相机管理器"""

    def __init__(self):
        self.cameras = {}
        self.device_list = None
        logger.info("MVSCameraManager 初始化")

    def initialize(self):
        """初始化 MVS SDK"""
        if MvCamera is None:
            raise RuntimeError("MVS SDK 未加载，请检查安装路径")

        try:
            MvCamera.MV_CC_Initialize()
            logger.info("MVS SDK 初始化成功")
            return True
        except Exception as e:
            logger.error(f"MVS SDK 初始化失败: {e}")
            raise

    def finalize(self):
        """反初始化 MVS SDK"""
        try:
            # 断开所有相机
            for cam_id in list(self.cameras.keys()):
                self.remove_camera(cam_id)

            if MvCamera:
                MvCamera.MV_CC_Finalize()
            logger.info("MVS SDK 反初始化成功")
        except Exception as e:
            logger.error(f"MVS SDK 反初始化失败: {e}")

    def enumerate_cameras(self):
        """
        枚举所有相机
        Returns:
            list: [{'index': 0, 'serial': '...', 'model': '...', 'type': 'GigE/USB', 'ip': '...'}]
        """
        if MvCamera is None:
            raise RuntimeError("MVS SDK 未加载")

        try:
            self.device_list = MV_CC_DEVICE_INFO_LIST()
            tlayerType = MV_GIGE_DEVICE | MV_USB_DEVICE

            ret = MvCamera.MV_CC_EnumDevices(tlayerType, self.device_list)
            if ret != 0:
                raise RuntimeError(f"枚举设备失败，错误码: {ret}")

            camera_list = []
            for i in range(self.device_list.nDeviceNum):
                mvcc_dev_info = cast(
                    self.device_list.pDeviceInfo[i], POINTER(MV_CC_DEVICE_INFO)
                ).contents

                if mvcc_dev_info.nTLayerType == MV_GIGE_DEVICE:
                    info = parse_gige_info(mvcc_dev_info.SpecialInfo.stGigEInfo)
                    camera_list.append(
                        {
                            "index": i,
                            "serial": info["serial"],
                            "model": info["model"],
                            "type": "GigE",
                            "ip": info["ip"],
                        }
                    )
                else:
                    # USB 相机
                    usb_info = mvcc_dev_info.SpecialInfo.stUsb3VInfo
                    camera_list.append(
                        {
                            "index": i,
                            "serial": str(usb_info.nDeviceNumber),
                            "model": "USB Camera",
                            "type": "USB3",
                            "ip": "N/A",
                        }
                    )

            logger.info(f"枚举到 {len(camera_list)} 台相机")
            return camera_list

        except Exception as e:
            logger.error(f"枚举相机失败: {e}")
            raise

    def create_camera(self, cam_id, device_index=0):
        """
        创建相机实例
        Args:
            cam_id: 相机槽位 ID (1-4)
            device_index: 设备索引（来自 enumerate_cameras）
        """
        if cam_id in self.cameras:
            return self.cameras[cam_id]

        if self.device_list is None or device_index >= self.device_list.nDeviceNum:
            raise ValueError(f"无效的设备索引: {device_index}")

        try:
            mvcc_dev_info = cast(
                self.device_list.pDeviceInfo[device_index], POINTER(MV_CC_DEVICE_INFO)
            ).contents
            camera = MVSCamera(cam_id, mvcc_dev_info)
            self.cameras[cam_id] = camera
            logger.info(f"创建 Camera {cam_id} (设备索引: {device_index})")
            return camera

        except Exception as e:
            logger.error(f"创建 Camera {cam_id} 失败: {e}")
            raise

    def get_camera(self, cam_id):
        """获取相机实例"""
        return self.cameras.get(cam_id)

    def remove_camera(self, cam_id):
        """移除相机实例"""
        if cam_id in self.cameras:
            cam = self.cameras[cam_id]
            cam.disconnect()
            del self.cameras[cam_id]
            logger.info(f"移除 Camera {cam_id}")

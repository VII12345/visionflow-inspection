"""
真实 MVS 相机驱动
基于 Hikvision MVS SDK
"""

from .mvs_acquisition import MVSAcquisitionMixin
from .mvs_controls import MVSControlsMixin
from .mvs_device import MVSDeviceMixin


class MVSCamera(MVSDeviceMixin, MVSAcquisitionMixin, MVSControlsMixin):
    """MVS 真实相机封装"""

    def __init__(self, cam_id, device_info):
        """
        Args:
            cam_id: 相机槽位 ID (1-4)
            device_info: MV_CC_DEVICE_INFO 结构体
        """
        super().__init__(cam_id, device_info)

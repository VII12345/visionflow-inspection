"""MVS 相机控制能力：曝光、增益、触发延时、滤波与频闪。"""

from .logger import logger


class MVSControlsMixin:
    """相机参数控制。"""

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

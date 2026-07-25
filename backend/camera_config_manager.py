"""
相机配置管理
负责保存和加载相机IP地址等配置信息
"""

import json
from pathlib import Path
from .config import Config
from .logger import logger


class CameraConfigManager:
    """相机配置管理器"""

    def __init__(self):
        self.config_file = Config.CAMERA_CONFIG_FILE
        self.config = self._load_config()

    def _load_config(self):
        """加载配置文件（自动迁移补全缺失字段）"""
        logger.info(f"相机配置文件路径: {self.config_file.absolute()}")
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    # 用默认值补全所有缺失字段
                    defaults = self._default_config()["cameras"]
                    for cam_id in defaults:
                        if cam_id not in config.get("cameras", {}):
                            config.setdefault("cameras", {})[cam_id] = defaults[cam_id]
                        else:
                            for key, default_val in defaults[cam_id].items():
                                config["cameras"][cam_id].setdefault(key, default_val)
                    logger.info(
                        f"加载相机配置: {len(config.get('cameras', {}))} 个相机"
                    )
                    return config
            except Exception as e:
                logger.error(f"加载相机配置失败: {e}")
                return self._default_config()
        else:
            logger.info("相机配置文件不存在，使用默认配置")
            return self._default_config()

    def _default_config(self):
        """默认配置"""
        return {
            "cameras": {
                str(i): {
                    "enabled": False,
                    "ip": "",
                    "name": f"Cam{i}",
                    "triggerSource": "Line0",
                    "triggerActivation": "RisingEdge",
                    "triggerTimeout": 30000,
                    "triggerDelay": 0,
                    "exposureTime": 5000,
                    "gain": 0,
                    "lineDebouncerTime": 50,
                    "strobeEnable": False,
                    "strobeDelay": 0,
                    "strobeDuration": 1000,
                    "rejectTime": 0,
                    "rejectDelay": 0,
                    "plcUrl": "http://127.0.0.1:8088",
                }
                for i in range(1, Config.CAMERA_COUNT + 1)
            }
        }

    def ensure_camera_slots(self, count):
        """按线体数量补齐相机配置槽位，保留已有配置。"""
        count = max(Config.MIN_CAMERA_COUNT, min(Config.MAX_CAMERA_COUNT, int(count)))
        defaults = self._default_config()["cameras"]
        cameras = self.config.setdefault("cameras", {})
        for cam_id in range(1, count + 1):
            key = str(cam_id)
            if key not in cameras:
                cameras[key] = defaults[key]
        return self.save_config(self.config)
    def save_config(self, config):
        """保存配置到文件"""
        try:
            Config.DATA_DIR.mkdir(exist_ok=True)
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            self.config = config
            logger.info(f"相机配置已保存到: {self.config_file}")
            return True
        except Exception as e:
            logger.error(f"保存相机配置失败: {e}")
            return False

    def get_config(self):
        """获取当前配置"""
        return self.config

    def get_camera_config(self, cam_id):
        """获取指定相机的配置"""
        return self.config.get("cameras", {}).get(str(cam_id))

    def update_camera_config(self, cam_id, camera_config):
        """更新指定相机的配置"""
        if "cameras" not in self.config:
            self.config["cameras"] = {}

        self.config["cameras"][str(cam_id)] = camera_config
        return self.save_config(self.config)

    def get_enabled_cameras(self):
        """获取所有启用的相机配置"""
        enabled = {}
        for cam_id, cam_config in self.config.get("cameras", {}).items():
            if cam_config.get("enabled", False) and cam_config.get("ip"):
                enabled[int(cam_id)] = cam_config
        return enabled


# 全局实例
camera_config_manager = CameraConfigManager()


"""
模拟相机 - 用于 Phase 1 测试
使用项目中的测试图片模拟相机抓帧
"""
import time
import random
from pathlib import Path
from PIL import Image
from .logger import logger


class MockCamera:
    """模拟相机"""

    def __init__(self, cam_id, image_dir):
        self.cam_id = cam_id
        self.image_dir = Path(image_dir)
        self.running = False
        self.serial = f"MOCK{cam_id:04d}"
        self.model = "Mock Camera"
        self.images = list(self.image_dir.glob("*.jpg")) + list(self.image_dir.glob("*.jpeg"))
        self.current_index = 0

        if not self.images:
            logger.warning(f"MockCamera {cam_id}: 未找到测试图片在 {image_dir}")
            # 创建一个纯色图片作为 fallback
            self.images = [None]

        logger.info(f"MockCamera {cam_id} 初始化，找到 {len(self.images)} 张测试图片")

    def connect(self):
        """连接相机"""
        logger.info(f"MockCamera {self.cam_id}: 模拟连接")
        return True

    def disconnect(self):
        """断开相机"""
        logger.info(f"MockCamera {self.cam_id}: 模拟断开")
        self.running = False

    def start_grabbing(self):
        """开始取流"""
        self.running = True
        logger.info(f"MockCamera {self.cam_id}: 开始取流")

    def stop_grabbing(self):
        """停止取流"""
        self.running = False
        logger.info(f"MockCamera {self.cam_id}: 停止取流")

    def grab_frame(self):
        """抓取一帧"""
        if not self.running:
            return None

        # 模拟相机延迟
        time.sleep(0.05)

        # 循环读取测试图片
        if self.images[0] is None:
            # 创建纯色图片
            img = Image.new('RGB', (640, 480), color=(100 + self.cam_id * 30, 100, 150))
        else:
            img_path = self.images[self.current_index]
            img = Image.open(img_path).convert('RGB')
            self.current_index = (self.current_index + 1) % len(self.images)

        # 添加相机 ID 标识（在图片上绘制文字）
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        try:
            # 尝试使用系统字体
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
        except:
            font = ImageFont.load_default()

        text = f"CAM {self.cam_id}"
        # 简单的文字位置
        draw.text((10, 10), text, fill=(255, 255, 0), font=font)

        return img

    def get_info(self):
        """获取相机信息"""
        return {
            'serial': self.serial,
            'model': self.model,
            'type': 'Mock',
            'cam_id': self.cam_id
        }


class MockCameraManager:
    """模拟相机管理器"""

    def __init__(self, image_dir):
        self.image_dir = image_dir
        self.cameras = {}
        logger.info("MockCameraManager 初始化")

    def initialize(self):
        """初始化 SDK"""
        logger.info("MockCameraManager: 模拟初始化")
        return True

    def finalize(self):
        """反初始化 SDK"""
        logger.info("MockCameraManager: 模拟反初始化")

    def enumerate_cameras(self):
        """枚举相机"""
        # 模拟返回 4 台相机
        camera_list = []
        for i in range(1, 5):
            camera_list.append({
                'index': i - 1,
                'serial': f"MOCK{i:04d}",
                'model': f"Mock Camera {i}",
                'type': 'USB3'
            })
        logger.info(f"MockCameraManager: 枚举到 {len(camera_list)} 台相机")
        return camera_list

    def create_camera(self, cam_id):
        """创建相机实例"""
        if cam_id in self.cameras:
            return self.cameras[cam_id]

        camera = MockCamera(cam_id, self.image_dir)
        self.cameras[cam_id] = camera
        logger.info(f"MockCameraManager: 创建 Camera {cam_id}")
        return camera

    def get_camera(self, cam_id):
        """获取相机实例"""
        return self.cameras.get(cam_id)

    def remove_camera(self, cam_id):
        """移除相机实例"""
        if cam_id in self.cameras:
            cam = self.cameras[cam_id]
            cam.disconnect()
            del self.cameras[cam_id]
            logger.info(f"MockCameraManager: 移除 Camera {cam_id}")

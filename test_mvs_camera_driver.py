#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 backend 中的 MVS 相机驱动
验证项目能否正常与摄像头通信
"""
import sys
import time
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from backend.mvs_camera import MVSCameraManager
from backend.logger import logger

print("=" * 60)
print("测试项目的 MVS 相机驱动")
print("=" * 60)

try:
    # ========== 初始化管理器 ==========
    print("\n[1/5] 初始化 MVS 相机管理器...")
    manager = MVSCameraManager()
    manager.initialize()
    print("✓ 初始化成功")

    # ========== 枚举设备 ==========
    print("\n[2/5] 枚举所有相机...")
    camera_list = manager.enumerate_cameras()
    print(f"✓ 找到 {len(camera_list)} 台相机:")

    if len(camera_list) == 0:
        print("\n⚠️  未检测到任何相机！")
        manager.finalize()
        sys.exit(1)

    for cam_info in camera_list:
        print(f"  [{cam_info['index']}] {cam_info['type']} - {cam_info['model']} - "
              f"序列号: {cam_info['serial']} - IP: {cam_info.get('ip', 'N/A')}")

    # ========== 创建并连接第一台相机 ==========
    print("\n[3/5] 连接到第一台相机...")
    camera = manager.create_camera(cam_id=1, device_index=0)
    camera.connect()
    print("✓ 相机连接成功")

    info = camera.get_info()
    print(f"  相机信息:")
    print(f"    型号: {info['model']}")
    print(f"    序列号: {info['serial']}")
    print(f"    类型: {info['type']}")
    print(f"    IP: {info.get('ip', 'N/A')}")

    # ========== 开始取流 ==========
    print("\n[4/5] 开始取流...")
    camera.start_grabbing()
    print("✓ 取流启动成功")

    # ========== 抓取测试帧 ==========
    print("\n[5/5] 抓取 3 帧测试图像...")

    output_dir = Path("./test_captures/driver_test")
    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for i in range(3):
        print(f"\n  抓取第 {i+1} 帧...")

        frame = camera.grab_frame()
        if frame is None:
            print(f"  ✗ 抓取失败")
            continue

        print(f"  ✓ 抓取成功，尺寸: {frame.size}")

        # 保存图片
        timestamp = int(time.time() * 1000)
        output_file = output_dir / f"frame_{i+1}_{timestamp}.jpg"
        frame.save(output_file, 'JPEG', quality=90)

        file_size = output_file.stat().st_size / 1024
        print(f"  ✓ 已保存: {output_file.name} ({file_size:.1f} KB)")
        success_count += 1

        time.sleep(0.5)

    # ========== 清理 ==========
    print("\n清理资源...")
    camera.stop_grabbing()
    camera.disconnect()
    manager.finalize()

    # ========== 总结 ==========
    print("\n" + "=" * 60)
    print("测试完成！")
    print("=" * 60)
    print(f"成功抓取: {success_count}/3 帧")
    print(f"保存位置: {output_dir.absolute()}")

    if success_count > 0:
        print("\n✅ 项目 MVS 相机驱动测试成功！")
        print("   backend.mvs_camera 模块可以正常与摄像头通信")
    else:
        print("\n⚠️  相机连接成功，但抓帧失败")

    sys.exit(0 if success_count > 0 else 1)

except Exception as e:
    print(f"\n✗ 测试失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 backend 服务与真实摄像头的集成
验证 Flask API 能否正常工作
"""
import sys
import time
import requests
from pathlib import Path

# 测试配置
API_BASE = "http://127.0.0.1:5000/api"
TIMEOUT = 5

print("=" * 60)
print("测试 Backend 服务与真实摄像头集成")
print("=" * 60)

def test_health():
    """测试健康检查接口"""
    print("\n[1/7] 测试健康检查...")
    try:
        resp = requests.get(f"{API_BASE}/health", timeout=TIMEOUT)
        data = resp.json()
        print(f"✓ 服务状态: {data['status']}")
        print(f"  版本: {data['version']}")
        print(f"  运行中: {data['running']}")
        print(f"  模型已加载: {data['modelLoaded']}")
        return True
    except Exception as e:
        print(f"✗ 健康检查失败: {e}")
        return False

def test_enumerate_cameras():
    """测试枚举相机"""
    print("\n[2/7] 测试枚举相机...")
    try:
        resp = requests.get(f"{API_BASE}/cameras", timeout=TIMEOUT)
        data = resp.json()

        if not data['success']:
            print(f"✗ 枚举失败: {data.get('error')}")
            return False

        cameras = data['cameras']
        print(f"✓ 找到 {len(cameras)} 台相机:")
        for cam in cameras:
            print(f"  [{cam['index']}] {cam['type']} - {cam['model']} - "
                  f"SN: {cam['serial']} - IP: {cam.get('ip', 'N/A')}")
        return len(cameras) > 0
    except Exception as e:
        print(f"✗ 枚举相机失败: {e}")
        return False

def test_start_system():
    """测试启动系统"""
    print("\n[3/7] 测试启动系统...")
    try:
        resp = requests.post(f"{API_BASE}/start", timeout=10)
        data = resp.json()

        if not data['success']:
            print(f"✗ 启动失败: {data.get('message')}")
            return False

        print(f"✓ 系统启动成功: {data['message']}")
        return True
    except Exception as e:
        print(f"✗ 启动系统失败: {e}")
        return False

def test_status():
    """测试获取状态"""
    print("\n[4/7] 测试获取系统状态...")
    try:
        resp = requests.get(f"{API_BASE}/status", timeout=TIMEOUT)
        data = resp.json()

        print(f"✓ 系统运行中: {data['system']['running']}")

        cameras = data['cameras']
        for cam_id, cam_data in cameras.items():
            state = cam_data['state']
            model = cam_data.get('model', 'N/A')
            fps = cam_data.get('fps', 0)
            print(f"  Camera {cam_id}: {state} - {model} - {fps} fps")

        return True
    except Exception as e:
        print(f"✗ 获取状态失败: {e}")
        return False

def test_grab_frames():
    """测试抓取图像"""
    print("\n[5/7] 测试抓取图像（等待3秒让相机稳定）...")
    time.sleep(3)

    success_count = 0
    for cam_id in range(1, 5):
        try:
            resp = requests.get(f"{API_BASE}/frame/{cam_id}", timeout=TIMEOUT)

            if resp.status_code == 200:
                # 保存图片
                output_dir = Path("./test_captures/api_test")
                output_dir.mkdir(parents=True, exist_ok=True)

                output_file = output_dir / f"cam{cam_id}_{int(time.time())}.jpg"
                output_file.write_bytes(resp.content)

                file_size = len(resp.content) / 1024
                print(f"  Camera {cam_id}: ✓ 抓取成功 ({file_size:.1f} KB)")
                success_count += 1
            else:
                print(f"  Camera {cam_id}: - 无数据")
        except Exception as e:
            print(f"  Camera {cam_id}: ✗ 失败 ({e})")

    print(f"\n  成功抓取: {success_count}/4 个相机")
    return success_count > 0

def test_get_results():
    """测试获取检测结果"""
    print("\n[6/7] 测试获取检测结果...")

    success_count = 0
    for cam_id in range(1, 5):
        try:
            resp = requests.get(f"{API_BASE}/result/{cam_id}", timeout=TIMEOUT)

            if resp.status_code == 200:
                data = resp.json()
                label = data.get('label', 'N/A')
                confidence = data.get('confidence', 0)
                print(f"  Camera {cam_id}: {label} (置信度: {confidence:.2f})")
                success_count += 1
            else:
                print(f"  Camera {cam_id}: - 无结果")
        except Exception as e:
            print(f"  Camera {cam_id}: ✗ 失败")

    print(f"\n  获取结果: {success_count}/4 个相机")
    return success_count > 0

def test_stop_system():
    """测试停止系统"""
    print("\n[7/7] 测试停止系统...")
    try:
        resp = requests.post(f"{API_BASE}/stop", timeout=10)
        data = resp.json()

        if not data['success']:
            print(f"✗ 停止失败: {data.get('message')}")
            return False

        print(f"✓ 系统停止成功: {data['message']}")
        return True
    except Exception as e:
        print(f"✗ 停止系统失败: {e}")
        return False

# ========== 执行测试 ==========
try:
    print("\n提示: 请确保 backend 服务已启动 (python -m backend)")
    print("等待 3 秒后开始测试...")
    time.sleep(3)

    results = []
    results.append(("健康检查", test_health()))
    results.append(("枚举相机", test_enumerate_cameras()))
    results.append(("启动系统", test_start_system()))
    results.append(("获取状态", test_status()))
    results.append(("抓取图像", test_grab_frames()))
    results.append(("检测结果", test_get_results()))
    results.append(("停止系统", test_stop_system()))

    # ========== 总结 ==========
    print("\n" + "=" * 60)
    print("测试结果总结")
    print("=" * 60)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✓ 通过" if result else "✗ 失败"
        print(f"  {name:12s}: {status}")

    print(f"\n通过率: {passed}/{total} ({passed*100//total}%)")

    if passed == total:
        print("\n✅ 所有测试通过！")
        print("   Backend 服务可以正常与真实摄像头通信")
    else:
        print("\n⚠️  部分测试失败")

    sys.exit(0 if passed == total else 1)

except KeyboardInterrupt:
    print("\n\n测试被用户中断")
    sys.exit(1)
except Exception as e:
    print(f"\n✗ 测试异常: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

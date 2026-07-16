#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MVS 相机连接测试脚本 - 简化版
使用 numpy + PIL 保存图片（不依赖 MVS 的保存接口）
"""

import sys
import os
import time
from pathlib import Path
import numpy as np
from PIL import Image

# ========== MVS SDK 路径配置 ==========
if sys.platform == 'win32':
    MVS_SDK_PATH = r'C:\Program Files (x86)\MVS'
    PYTHON_IMPORT_PATH = r'C:\Program Files (x86)\MVS\Development\Samples\Python\MvImport'
else:
    print("⚠️  此脚本只能在 Windows 上运行")
    sys.exit(1)

sys.path.append(PYTHON_IMPORT_PATH)
os.environ['MVCAM_COMMON_RUNENV'] = MVS_SDK_PATH

try:
    from MvCameraControl_class import *
except ImportError as e:
    print(f"错误: 无法导入 MVS SDK 模块: {e}")
    sys.exit(1)

# ========== 配置 ==========
TARGET_CAMERA_IP = "192.168.1.50"
OUTPUT_DIR = Path("./test_captures")
OUTPUT_DIR.mkdir(exist_ok=True)

print("=" * 60)
print("MVS 相机连接测试 - 简化版")
print("=" * 60)
print(f"目标相机 IP: {TARGET_CAMERA_IP}")
print(f"输出目录: {OUTPUT_DIR.absolute()}")
print()

# ========== 初始化 ==========
print("[1/6] 初始化 MVS SDK...")
MvCamera.MV_CC_Initialize()
print("✓ SDK 初始化成功")

# ========== 枚举设备 ==========
print("\n[2/6] 枚举 GigE 设备...")
deviceList = MV_CC_DEVICE_INFO_LIST()
tlayerType = MV_GIGE_DEVICE | MV_USB_DEVICE

ret = MvCamera.MV_CC_EnumDevices(tlayerType, deviceList)
if ret != 0:
    print(f"✗ 枚举设备失败，错误码: {ret}")
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

print(f"✓ 找到 {deviceList.nDeviceNum} 台设备")

if deviceList.nDeviceNum == 0:
    print("\n⚠️  未检测到任何相机！")
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

# ========== 查找目标相机 ==========
print(f"\n[3/6] 查找目标相机 (IP: {TARGET_CAMERA_IP})...")
target_camera_info = None

for i in range(deviceList.nDeviceNum):
    mvcc_dev_info = cast(deviceList.pDeviceInfo[i], POINTER(MV_CC_DEVICE_INFO)).contents

    if mvcc_dev_info.nTLayerType == MV_GIGE_DEVICE:
        strModeName = ""
        for per in mvcc_dev_info.SpecialInfo.stGigEInfo.chModelName:
            if per == 0:
                break
            strModeName += chr(per)

        nip1 = ((mvcc_dev_info.SpecialInfo.stGigEInfo.nCurrentIp & 0xff000000) >> 24)
        nip2 = ((mvcc_dev_info.SpecialInfo.stGigEInfo.nCurrentIp & 0x00ff0000) >> 16)
        nip3 = ((mvcc_dev_info.SpecialInfo.stGigEInfo.nCurrentIp & 0x0000ff00) >> 8)
        nip4 = (mvcc_dev_info.SpecialInfo.stGigEInfo.nCurrentIp & 0x000000ff)
        camera_ip = f"{nip1}.{nip2}.{nip3}.{nip4}"

        print(f"  [{i}] GigE - {strModeName} - IP: {camera_ip}")

        if camera_ip == TARGET_CAMERA_IP:
            target_camera_info = mvcc_dev_info
            print(f"      ✓ 找到目标相机！")

if target_camera_info is None:
    print(f"\n✗ 未找到 IP 为 {TARGET_CAMERA_IP} 的相机")
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

# ========== 连接相机 ==========
print(f"\n[4/6] 连接到相机...")
cam = MvCamera()

ret = cam.MV_CC_CreateHandle(target_camera_info)
if ret != 0:
    print(f"✗ 创建句柄失败，错误码: {ret}")
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

ret = cam.MV_CC_OpenDevice(MV_ACCESS_Exclusive, 0)
if ret != 0:
    print(f"✗ 打开设备失败，错误码: {ret}")
    cam.MV_CC_DestroyHandle()
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

print("✓ 相机连接成功")

# 设置 GigE 包大小
if target_camera_info.nTLayerType == MV_GIGE_DEVICE:
    print("  设置 GigE 包大小...")
    nPacketSize = cam.MV_CC_GetOptimalPacketSize()
    if int(nPacketSize) > 0:
        ret = cam.MV_CC_SetIntValue("GevSCPSPacketSize", nPacketSize)
        if ret == 0:
            print(f"  ✓ 包大小设置为: {nPacketSize}")

# ========== 开始取流 ==========
print("\n[5/6] 开始取流...")
ret = cam.MV_CC_SetEnumValue("TriggerMode", MV_TRIGGER_MODE_OFF)
ret = cam.MV_CC_StartGrabbing()
if ret != 0:
    print(f"✗ 开始取流失败，错误码: {ret}")
    cam.MV_CC_CloseDevice()
    cam.MV_CC_DestroyHandle()
    MvCamera.MV_CC_Finalize()
    sys.exit(1)

print("✓ 取流启动成功")

# ========== 抓取图片 ==========
print("\n[6/6] 抓取并保存图片（使用 numpy + PIL）...")

stOutFrame = MV_FRAME_OUT()
success_count = 0

for i in range(3):
    print(f"\n  抓取第 {i+1} 张图片...")

    ret = cam.MV_CC_GetImageBuffer(stOutFrame, 1000)
    if ret != 0:
        print(f"  ✗ 获取图像失败，错误码: {ret}")
        continue

    print(f"  ✓ 获取图像成功")
    print(f"    分辨率: {stOutFrame.stFrameInfo.nWidth} x {stOutFrame.stFrameInfo.nHeight}")
    print(f"    像素格式: {stOutFrame.stFrameInfo.enPixelType}")

    # 方法：转换为 RGB，然后用 PIL 保存
    nRGBSize = stOutFrame.stFrameInfo.nWidth * stOutFrame.stFrameInfo.nHeight * 3
    pRGBData = (c_ubyte * nRGBSize)()

    stConvertParam = MV_CC_PIXEL_CONVERT_PARAM()
    memset(byref(stConvertParam), 0, sizeof(stConvertParam))
    stConvertParam.nWidth = stOutFrame.stFrameInfo.nWidth
    stConvertParam.nHeight = stOutFrame.stFrameInfo.nHeight
    stConvertParam.pSrcData = stOutFrame.pBufAddr
    stConvertParam.nSrcDataLen = stOutFrame.stFrameInfo.nFrameLen
    stConvertParam.enSrcPixelType = stOutFrame.stFrameInfo.enPixelType
    stConvertParam.enDstPixelType = PixelType_Gvsp_RGB8_Packed
    stConvertParam.pDstBuffer = pRGBData
    stConvertParam.nDstBufferSize = nRGBSize

    ret = cam.MV_CC_ConvertPixelType(stConvertParam)
    if ret != 0:
        print(f"  ✗ 像素格式转换失败，错误码: {ret}")
        cam.MV_CC_FreeImageBuffer(stOutFrame)
        continue

    print(f"  ✓ 像素格式转换成功")

    # 转换为 numpy 数组
    try:
        image_array = np.frombuffer(pRGBData, dtype=np.uint8)
        image_array = image_array.reshape((stOutFrame.stFrameInfo.nHeight,
                                          stOutFrame.stFrameInfo.nWidth,
                                          3))

        # 使用 PIL 保存
        pil_image = Image.fromarray(image_array, mode='RGB')

        timestamp = int(time.time() * 1000)
        output_file = OUTPUT_DIR / f"camera_{TARGET_CAMERA_IP.replace('.', '_')}_frame_{i+1}_{timestamp}.jpg"

        pil_image.save(output_file, 'JPEG', quality=90)

        file_size = output_file.stat().st_size / 1024
        print(f"  ✓ 图片已保存: {output_file.name} ({file_size:.1f} KB)")
        success_count += 1

    except Exception as e:
        print(f"  ✗ 保存图片失败: {e}")

    cam.MV_CC_FreeImageBuffer(stOutFrame)
    time.sleep(0.5)

# ========== 清理 ==========
print("\n清理资源...")
cam.MV_CC_StopGrabbing()
cam.MV_CC_CloseDevice()
cam.MV_CC_DestroyHandle()
MvCamera.MV_CC_Finalize()

# ========== 总结 ==========
print("\n" + "=" * 60)
print("测试完成！")
print("=" * 60)
print(f"成功抓取: {success_count}/3 张图片")
print(f"保存位置: {OUTPUT_DIR.absolute()}")

if success_count > 0:
    print("\n✅ 相机连接测试成功！")
    print("   可以正常连接到相机并获取图片")
else:
    print("\n⚠️  相机连接成功，但保存图片失败")

sys.exit(0 if success_count > 0 else 1)

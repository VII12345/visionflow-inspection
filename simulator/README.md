# 相机模拟器（Fake MVS SDK）

在不修改任何系统代码的前提下，模拟一台或多台海康 MVS 相机，让后端**真实的**
取流→推理→存盘→前端画面链路在无相机环境下跑起来。适用于：

- 验证运行页实时画面（帧链路）、检测结果、统计与照片存盘；
- 在没有物理相机或无法接线的现场提前联调前端与训练模型；
- 回归测试相机相关的改动。

## 原理

后端只在 `backend/mvs_sdk.py` 中 `import MvCameraControl_class`。把本目录放到
`PYTHONPATH` 首位，该 import 就会命中本目录的 `MvCameraControl_class.py`
替身（drop-in 替代），后端由此认为自己连上了真实海康相机。**系统代码零改动。**

替身按真实 SDK 的 ctypes 结构（`MV_FRAME_OUT` / `MV_CC_PIXEL_CONVERT_PARAM`
的 `pBufAddr`/`pSrcData`/`pDstBuffer` 均为 `POINTER(c_ubyte)`）实现，后端
`mvs_acquisition.py` 的抓帧/像素转换代码原样执行。

每台模拟相机按固定间隔（模拟一次传感器触发）从图片池取出一帧，图片默认来自
`data/images`（反的/正的 产品照片），因此推理结果返回真实类别名；多相机起点
不同，画面有区分度。

## 启动

```bash
cd E:/Document/自动识别
FAKE_CAMERA_COUNT=4 FAKE_CAMERA_INTERVAL_MS=2000 PYTHONPATH=simulator .venv/Scripts/python.exe -m backend
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FAKE_CAMERA_COUNT` | `4` | 模拟相机台数（1–16，建议 ≥ 线体数） |
| `FAKE_CAMERA_INTERVAL_MS` | `2000` | 触发间隔（毫秒/帧）。做吞吐/压力测试时可设很小（如 `10`=目标 100fps）以把系统压到处理上限 |
| `FAKE_CAMERA_IMAGE_DIR` | `data/images` | 帧图库目录（按子目录循环）；为空时生成渐变占位帧 |

启动后日志会打印模拟相机清单，IP 依次为 `192.168.10.50..65`、序列号
`FAKESIM-0001..`。

## 使用

1. 启动模拟后端（见上），另开终端启动前端：`cd view && npm run web:dev`。
2. 浏览器打开 `http://127.0.0.1:5173`，登录。
3. 在「设置 → 相机」或相机卡片「配置」中，把需要启用的相机 IP 填成对应的
   模拟 IP（如相机 1 → `192.168.10.50`）并启用。
4. 回「运行」页点 **启动**。相机卡片应开始显示模拟画面、类别与置信度，统计
   递增；打开对应相机的「保存放行/剔除照片」后照片会按类别存到
   `data/captures/camN/<类别>/`。

> 提示：模拟帧按 `FAKE_CAMERA_INTERVAL_MS` 节奏触发，间隔越短画面更新越快，
> 同时推理/存盘越频繁。

## 一键恢复

退出模拟后端（Ctrl+C 或结束进程）后，按正常方式启动即恢复真实相机：

```bash
.venv/Scripts/python.exe -m backend
```

测试期间写入的相机配置/照片属于运行时数据（`data/` 已被 gitignore），如需还原
相机 IP，在页面改回或删除 `data/camera_config.json` 重新配置即可。

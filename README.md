# 视觉检测系统 V2.0

基于深度学习的工业产品类别方向自动识别系统。使用海康工业相机拍照，MobileNetV3-Large 模型实时推理，PLC 按用户配置的剔除类别执行剔除。

> 当前文档对应 `main` 分支从 `3e5ff5a`（修复 CPU GPU 设备选择显示）到 `df76adf`（移除读取图片耗时统计）这一串提交后的状态。

## 架构概览

```
┌──────────────────────────────────┐
│   Electron 桌面应用 (React/TS)    │
│   view/ — Vite + Tailwind CSS    │
└──────────────┬───────────────────┘
               │ HTTP (Flask :5000)
┌──────────────▼───────────────────┐
│   Python 后端 (backend/)         │
│   Flask API + PyTorch 推理       │
│   海康 MVS 相机驱动 + PLC 控制    │
└──────────────┬───────────────────┘
               │ GigE Vision
┌──────────────▼───────────────────┐
│   1–16× 海康 GigE 工业相机 (外触发)│
│   PLC (LECPServer, 剔除控制)      │
└──────────────────────────────────┘
```

## 环境要求

- **Windows 10/11 64位**
- Python 3.9+ (推荐 3.12)
- Node.js 18+
- 海康 MVS SDK（安装在 `C:\Program Files (x86)\MVS`）
- 可选：NVIDIA GPU + CUDA（CPU 也能跑；训练和推理设备可分别选择）
- 局域网 Web 模式：后端电脑与访问端处于同一局域网，开放 TCP 5000/5173 端口

## 快速开始（开发模式）

```powershell
# 1. 克隆项目
cd 自动识别

# 2. 创建虚拟环境并安装依赖
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install flask flask-cors pillow torch torchvision

# 3. 启动后端
python -m backend.server

# 4. 另一个终端，启动前端
cd view
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`（Vite 开发服务器），或使用 Electron：

```powershell
cd view
npm run electron:dev
```

局域网 Web 访问（在后端电脑执行）：

```powershell
cd view
npm run web:dev
# 其他设备浏览器访问 http://<后端电脑IP>:5173
```

Web 模式下，训练和测试图片必须位于后端电脑；在页面中使用“选择后端目录”。Electron 模式仍可使用“选择本地目录”。

## 打包发布

```powershell
.\build_portable.ps1
```

输出到 `releases/视觉检测系统_免安装版/`，包含：
- `视觉检测系统.exe` — Electron 前端
- `resources/backend/backend.exe` — Flask 后端（PyInstaller 打包）
- `启动系统.bat` — 一键启动脚本

## 本轮功能更新

- **多类别训练与推理**：训练目录不再限定为两类，类别根目录下每个包含图片的子目录都会成为一个类别；模型旁保存同名 JSON 元数据，推理、测试和统计使用真实类别名称。
- **独立 PLC 配置**：顶部新增“PLC”页面，可编辑启用开关、服务地址、代理地址、节点前缀、超时、剔除类别和每个相机的时间/信号节点，并可直接发送测试写入。
- **内置说明书**：顶部问号按钮打开“说明书”页面，包含启动、训练、PLC、测试和历史照片操作说明。
- **用户自定义名称**：产品型号和线体名称均可在前端编辑，显示名称与后端模型/配置标识分离保存。
- **打包后网页访问**：免安装版启动后，浏览器可访问 `http://127.0.0.1:5173`；局域网设备可使用后端电脑 IP 访问。

### 多类别训练目录示例

```text
数据集/
├── 合格品/
├── 划痕/
├── 缺角/
└── 污渍/
```

训练和分类测试时选择“数据集”根目录，系统会读取所有类别子目录；类别名称就是子目录名称。

### PLC 独立配置接口

- `GET /api/plc/config`：读取当前 PLC 配置。
- `POST /api/plc/config`：保存启用开关、地址、节点、超时、剔除类别和相机映射。
- `POST /api/plc/test`：按相机和写入类型测试时间参数或剔除信号。

PLC 配置默认保存在 `data/plc_config.json`，不再要求把服务地址写在相机设置页面。
## 目录结构

```
├── backend/                 # Python 后端
│   ├── server.py            # Flask API 路由
│   ├── config.py            # 全局配置
│   ├── training.py          # MobileNetV3-Large 模型训练
│   ├── inference_worker.py  # 推理队列
│   ├── mvs_camera.py        # 海康 MVS 相机驱动
│   ├── mock_camera.py       # 模拟相机（测试用）
│   ├── plc_service.py       # PLC 剔除信号
│   ├── camera_config_manager.py  # 相机参数持久化
│   ├── env_check.py         # 启动环境检测
│   └── logger.py            # 日志系统
├── view/                    # Electron + React 前端
│   ├── main.cjs             # Electron 主进程
│   ├── js/preload.js        # 安全桥接
│   └── src/                 # React 源码
│       ├── components/      # UI 组件
│       ├── services/        # API 客户端 & 存储
│       ├── store/           # Zustand 状态管理
│       └── hooks/           # 自定义 Hooks
├── data/                    # 运行时数据（可通过 VISION_DATA_DIR 指定）
│   ├── camera_config.json   # 相机参数
│   ├── line_count.json       # 运行线体数量（1–16）
│   ├── device_config.json    # 训练/推理 CPU/GPU 选择
│   ├── captures/             # 按相机和任意类别目录保存的检测照片
│   └── model_classifier_*.pth  # 训练好的模型
├── test/                    # 测试图片
│   ├── <类别1>/                # 用户自定义类别样本
│   └── <类别2>/                # 可继续增加更多类别
├── build_portable.ps1       # 一键打包脚本
├── backend.spec             # PyInstaller 配置
└── requirements.txt         # Python 依赖
```

## 核心功能

### 本轮提交更新

- **设备选择**：顶部栏分别显示并保存训练设备、推理设备；CPU 始终可选，检测到 CUDA 时显示 GPU，选择器不再依赖不完整的硬件名称信息。
- **动态线体与 CAM**：支持 1–16 条线体，设置页保存后同步运行页 CAM 数量、帧轮询和相机配置入口；启动时以后端线体数量为准。
- **运行页布局**：提供自适应网格、单列大图、双列标准、三列紧凑、四列总览、主视图 + 缩略图和自定义布局；CAM 卡片可拖拽交换，自定义布局支持独立缩放，布局持久化保存。
- **启动异常提示**：环境检测、后端连接和相机连接异常会弹出报警，并以闪红提示提醒处理。
- **模型性能**：服务启动时预加载并预热已训练模型；高分辨率图片先用 BOX 方式快速下采样，再用 LANCZOS 完成模型输入缩放。
- **Web 与目录访问**：支持局域网浏览器访问；训练/测试可选择后端电脑上的图片目录，同时保留 Electron 本地目录选择。
- **测试计时口径**：测试复用真实异步推理和异步写盘链路；展示单张完整处理、流水线总耗时及分层步骤，已移除测试启动准备和读取图片本身的耗时。

- **1–16 路相机实时检测** — 默认 4 路，硬件触发拍照，实时显示画面和检测结果
- **AI 模型训练** — 选择类别根目录（下面可包含任意数量的类别子目录），训练前校验路径并自动加载模型
- **CPU/GPU 分离选择** — 训练和推理设备分别配置并持久化，CUDA 可用时显示 GPU
- **CAM 布局管理** — 多种预置布局、自定义布局、拖拽交换、位置动画和卡片缩放
- **PLC 自动剔除** — 在独立 PLC 页面编辑地址、节点和剔除类别后写入 PLC 寄存器
- **历史照片管理** — 按相机和任意类别/未分类目录保存，支持预览、下载和保存开关
- **模型测试** — 分类测试与批量推理，展示真实异步链路的分层延迟，不统计读取图片本身的耗时
- **Web 与桌面双模式** — 支持局域网浏览器访问；Web 使用后端目录选择，Electron 可选择本地目录
- **三级权限** — 管理员（全部权限）/ 技术员（配置权限）/ 操作员（启停权限）
- **环境检测与报警** — 启动时检测 MVS、Python、网络和相机状态，异常弹窗并闪红提示

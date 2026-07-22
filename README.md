# 视觉检测系统 V2.0

基于深度学习的工业罐子正反方向自动识别系统。使用海康工业相机拍照，MobileNetV3-Large 模型实时推理，PLC 自动剔除倒罐。

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
│   4× 海康 GigE 工业相机 (外触发)  │
│   PLC (LECPServer, 剔除控制)      │
└──────────────────────────────────┘
```

## 环境要求

- **Windows 10/11 64位**
- Python 3.9+ (推荐 3.12)
- Node.js 18+
- 海康 MVS SDK（安装在 `C:\Program Files (x86)\MVS`）
- 可选：NVIDIA GPU + CUDA（CPU 也能跑，但推理更慢）

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

## 打包发布

```powershell
.\build_portable.ps1
```

输出到 `releases/视觉检测系统_免安装版/`，包含：
- `视觉检测系统.exe` — Electron 前端
- `resources/backend/backend.exe` — Flask 后端（PyInstaller 打包）
- `启动系统.bat` — 一键启动脚本

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
├── data/                    # 运行时数据
│   ├── camera_config.json   # 相机参数
│   └── jar_classifier_*.pth # 训练好的模型
├── test/                    # 测试图片
│   ├── 正/                  # 正罐样本
│   └── 反/                  # 倒罐样本
├── build_portable.ps1       # 一键打包脚本
├── backend.spec             # PyInstaller 配置
└── requirements.txt         # Python 依赖
```

## 核心功能

- **4 路相机实时检测** — 硬件触发拍照，实时显示画面和检测结果
- **AI 模型训练** — 标注图片 → 一键训练 → 自动加载，支持多产品型号
- **PLC 自动剔除** — 倒罐自动写 PLC 寄存器触发剔除
- **历史照片管理** — 按相机、正/反分类保存，支持预览和下载
- **三级权限** — 管理员（全部权限）/ 技术员（配置权限）/ 操作员（启停权限）
- **环境检测** — 启动时自动检测 MVS SDK、Python 环境

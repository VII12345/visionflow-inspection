# 视界智检 V2.0

## 这是什么

系统由三个部分组成：

| 部分              | 作用                                               |
| ----------------- | -------------------------------------------------- |
| React + Vite 前端 | 提供运行监控、配置、训练、测试、PLC 和用户管理页面 |
| Flask 后端        | 管理相机、推理队列、模型训练、照片保存和 PLC 调用  |
| Tauri 桌面端      | 将前端和打包后的后端封装为 Windows 桌面应用        |

## 主要能力

- 多相机/多线体实时检测，支持 1–16 条线体配置；
- 海康 MVS 工业相机接入和触发参数配置；
- 基于 MobileNetV3-Large 的多类别图像分类；
- 训练、停止训练、训练历史、模型测试和推理耗时明细；
- 好品/坏品照片保存、历史查看和自动清理；
- PLC 地址、节点和剔除信号配置与测试；
- 管理员、技术员、操作员三级权限；
- CPU-only 便携版、CPU-only NSIS 安装包和完整依赖版本。

## 快速开始

### 1. 准备环境

- Windows 10/11
- Python 3.9+
- Node.js 18+
- npm
- PyTorch、torchvision
- 接入真实相机时安装海康 MVS SDK

### 2. 安装依赖

在项目根目录执行：

```powershell
py -3.9 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

根据目标设备单独安装 CPU 或 CUDA 版本的 PyTorch/torchvision。

### 3. 启动后端

```powershell
python -m backend
```

后端默认监听 `http://127.0.0.1:5000`。

### 4. 启动前端

另开一个终端：

```powershell
cd view
npm ci
npm run web:dev
```

浏览器访问：<http://127.0.0.1:5173>

Vite 会将 `/api` 请求代理到 `http://127.0.0.1:5000`。如后端地址不同，可在 `view/.env.local` 中设置 `VITE_BACKEND_URL`。

## Windows 发布

### CPU-only 便携版

```powershell
.\build_portable_tauri.ps1
```

输出到：`releases/视界智检_Tauri_CPU_免安装版/`

### CPU-only 安装包

```powershell
.\build_installer_cpu.ps1
```

### 完整依赖版本

```powershell
.\build_portable_tauri_full.ps1
.\build_installer_tauri_full.ps1
```

如果网络环境需要代理，构建脚本支持：

```powershell
.\build_portable_tauri.ps1 -Proxy http://127.0.0.1:10808
```

## 文档导航

| 文档                                     | 面向对象               | 内容                                      |
| ---------------------------------------- | ---------------------- | ----------------------------------------- |
| [用户使用说明书](docs/用户使用说明书.md) | 操作员、技术员、管理员 | 安装、配置、运行、训练、PLC、故障排查     |
| [项目详细文档](docs/项目详细文档.md)     | 开发者、部署人员       | 架构、代码模块、API、数据目录、构建和发布 |

## 仓库结构

```text
backend/                  Flask 后端、相机、推理、训练和 PLC
view/src/                 React 页面、组件、状态和 API 服务
view/src-tauri/           Tauri 桌面端和本地数据命令
docs/                     用户手册和技术文档
data/                     运行时数据，默认不提交
build_*.ps1               Windows 构建脚本
requirements.txt          基础 Python 依赖
```

## 训练数据格式

训练时选择一个类别根目录，每个子目录代表一个类别：

```text
数据集/
├─ 合格品/
│  ├─ 001.jpg
│  └─ 002.jpg
├─ 划痕/
│  └─ 001.jpg
└─ 缺角/
   └─ 001.jpg
```

类别目录名称会成为模型输出标签。详细训练流程请查看[用户使用说明书](docs/用户使用说明书.md)和[项目详细文档](docs/项目详细文档.md)。

## 发布前检查

- 不提交 `data/`、现场图片、模型文件、PLC 地址、日志和账号密码；
- 不提交 `.venv/`、`.venv_cpu/`、`view/node_modules/` 和构建产物；
- 确认海康 MVS SDK、PyTorch、模型权重和第三方资源的许可证；
- 正式开源前在根目录补充 `LICENSE` 文件；
- 执行 `npm run build` 和 `git diff --check`。

## 许可证

前端 Tauri 配置声明为 MIT。正式发布前请补充完整的根目录 `LICENSE`，并核对全部第三方组件和模型资源的许可范围。


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
- 模型重命名、删除与删除保护（检查产品/线体引用）；
- 好品/坏品照片保存、历史查看、分页筛选、批量导出 Zip、CSV 报表和良率趋势；
- PLC 地址、节点和剔除信号配置与测试；
- 管理员、技术员、操作员三级权限；
- 可选后端登录鉴权（`VISION_AUTH_ENABLED`，默认关闭），密码使用哈希存储；
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
python -m pip install -r requirements-cpu.txt
```

CPU 开发环境使用 `requirements-cpu.txt`；GPU 开发环境使用 `requirements-gpu.txt`，并确保 PyTorch/torchvision 与本机 CUDA 环境匹配。

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
  ├─ server.py             Flask 应用与 API 路由
  ├─ server_bootstrap.py   启动编排（环境检测/预加载/清理线程）
  ├─ camera_run_service.py 相机启动、停止与工作线程
  ├─ camera_routes.py      相机配置与运行 API
  ├─ catalog_routes.py     产品/线体配置 API
  ├─ catalog_repository.py 产品与线体配置持久化
  ├─ auth_routes.py        登录鉴权与 token（可选）
  ├─ model_repository.py   模型元数据、删除/重命名与删除保护
  ├─ model_routes.py       模型列表/设置/删除/重命名 API
  ├─ photo_routes.py       照片保存、分页筛选、导出、报表与趋势
  ├─ training_routes.py    模型训练接口
  ├─ model_test_routes.py  离线模型测试接口
  ├─ inference_worker.py   推理队列
  ├─ model_loader.py       模型加载与缓存
  ├─ plc_service.py        PLC 服务聚合（plc_config/plc_client）
  ├─ capture_service.py    照片保存服务聚合（photo_storage/save_queue）
  ├─ user_repository.py    用户存储与密码哈希
  ├─ hardware/             硬件采集器
  └─ env_checkers/         环境类别检查器
view/src/                 React 页面、组件、状态和 API 服务
view/src-tauri/           Tauri 桌面端和本地数据命令
docs/                     用户手册和技术文档
data/                     运行时数据，默认不提交
build_*.ps1               Windows 构建脚本
requirements.txt          通用 Python 运行依赖
requirements-cpu.txt      CPU + AI 依赖
requirements-gpu.txt      GPU + AI 依赖
```

> 登录：首次启动后端会在 `data/users.json` 初始化默认管理员，初始密码随机生成并打印在后端启动日志中，请登录后立即修改。默认不启用后端鉴权（`VISION_AUTH_ENABLED=0`），需要局域网无鉴权部署时保持不变即可。

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


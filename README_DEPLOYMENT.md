# 视觉检测系统 - 快速启动指南

## Windows 环境部署

### 1. 环境准备

```powershell
# 检查 Python 版本（需要 3.10+）
python --version

# 检查 Node.js（需要 16+）
node --version

# 检查 MVS SDK 是否已安装
dir "C:\Program Files (x86)\MVS"
```

### 2. 安装依赖

```powershell
# 进入项目目录
cd C:\path\to\shibie

# 创建 Python 虚拟环境
python -m venv .venv
.venv\Scripts\activate

# 安装 Python 依赖
pip install flask flask-cors pillow torch torchvision

# 安装 Node 依赖
cd view
npm install
cd ..
```

### 3. 启动系统

**方式 1：启动 Electron（推荐）**
```powershell
cd view
npm start
```
Electron 会自动启动 Python 后端。

**方式 2：分别启动（调试用）**
```powershell
# 终端 1：启动后端
python -m backend.server

# 终端 2：启动前端
cd view
npm start
```

### 4. 使用系统

1. 打开 Electron 窗口
2. 点击"登录"按钮
3. 使用默认账号登录：
   - 管理员：`admin` / `admin`
   - 技术员：`tech1` / `tech1`
   - 操作员：`op1` / `op1`
4. 切换到"运行"标签页
5. 点击"启动"按钮
6. 观察 4 个相机的实时检测结果

### 5. 验证功能

- [x] 4 个相机卡片显示实时图片
- [x] 检测结果显示"正"或"反"
- [x] 置信度显示百分比
- [x] 统计数据正确累加
- [x] 点击"详情"查看单相机详细信息

---

## 故障排查

### 后端无法启动

**症状：** Electron 启动后提示"后端启动超时"

**检查步骤：**
1. 手动启动后端：`python -m backend.server`
2. 查看错误日志：`data/vision_system.log`
3. 确认端口 5000 未被占用：`netstat -ano | findstr :5000`

**常见问题：**
- Python 版本过低：升级到 3.10+
- 依赖未安装：`pip install -r requirements.txt`
- 端口被占用：修改 `backend/config.py` 中的 `FLASK_PORT`

### 相机无法连接（使用真实相机时）

**症状：** 启动后相机状态显示"disconnected"

**检查步骤：**
1. 确认 MVS SDK 已安装
2. 设置环境变量：`$env:MVCAM_COMMON_RUNENV="C:\Program Files (x86)\MVS"`
3. 运行 MVS SDK 自带的测试工具验证相机
4. 查看后端日志：`data/vision_system.log`

### 检测结果不准确

**症状：** 检测结果错误率高

**解决方案：**
1. 检查模型文件：`jar_classifier.pth` 是否存在
2. 重新训练模型（设置页 → AI 学习）
3. 检查相机光照条件
4. 调整相机参数（设置页 → 相机配置）

---

## 系统架构

```
┌─────────────────────┐
│  Electron GUI       │  ← 用户界面
│  (localhost)        │
└──────────┬──────────┘
           │ HTTP
           ↓
┌─────────────────────┐
│  Python Backend     │  ← Flask 服务
│  (127.0.0.1:5000)   │
└──────────┬──────────┘
           │
     ┌─────┴─────┬──────────┬──────────┐
     ↓           ↓          ↓          ↓
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  Cam 1  │ │  Cam 2  │ │  Cam 3  │ │  Cam 4  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

---

## 开发模式

### 使用模拟相机（当前模式）

系统默认使用 `MockCamera`，会读取 `images/` 目录下的图片模拟相机抓帧。

**优点：**
- 无需真实相机即可开发测试
- 可在 WSL/Linux 环境开发

### 切换到真实相机

修改 `backend/server.py`：

```python
# 当前（模拟）
from .mock_camera import MockCameraManager
camera_manager = MockCameraManager(test_image_dir)

# 改为（真实）
from .mvs_camera import MvsCameraManager  # 待实现
camera_manager = MvsCameraManager()
```

---

## 配置说明

### `backend/config.py`

```python
# 相机配置
CAMERA_COUNT = 4           # 相机数量
CAMERA_FPS_TARGET = 2.0    # 目标帧率

# 推理配置
INFERENCE_QUEUE_SIZE = 20  # 推理队列大小
MODEL_PATH = './jar_classifier.pth'

# 照片管理
MAX_PHOTO_AGE_DAYS = 30            # 保留天数
PHOTO_RETENTION_COUNT = 1000       # 每相机最多保留数
```

### Electron 配置

`view/package.json` - 修改打包配置：

```json
{
  "build": {
    "win": {
      "target": "nsis",
      "icon": "assets/icon.png"
    }
  }
}
```

---

## 常用命令

```powershell
# 后端
python -m backend.server           # 启动后端
python -m pytest tests/            # 运行测试（待添加）

# 前端
cd view
npm start                          # 开发模式
npm run dist:win                   # 打包 Windows 安装包

# 清理
rm -rf data/captures/*             # 清空照片
rm data/vision_system.log          # 清空日志
```

---

## 更多信息

- 详细实施总结：`IMPLEMENTATION_SUMMARY.md`
- 完整计划文档：`.claude/plans/camera-integration-plan-v2.md`
- 后端测试脚本：`test_backend.sh`

---

**版本：** v1.0.0  
**最后更新：** 2026-07-02

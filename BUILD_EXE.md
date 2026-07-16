# 视觉检测系统 - Windows EXE 打包完整指南

## 📦 打包方案

将系统打包为单个 Windows 安装程序，包含：
- Electron GUI（主程序）
- Python 后端（打包为 backend.exe）
- PyTorch 模型和依赖

---

## 🚀 快速打包（一键执行）

```powershell
# 在 Windows PowerShell 中执行
cd C:\path\to\shibie
.\build.ps1
```

打包完成后，安装包位于：`view\release\视觉检测系统-Setup-1.0.0.exe`

---

## 📋 详细步骤

### Step 1: 环境准备

```powershell
# 1. 检查环境
python --version    # 需要 3.10+
node --version      # 需要 16+
npm --version

# 2. 进入项目
cd C:\path\to\shibie

# 3. 安装 Python 依赖
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install flask flask-cors pillow torch torchvision pyinstaller

# 4. 安装 Node 依赖
cd view
npm install
npm install electron-builder --save-dev
cd ..
```

---

### Step 2: 打包 Python 后端

```powershell
# 使用 PyInstaller 打包
pyinstaller backend.spec --clean

# 验证生成的 exe
dir dist\backend.exe
.\dist\backend.exe  # 测试启动（按 Ctrl+C 停止）
```

**生成文件：** `dist/backend.exe` (约 400-600 MB，包含 PyTorch)

---

### Step 3: 复制后端到 Electron 资源目录

```powershell
# 创建资源目录
New-Item -Path "view\resources\backend" -ItemType Directory -Force

# 复制后端 exe
Copy-Item "dist\backend.exe" -Destination "view\resources\backend\"

# 复制模型文件
Copy-Item "jar_classifier.pth" -Destination "view\resources\"

# 复制测试图片（用于 MockCamera）
Copy-Item "images\" -Destination "view\resources\images\" -Recurse
```

---

### Step 4: 配置 Electron 打包

修改 `view/package.json`：

```json
{
  "name": "vision-inspection-system",
  "version": "1.0.0",
  "description": "视觉检测系统 V1.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --dir",
    "dist": "electron-builder",
    "dist:win": "electron-builder --win"
  },
  "build": {
    "appId": "com.vision.inspection",
    "productName": "视觉检测系统",
    "directories": {
      "output": "release"
    },
    "files": [
      "main.js",
      "index.html",
      "css/**/*",
      "js/**/*",
      "assets/**/*"
    ],
    "extraResources": [
      {
        "from": "resources/backend",
        "to": "backend"
      },
      {
        "from": "../jar_classifier.pth",
        "to": "jar_classifier.pth"
      },
      {
        "from": "../images",
        "to": "images"
      }
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "assets/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "视觉检测系统",
      "language": "2052",
      "installerIcon": "assets/icon.png",
      "uninstallerIcon": "assets/icon.png"
    }
  }
}
```

---

### Step 5: 打包 Electron

```powershell
cd view
npm run dist:win
```

**等待打包完成**（约 5-10 分钟）

**生成文件：**
- `view/release/视觉检测系统-Setup-1.0.0.exe` - 安装程序
- `view/release/视觉检测系统-1.0.0-win.zip` - 便携版

---

## 📂 最终目录结构

```
安装后目录 (C:\Users\用户名\AppData\Local\视觉检测系统\)
├── 视觉检测系统.exe         # 主程序
├── resources/
│   ├── app.asar              # 前端代码
│   ├── backend/
│   │   └── backend.exe       # Python 后端
│   ├── jar_classifier.pth    # ML 模型
│   └── images/               # 测试图片
└── data/                     # 用户数据（首次运行创建）
    ├── captures/
    │   ├── cam1/
    │   ├── cam2/
    │   ├── cam3/
    │   └── cam4/
    └── vision_system.log
```

---

## 🔧 main.js 自动检测开发/生产模式

已修改的 `view/main.js` 会自动检测：

```javascript
async function startBackend() {
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // 开发模式：python -m backend.server
    backendPath = 'python';
    backendArgs = ['-m', 'backend.server'];
  } else {
    // 生产模式：运行打包的 exe
    backendPath = path.join(process.resourcesPath, 'backend', 'backend.exe');
    backendArgs = [];
  }
  
  backendProcess = spawn(backendPath, backendArgs, ...);
}
```

---

## ✅ 验证打包结果

### 1. 测试安装程序

```powershell
# 运行安装程序
.\view\release\视觉检测系统-Setup-1.0.0.exe

# 安装后启动
# 桌面快捷方式 → 视觉检测系统
```

### 2. 检查后端是否启动

- 打开系统后，检查任务管理器
- 应该看到两个进程：
  - `视觉检测系统.exe` (Electron)
  - `backend.exe` (Python 后端)

### 3. 测试功能

1. 点击"登录"（admin/admin）
2. 切换到"运行"标签页
3. 点击"启动"按钮
4. 观察 4 个相机卡片是否显示图片和检测结果

---

## 📏 文件大小估算

| 组件 | 大小 |
|---|---|
| backend.exe (含 PyTorch) | ~500 MB |
| Electron 主程序 | ~150 MB |
| 模型文件 (.pth) | ~10 MB |
| 测试图片 | ~5 MB |
| **总安装包大小** | **~650-700 MB** |

---

## 🐛 常见问题

### 1. PyInstaller 打包失败

**错误：** `ModuleNotFoundError: No module named 'torch'`

**解决：**
```powershell
pip install torch torchvision --force-reinstall
pyinstaller backend.spec --clean
```

### 2. 后端 exe 启动失败

**症状：** Electron 启动后提示"后端启动超时"

**检查：**
```powershell
# 手动测试后端 exe
cd view\resources\backend
.\backend.exe
# 应该显示 "Running on http://127.0.0.1:5000"
```

**可能原因：**
- 缺少 DLL 依赖（安装 VC++ Redistributable）
- 防火墙阻止
- 端口 5000 被占用

### 3. 安装包过大

**优化方案：**

1. **使用 UPX 压缩**（已在 backend.spec 中启用）
2. **排除不需要的 torch 模块**：
   ```python
   # backend.spec
   excludes=[
       'torch.distributions',
       'torch.testing',
       'torchvision.datasets',
   ]
   ```
3. **使用在线安装器**（NSIS 配置）

### 4. 模型文件未包含

**症状：** 后端启动但推理失败

**检查：**
```powershell
# 查看资源目录
dir "C:\Users\<用户名>\AppData\Local\视觉检测系统\resources\"
# 应该有 jar_classifier.pth
```

**解决：** 确认 `package.json` 的 `extraResources` 配置正确

---

## 🎯 生产环境优化

### 1. 关闭后端控制台窗口

修改 `backend.spec`：

```python
exe = EXE(
    ...
    console=False,  # 改为 False，不显示控制台
    ...
)
```

### 2. 添加代码签名

```powershell
# 需要购买代码签名证书
# 在 package.json 添加：
"win": {
  "certificateFile": "cert.pfx",
  "certificatePassword": "密码"
}
```

### 3. 添加自动更新

```bash
npm install electron-updater
```

---

## 📦 分发方式

### 方式 1：单文件安装器（推荐）

```
视觉检测系统-Setup-1.0.0.exe  (~650 MB)
```

用户双击安装，自动创建桌面快捷方式。

### 方式 2：便携版

```
视觉检测系统-1.0.0-win.zip
```

解压后直接运行 `视觉检测系统.exe`。

### 方式 3：网络安装器

使用 NSIS Web 模式，只下载必要文件：

```json
"nsis": {
  "oneClick": true,
  "perMachine": false,
  "allowToChangeInstallationDirectory": false
}
```

---

## 📊 完整打包清单

- [x] 创建 `backend.spec` (PyInstaller 配置)
- [x] 创建 `build.ps1` (自动化打包脚本)
- [x] 修改 `view/main.js` (自动检测开发/生产模式)
- [x] 修改 `view/package.json` (Electron 打包配置)
- [x] 创建打包文档 `BUILD_EXE.md`

---

## 🚀 一键打包（最终版）

```powershell
# 1. 克隆项目或复制到 Windows
git clone <项目地址> C:\shibie
cd C:\shibie

# 2. 执行自动化打包
.\build.ps1

# 3. 等待完成（约 10-15 分钟）
# 安装包位置：view\release\视觉检测系统-Setup-1.0.0.exe
```

---

**打包完成后，只需分发 `视觉检测系统-Setup-1.0.0.exe`，用户双击安装即可使用！**

---

## 📞 技术支持

如遇到打包问题：
1. 查看打包日志：`view\release\builder-debug.log`
2. 查看后端日志：`data\vision_system.log`
3. 检查系统要求：Windows 10/11 64位

---

**版本：** v1.0.0  
**更新：** 2026-07-02

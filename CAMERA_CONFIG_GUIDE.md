# 相机IP配置功能使用指南

## 📋 功能概述

系统现已支持通过前端界面配置相机IP地址，配置会自动保存到本地文件，下次启动无需重新配置。

---

## ✨ 新增功能

### 1. 相机IP地址配置
- 每个相机可以单独配置IP地址
- 支持启用/禁用相机
- 配置自动保存到 `data/camera_config.json`
- 下次打开自动加载上次配置

### 2. 移除模拟相机模式
- 系统现在只使用真实MVS相机
- 简化了配置流程

### 3. 智能启动逻辑
- 只启动已启用且配置了IP的相机
- 根据IP地址自动匹配物理相机
- 启动失败会显示详细错误信息

---

## 🎯 使用步骤

### 步骤1：配置相机IP地址

1. **启动前端应用**
   ```bash
   # 进入view目录
   cd view
   
   # 启动Electron应用
   npm start
   ```

2. **登录系统**
   - 使用技术员或管理员账户登录
   - 操作员权限不能修改相机配置

3. **打开相机设置**
   - 点击顶部 **"设置"** 标签页
   - 在"相机参数设置"区域，点击对应的相机按钮（如 **Cam1 设置**）

4. **配置相机参数**
   
   在弹出的配置窗口中：
   
   | 配置项 | 说明 | 示例 |
   |--------|------|------|
   | **启用相机** | 勾选后系统启动时会连接此相机 | ☑ 启用 |
   | **相机名称** | 自定义相机名称 | Cam1 |
   | **相机IP地址** | 相机的IP地址（必填） | 192.168.1.50 |
   | 触发延时 | 触发信号延时（毫秒） | 100 |
   | 剔除延时 | 剔除动作延时（毫秒） | 200 |
   | 剔除时间 | 剔除动作持续时间（毫秒） | 300 |

5. **保存配置**
   - 点击 **"保存"** 按钮
   - 系统会提示"Cam1 配置已保存"
   - 配置立即保存到 `data/camera_config.json`

6. **配置其他相机**
   - 重复步骤3-5，配置 Cam2、Cam3、Cam4
   - 可以只配置需要使用的相机

### 步骤2：启动后端服务

```bash
# 确保在项目根目录
cd C:\Users\28689\Desktop\新建文件夹

# 设置编码
$env:PYTHONIOENCODING = 'utf-8'

# 启动后端
python -m backend
```

**后端会自动**：
- 加载 `data/camera_config.json` 配置
- 显示加载的相机数量
- 等待前端启动指令

### 步骤3：启动系统

在前端界面：

1. 点击 **"运行"** 标签页
2. 点击 **"▶ 启动"** 按钮
3. 系统会：
   - 读取相机配置
   - 枚举网络上的所有相机
   - 根据配置的IP地址匹配并连接相机
   - 显示启动结果

**启动成功示例**：
```
系统启动成功，启动了 1/1 个相机
```

**部分失败示例**：
```
系统启动成功，启动了 2/3 个相机，1 个相机启动失败
- Cam3 未找到IP为 192.168.1.52 的相机
```

---

## 📊 配置文件格式

配置保存在 `data/camera_config.json`：

```json
{
  "cameras": {
    "1": {
      "enabled": true,
      "ip": "192.168.1.50",
      "name": "Cam1",
      "triggerDelay": 100,
      "rejectDelay": 200,
      "rejectTime": 300
    },
    "2": {
      "enabled": false,
      "ip": "",
      "name": "Cam2",
      "triggerDelay": 0,
      "rejectDelay": 0,
      "rejectTime": 0
    },
    "3": {
      "enabled": false,
      "ip": "",
      "name": "Cam3",
      "triggerDelay": 0,
      "rejectDelay": 0,
      "rejectTime": 0
    },
    "4": {
      "enabled": false,
      "ip": "",
      "name": "Cam4",
      "triggerDelay": 0,
      "rejectDelay": 0,
      "rejectTime": 0
    }
  }
}
```

---

## 🔧 API接口文档

### 获取所有相机配置

```http
GET /api/cameras/config
```

**响应**：
```json
{
  "success": true,
  "config": {
    "cameras": { ... }
  }
}
```

### 获取单个相机配置

```http
GET /api/cameras/config/1
```

**响应**：
```json
{
  "success": true,
  "config": {
    "enabled": true,
    "ip": "192.168.1.50",
    "name": "Cam1",
    "triggerDelay": 100,
    "rejectDelay": 200,
    "rejectTime": 300
  }
}
```

### 更新相机配置

```http
POST /api/cameras/config/1
Content-Type: application/json

{
  "enabled": true,
  "ip": "192.168.1.50",
  "name": "Cam1",
  "triggerDelay": 100,
  "rejectDelay": 200,
  "rejectTime": 300
}
```

**响应**：
```json
{
  "success": true,
  "message": "Cam1 配置已保存"
}
```

---

## ⚙️ 后端实现细节

### 新增文件

1. **`backend/camera_config_manager.py`** - 相机配置管理器
   - 负责加载/保存配置文件
   - 提供配置查询接口
   - 自动创建默认配置

### 修改文件

1. **`backend/config.py`**
   - 移除 `USE_REAL_CAMERA` 配置项
   - 添加 `CAMERA_CONFIG_FILE` 路径配置

2. **`backend/server.py`**
   - 移除 MockCamera 相关代码
   - 集成 `camera_config_manager`
   - 修改启动逻辑：根据配置的IP地址连接相机
   - 添加相机配置API端点：
     - `GET /api/cameras/config` - 获取所有配置
     - `GET /api/cameras/config/<id>` - 获取单个配置
     - `POST /api/cameras/config/<id>` - 更新配置

3. **`backend/mvs_camera.py`**
   - 保持不变，提供MVS相机驱动

### 启动流程

```
1. 加载相机配置 (camera_config.json)
   ↓
2. 获取启用的相机列表 (enabled=true && ip!="")
   ↓
3. 枚举所有物理相机
   ↓
4. 根据IP地址匹配相机
   ↓
5. 连接并启动匹配的相机
   ↓
6. 返回启动结果
```

---

## 🎨 前端实现细节

### 修改文件

1. **`view/js/camera-config.js`**
   - 添加异步加载配置功能
   - 添加IP地址输入和验证
   - 添加启用/禁用复选框
   - 通过API保存配置到后端

2. **`view/index.html`**
   - 添加"启用相机"复选框
   - 添加"相机名称"输入框
   - 添加"相机IP地址"输入框
   - 添加输入提示和分隔线

### 配置界面

打开相机设置后，界面显示：

```
┌─────────────────────────────────────┐
│        Cam 1 设置            ×      │
├─────────────────────────────────────┤
│ 启用相机：   ☑                      │
│   勾选后系统启动时会连接此相机       │
│                                     │
│ 相机名称：   [Cam1____________]      │
│                                     │
│ 相机IP地址： [192.168.1.50____]     │
│   请输入相机的IP地址                │
│                                     │
│ ────────────────────────────────    │
│                                     │
│ 触发延时：   [100______] 毫秒       │
│ 剔除延时：   [200______] 毫秒       │
│ 剔除时间：   [300______] 毫秒       │
│                                     │
│        [保存]  [关闭]               │
└─────────────────────────────────────┘
```

---

## ✅ 测试结果

### 配置测试

```powershell
# 1. 配置Cam1
POST /api/cameras/config/1
{
  "enabled": true,
  "ip": "192.168.1.50",
  ...
}

响应: ✓ Cam1 配置已保存
```

### 启动测试

```powershell
# 2. 启动系统
POST /api/start

响应: 
{
  "success": true,
  "message": "系统启动成功，启动了 1/1 个相机",
  "started": 1,
  "total": 1
}
```

### 运行状态

```json
{
  "state": "running",
  "serial": "DB1658349",
  "model": "MV-CS050-10GM",
  "ip": "192.168.1.50",
  "fps": 2.02,
  "result": {
    "label": "反",
    "confidence": 0.96
  }
}
```

---

## 🚨 常见问题

### Q1: 点击"保存"后没有反应？

**原因**：未以技术员或管理员身份登录

**解决**：
1. 点击右上角"登录"
2. 使用技术员或管理员账户登录
3. 重新打开相机设置

### Q2: 启动时提示"没有启用的相机"？

**原因**：所有相机都未启用或未配置IP

**解决**：
1. 打开相机设置
2. 勾选"启用相机"
3. 填写正确的IP地址
4. 保存配置后重新启动

### Q3: 启动时提示"未找到IP为 xxx 的相机"？

**原因**：
- 相机未开机
- IP地址配置错误
- 网络连接问题

**解决**：
1. 检查相机是否开机
2. 使用 `ping 192.168.1.50` 测试网络连接
3. 在MVS客户端中确认相机IP地址
4. 修改配置后重新启动

### Q4: 如何查看当前配置？

**方法1**：通过前端
- 打开相机设置窗口查看

**方法2**：通过API
```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/cameras/config'
```

**方法3**：直接查看文件
```powershell
Get-Content data\camera_config.json
```

---

## 📝 配置示例

### 示例1：单相机配置

```json
{
  "cameras": {
    "1": {
      "enabled": true,
      "ip": "192.168.1.50",
      "name": "主相机",
      "triggerDelay": 100,
      "rejectDelay": 200,
      "rejectTime": 300
    },
    "2": { "enabled": false, ... },
    "3": { "enabled": false, ... },
    "4": { "enabled": false, ... }
  }
}
```

### 示例2：多相机配置

```json
{
  "cameras": {
    "1": {
      "enabled": true,
      "ip": "192.168.1.50",
      "name": "上料相机",
      "triggerDelay": 100,
      "rejectDelay": 200,
      "rejectTime": 300
    },
    "2": {
      "enabled": true,
      "ip": "192.168.1.51",
      "name": "检测相机1",
      "triggerDelay": 150,
      "rejectDelay": 250,
      "rejectTime": 350
    },
    "3": {
      "enabled": true,
      "ip": "192.168.1.52",
      "name": "检测相机2",
      "triggerDelay": 150,
      "rejectDelay": 250,
      "rejectTime": 350
    },
    "4": {
      "enabled": false,
      "ip": "",
      "name": "Cam4",
      ...
    }
  }
}
```

---

## 🎉 总结

### 功能完成度

✅ **已完成**：
- 相机IP地址配置（前端界面）
- 配置自动保存到文件
- 配置自动加载
- 根据配置启动相机
- IP地址验证
- 启用/禁用开关
- 完整的API接口
- 移除模拟相机模式

### 使用流程

1. **配置** → 打开设置 → 配置相机IP → 保存
2. **启动** → 启动后端 → 启动前端 → 点击运行
3. **使用** → 自动连接相机 → 开始检测

### 优势

- ✅ 无需修改代码配置IP
- ✅ 配置持久化，下次自动加载
- ✅ 支持多相机独立配置
- ✅ 启动前验证配置
- ✅ 详细的错误提示

---

**文档更新日期**：2026-07-02  
**版本**：v2.0

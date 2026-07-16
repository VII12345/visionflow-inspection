# 相机IP配置功能 - 修改总结

## 🎯 完成的功能

1. ✅ **移除模拟相机模式** - 系统只使用真实MVS相机
2. ✅ **前端配置界面** - 可视化配置相机IP地址
3. ✅ **配置持久化** - 自动保存到 `data/camera_config.json`
4. ✅ **自动加载配置** - 下次启动无需重新配置
5. ✅ **智能启动** - 根据IP地址自动匹配物理相机

---

## 📁 修改的文件

### 后端 (Backend)

#### 新增文件
1. **`backend/camera_config_manager.py`** ⭐ 新建
   - 相机配置管理器
   - 负责加载/保存配置文件
   - 提供配置查询API

#### 修改文件
2. **`backend/config.py`**
   ```python
   # 删除
   - USE_REAL_CAMERA = True
   
   # 新增
   + CAMERA_CONFIG_FILE = DATA_DIR / 'camera_config.json'
   ```

3. **`backend/server.py`**
   - 删除 MockCamera 导入和相关代码
   - 集成 `camera_config_manager`
   - 修改 `initialize_camera_manager()` - 只初始化真实相机
   - 修改 `start_system()` - 根据配置的IP地址启动相机
   - 新增 API 端点：
     - `GET /api/cameras/config` - 获取所有配置
     - `GET /api/cameras/config/<id>` - 获取单个配置
     - `POST /api/cameras/config/<id>` - 更新配置

### 前端 (View)

4. **`view/js/camera-config.js`**
   - 改写为异步函数（使用 `async/await`）
   - 添加从后端加载配置的功能
   - 添加IP地址验证函数
   - 添加启用/禁用复选框处理
   - 通过API保存配置

5. **`view/index.html`**
   - 在相机设置弹窗中新增：
     - "启用相机"复选框
     - "相机名称"输入框
     - "相机IP地址"输入框
     - 输入提示文本

---

## 🔄 工作流程

### 配置流程
```
用户 → 打开相机设置 → 配置IP → 保存
                              ↓
                    POST /api/cameras/config/1
                              ↓
                  保存到 data/camera_config.json
```

### 启动流程
```
启动后端 → 加载 camera_config.json
              ↓
        获取启用的相机 (enabled=true)
              ↓
        枚举物理相机
              ↓
        根据IP匹配
              ↓
        连接并启动相机
```

---

## 📊 数据结构

### 配置文件格式 (`data/camera_config.json`)

```json
{
  "cameras": {
    "1": {
      "enabled": true,           // 是否启用
      "ip": "192.168.1.50",     // 相机IP地址
      "name": "Cam1",           // 相机名称
      "triggerDelay": 0,        // 触发延时(ms)
      "rejectDelay": 0,         // 剔除延时(ms)
      "rejectTime": 0           // 剔除时间(ms)
    },
    "2": { ... },
    "3": { ... },
    "4": { ... }
  }
}
```

---

## 🧪 测试结果

### ✅ 已测试功能

| 功能 | 测试结果 |
|------|---------|
| 获取配置 (GET) | ✅ 通过 |
| 更新配置 (POST) | ✅ 通过 |
| 配置文件保存 | ✅ 通过 |
| 配置文件加载 | ✅ 通过 |
| 根据IP启动相机 | ✅ 通过 |
| 相机状态查询 | ✅ 通过 |
| 图像抓取 | ✅ 通过 |

### 测试数据

```
相机型号: MV-CS050-10GM
序列号: DB1658349
配置IP: 192.168.1.50
实际IP: 192.168.1.50
启动结果: 成功
FPS: 2.02
图像大小: 229.7 KB
```

---

## 💡 使用说明

### 快速开始

1. **启动后端**
   ```powershell
   $env:PYTHONIOENCODING = 'utf-8'
   python -m backend
   ```

2. **启动前端**
   ```powershell
   cd view
   npm start
   ```

3. **配置相机**
   - 登录（技术员或管理员）
   - 点击"设置"标签页
   - 点击"Cam1 设置"
   - 勾选"启用相机"
   - 输入IP地址：`192.168.1.50`
   - 点击"保存"

4. **启动系统**
   - 点击"运行"标签页
   - 点击"▶ 启动"

---

## 📝 API 文档

### 获取所有配置
```http
GET /api/cameras/config
```

### 获取单个配置
```http
GET /api/cameras/config/1
```

### 更新配置
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

---

## 🔍 关键代码

### 后端 - 启动逻辑

```python
# 获取启用的相机配置
enabled_cameras = camera_config_manager.get_enabled_cameras()

# 枚举物理相机
available_cameras = camera_manager.enumerate_cameras()

# 根据IP匹配并连接
for cam_id, cam_config in enabled_cameras.items():
    target_ip = cam_config['ip']
    
    # 查找匹配IP的相机
    for idx, cam_info in enumerate(available_cameras):
        if cam_info.get('ip') == target_ip:
            # 连接相机
            cam = camera_manager.create_camera(cam_id, idx)
            cam.connect()
            cam.start_grabbing()
```

### 前端 - 保存配置

```javascript
async save() {
  const config = {
    enabled: document.getElementById('camEnabled').checked,
    ip: document.getElementById('camIP').value.trim(),
    name: document.getElementById('camName').value.trim(),
    triggerDelay: parseInt(document.getElementById('camTrigDelay').value) || 0,
    rejectDelay: parseInt(document.getElementById('camRejectDelay').value) || 0,
    rejectTime: parseInt(document.getElementById('camRejectTime').value) || 0
  };

  const response = await fetch(`http://127.0.0.1:5000/api/cameras/config/${this._currentCamId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });

  const data = await response.json();
  if (data.success) {
    App.showMessage(data.message);
  }
}
```

---

## 🎉 完成状态

### ✅ 需求清单

- [x] 移除模拟相机模式
- [x] 前端可视化配置界面
- [x] 支持配置相机IP地址
- [x] 配置持久化保存
- [x] 下次打开自动加载配置
- [x] 根据配置启动相机
- [x] 完整的API接口
- [x] 错误处理和提示
- [x] 配置验证（IP格式）
- [x] 完整的测试验证

### 📋 待扩展功能（可选）

- [ ] 批量配置多个相机
- [ ] 导入/导出配置文件
- [ ] 相机连接测试按钮
- [ ] 实时显示相机在线状态
- [ ] 配置历史记录

---

## 📚 相关文档

- **[CAMERA_CONFIG_GUIDE.md](CAMERA_CONFIG_GUIDE.md)** - 完整使用指南
- **[CAMERA_TEST_REPORT.md](CAMERA_TEST_REPORT.md)** - 摄像头通信测试报告

---

**修改完成时间**：2026-07-02  
**修改人员**：Claude (Kiro AI)

# 快速启动指南

## 🚀 5分钟快速上手

### 第一步：配置相机IP（只需第一次配置）

1. **启动后端服务**
   ```powershell
   $env:PYTHONIOENCODING = 'utf-8'
   python -m backend
   ```

2. **启动前端应用**
   ```powershell
   cd view
   npm start
   ```

3. **配置相机**
   
   在前端界面：
   - 点击右上角 **"登录"** → 使用技术员或管理员账户
   - 点击顶部 **"设置"** 标签页
   - 点击 **"Cam1 设置"** 按钮
   - 在弹窗中配置：
     - ☑ **启用相机**（勾选）
     - **相机IP地址**：`192.168.1.50`（填写实际IP）
     - 其他参数保持默认
   - 点击 **"保存"**
   
   > 💡 如果有多台相机，重复配置 Cam2、Cam3、Cam4

### 第二步：启动系统

1. 点击 **"运行"** 标签页
2. 点击 **"▶ 启动"** 按钮
3. 等待系统连接相机（约2-3秒）
4. 看到相机画面，开始检测！

---

## 📋 配置文件示例

配置会保存到 `data/camera_config.json`：

```json
{
  "cameras": {
    "1": {
      "enabled": true,
      "ip": "192.168.1.50",
      "name": "Cam1",
      "triggerDelay": 0,
      "rejectDelay": 0,
      "rejectTime": 0
    }
  }
}
```

下次启动时，系统会自动读取这个配置，**无需重新配置**！

---

## ✅ 验证配置

### 方法1：前端查看
- 打开"设置" → 点击"Cam1 设置" → 查看配置

### 方法2：API查看
```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/cameras/config/1'
```

### 方法3：查看文件
```powershell
Get-Content data\camera_config.json
```

---

## 🔧 常见问题

### Q: 启动时提示"没有启用的相机"？
**A**: 打开相机设置，勾选"启用相机"并填写IP地址后保存

### Q: 启动时提示"未找到IP为 xxx 的相机"？
**A**: 
1. 检查相机是否开机
2. 使用 `ping 192.168.1.50` 测试网络
3. 确认IP地址是否正确

### Q: 如何修改IP地址？
**A**: 打开相机设置，修改IP后点击保存即可

---

## 📖 详细文档

- **[CAMERA_CONFIG_GUIDE.md](CAMERA_CONFIG_GUIDE.md)** - 完整使用指南
- **[MODIFICATION_SUMMARY.md](MODIFICATION_SUMMARY.md)** - 修改总结
- **[CAMERA_TEST_REPORT.md](CAMERA_TEST_REPORT.md)** - 测试报告

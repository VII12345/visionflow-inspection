/**
 * 视觉检测系统 — 相机配置弹窗
 * IP地址 / 启用状态 / 触发源 / 触发沿 / 触发延时 / 剔除延时 / 剔除时间
 * 硬触发模式：传感器触发 → 相机拍照 → 系统读取
 * 需要技术员或以上权限
 */

const CameraConfig = {
  _currentCamId: 1,
  _currentConfig: null,

  async open(camId) {
    // 权限检查
    if (!App.user) {
      App.showLogin();
      return;
    }
    if (!Permissions.isTech(App.user)) {
      App.showMessage('需要技术员或以上权限才能设置相机参数');
      return;
    }

    this._currentCamId = camId;

    // 从后端加载配置
    try {
      const data = await window.electronAPI.backendFetch(`/api/cameras/config/${camId}`);

      if (data.success && data.config) {
        this._currentConfig = data.config;
      } else {
        throw new Error(data.error || '加载配置失败');
      }
    } catch (e) {
      console.error('加载相机配置失败:', e);
      App.showMessage('加载相机配置失败: ' + e.message);
      return;
    }

    // 填充表单
    document.getElementById('camConfigTitle').textContent = `Cam ${camId} 设置（触发模式）`;
    document.getElementById('camEnabled').checked = this._currentConfig.enabled || false;
    document.getElementById('camIP').value = this._currentConfig.ip || '';
    document.getElementById('camName').value = this._currentConfig.name || `Cam${camId}`;
    document.getElementById('camTriggerSource').value = this._currentConfig.triggerSource || 'Line0';
    document.getElementById('camTriggerActivation').value = this._currentConfig.triggerActivation || 'RisingEdge';
    document.getElementById('camTriggerTimeout').value = this._currentConfig.triggerTimeout ?? 30000;
    document.getElementById('camTrigDelay').value = this._currentConfig.triggerDelay ?? 0;
    document.getElementById('camExposureTime').value = this._currentConfig.exposureTime ?? 5000;
    document.getElementById('camGain').value = this._currentConfig.gain ?? 0;
    document.getElementById('camRejectDelay').value = this._currentConfig.rejectDelay ?? 0;
    document.getElementById('camRejectTime').value = this._currentConfig.rejectTime ?? 0;

    App.openModal('cameraConfigModal');
  },

  async save() {
    const enabled = document.getElementById('camEnabled').checked;
    const ip = document.getElementById('camIP').value.trim();
    const name = document.getElementById('camName').value.trim() || `Cam${this._currentCamId}`;
    const triggerSource = document.getElementById('camTriggerSource').value;
    const triggerActivation = document.getElementById('camTriggerActivation').value;
    const triggerTimeout = parseInt(document.getElementById('camTriggerTimeout').value) || 30000;
    const triggerDelay = parseInt(document.getElementById('camTrigDelay').value) || 0;
    const exposureTime = parseInt(document.getElementById('camExposureTime').value) || 5000;
    const gain = parseFloat(document.getElementById('camGain').value) || 0;
    const rejectDelay = parseInt(document.getElementById('camRejectDelay').value) || 0;
    const rejectTime = parseInt(document.getElementById('camRejectTime').value) || 0;

    // 验证IP地址格式
    if (enabled && !this._validateIP(ip)) {
      App.showMessage('请输入有效的IP地址（例如: 192.168.1.50）');
      return;
    }

    const config = { enabled, ip, name, triggerSource, triggerActivation,
      triggerTimeout, triggerDelay, exposureTime, gain, rejectDelay, rejectTime };

    try {
      const data = await window.electronAPI.backendFetch(`/api/cameras/config/${this._currentCamId}`, {
        method: 'POST',
        body: config
      });

      if (data.success) {
        App.showMessage(data.message || `Cam ${this._currentCamId} 配置已保存`);
        App.closeModal('cameraConfigModal');
      } else {
        throw new Error(data.error || '保存失败');
      }
    } catch (e) {
      console.error('保存配置失败:', e);
      App.showMessage('保存配置失败: ' + e.message);
    }
  },

  _validateIP(ip) {
    const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!pattern.test(ip)) return false;
    return ip.split('.').every(p => { const n = parseInt(p); return n >= 0 && n <= 255; });
  },
};
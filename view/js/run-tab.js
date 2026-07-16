/**
 * 视觉检测系统 — 运行标签页
 * 4路相机画面 + 启停控制 + 统计 + 产品型号显示
 * 已修改：使用真实后端数据
 */

const RunTab = {
  _pollInterval: null,
  _frameUpdateInterval: null,

  render() {
    const grid = document.getElementById('cameraGrid');
    const lineConfig = DB.getLineConfig();
    const products = DB.getProducts();
    grid.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      const cfg = lineConfig[i - 1];
      const prod = products.find(p => p.id === cfg?.productId);
      const modelName = prod ? prod.model : '-';

      const card = document.createElement('div');
      card.className = 'camera-card';
      card.id = `cam-card-${i}`;
      card.innerHTML = `
        <div class="camera-header">
          <span>
            <span class="camera-name">Cam${i}</span>
            <span class="camera-line">线体 ${i}</span>
            <span class="camera-model"> | 型号: ${modelName}</span>
          </span>
          <span class="camera-detail-btn" onclick="RunTab.openDetail(${i})">详情 &gt;</span>
        </div>
        <div class="camera-image-area" id="cam-img-${i}">
          <div class="camera-badge pending" id="cam-badge-${i}">等待检测</div>
          <img id="cam-frame-${i}" src="assets/placeholder.png" alt="Cam${i}" style="opacity:0.5">
        </div>
        <div class="camera-footer">
          <span id="cam-result-${i}">--</span>
          <span id="cam-time-${i}"></span>
        </div>
      `;
      grid.appendChild(card);
    }
    this.updateStats();
    this._updateButtons();
  },

  _updateButtons() {
    const startBtn = document.querySelector('.btn-start');
    const stopBtn = document.querySelector('.btn-stop');
    if (!startBtn || !stopBtn) return;
    if (App.isRunning) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  },

  async start() {
    // 必须登录才能启动
    if (!App.user) {
      App.showLogin();
      return;
    }
    if (App.isRunning) {
      App.showMessage('系统已在运行中');
      return;
    }

    try {
      // 调用后端 API 启动
      const result = await window.electronAPI.backendFetch('/api/start', { method: 'POST' });

      if (result.success) {
        App.setSystemStatus(true);
        document.getElementById('runStatusLabel').textContent = '● 运行中';
        document.getElementById('runStatusLabel').className = 'run-status running';
        App.showMessage('系统已启动，开始检测');
        this._updateButtons();

        // 从后端同步相机配置到前端
        this._syncCameraConfig();

        // 启动轮询
        this._startPolling();
      } else {
        App.showMessage('启动失败: ' + result.message);
      }
    } catch (err) {
      console.error('启动失败:', err);
      App.showMessage('启动失败: ' + err.message);
    }
  },

  async stop() {
    if (!App.isRunning) {
      App.showMessage('系统已停止');
      return;
    }

    try {
      // 停止轮询
      this._stopPolling();

      // 调用后端 API 停止
      const result = await window.electronAPI.backendFetch('/api/stop', { method: 'POST' });

      if (result.success) {
        App.setSystemStatus(false);
        const label = document.getElementById('runStatusLabel');
        if (label) {
          label.textContent = '● 已停止';
          label.className = 'run-status stopped';
        }
        App.showMessage('系统已停止检测');
        this._updateButtons();
      } else {
        App.showMessage('停止失败: ' + result.message);
      }
    } catch (err) {
      console.error('停止失败:', err);
      App.showMessage('停止失败: ' + err.message);
    }
  },

  _startPolling() {
    // 轮询状态（500ms）
    this._pollInterval = setInterval(() => {
      this._pollStatus();
    }, 500);

    // 更新帧图片（1秒）
    this._frameUpdateInterval = setInterval(() => {
      this._updateFrames();
    }, 1000);
  },

  async _syncCameraConfig() {
    // 从后端拉取相机配置并写入前端存储
    try {
      const data = await window.electronAPI.backendFetch('/api/cameras/config');
      if (data.success && data.config && data.config.cameras) {
        const cameras = data.config.cameras;
        const frontendCfg = {};
        for (let i = 1; i <= 4; i++) {
          const c = cameras[String(i)] || {};
          frontendCfg[i] = {
            trigDelay: c.triggerDelay || 0,
            rejectDelay: c.rejectDelay || 0,
            rejectTime: c.rejectTime || 0,
            ip: c.ip || '',
            enabled: c.enabled || false,
          };
        }
        DB.saveCameraConfig(frontendCfg);
      }
    } catch (e) {
      console.error('同步相机配置失败:', e);
    }
  },

  _stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._frameUpdateInterval) {
      clearInterval(this._frameUpdateInterval);
      this._frameUpdateInterval = null;
    }
  },

  async _pollStatus() {
    try {
      const status = await window.electronAPI.backendFetch('/api/status');

      // 更新每个相机的状态
      for (let i = 1; i <= 4; i++) {
        const camStatus = status.cameras[i];
        if (!camStatus) continue;

        const badge = document.getElementById(`cam-badge-${i}`);
        const resultEl = document.getElementById(`cam-result-${i}`);
        const timeEl = document.getElementById(`cam-time-${i}`);

        // 根据运行状态和触发模式显示不同的badge
        if (camStatus.state === 'running') {
          if (camStatus.result) {
            // 有检测结果
            if (badge) {
              badge.textContent = camStatus.result.label;
              badge.className = `camera-badge ${camStatus.result.label === '正' ? 'ok' : 'ng'}`;
            }
            if (resultEl) {
              resultEl.textContent = `结果: ${camStatus.result.label} (${Math.round(camStatus.result.confidence * 100)}%)`;
              resultEl.style.color = camStatus.result.label === '正' ? '#00c853' : '#ff1744';
            }
          } else {
            // 运行中但等待触发
            if (badge) {
              badge.textContent = '等待触发';
              badge.className = 'camera-badge pending-trigger';
            }
            if (resultEl) {
              resultEl.textContent = `触发模式 — 等待传感器信号... (已触发 ${camStatus.totalTriggers || 0} 次)`;
              resultEl.style.color = '#ff9800';
            }
          }

          if (timeEl && camStatus.lastFrameTime) {
            timeEl.textContent = camStatus.lastFrameTime;
          }
        } else if (camStatus.state === 'disconnected' || camStatus.state === 'ready') {
          if (badge) {
            badge.textContent = '等待检测';
            badge.className = 'camera-badge pending';
          }
          if (resultEl) {
            resultEl.textContent = '--';
            resultEl.style.color = '';
          }
        } else if (camStatus.state === 'error') {
          if (badge) {
            badge.textContent = '错误';
            badge.className = 'camera-badge error';
          }
          if (resultEl) {
            resultEl.textContent = camStatus.error || '未知错误';
            resultEl.style.color = '#ff1744';
          }
        }

        // 更新统计（从后端同步，避免丢失）
        if (camStatus.stats) {
          const stats = DB.getCameraStats();
          stats[i] = camStatus.stats;
          DB.saveCameraStats(stats);
        }
      }

      this.updateStats();
    } catch (err) {
      console.error('轮询状态失败:', err);
    }
  },

  async _updateFrames() {
    // 更新相机帧图片
    for (let i = 1; i <= 4; i++) {
      try {
        const imgEl = document.getElementById(`cam-frame-${i}`);
        if (!imgEl) continue;

        const buffer = await window.electronAPI.backendFetch(`/api/frame/${i}`, {
          method: 'GET',
          responseType: 'blob'
        });

        // 将 buffer 转为 base64
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        imgEl.src = `data:image/jpeg;base64,${base64}`;
        imgEl.style.opacity = 1;
      } catch (err) {
        // 忽略帧获取失败（相机可能未启动）
      }
    }
  },

  updateStats() {
    const stats = DB.getCameraStats();
    let totalOk = 0, totalNg = 0, total = 0;
    for (let i = 1; i <= 4; i++) {
      total += stats[i].detected;
      totalNg += stats[i].defective;
    }
    totalOk = total - totalNg;
    document.getElementById('statsSummary').textContent =
      `OK: ${totalOk} | NG: ${totalNg} | 总计: ${total}`;
  },

  openDetail(camId) {
    CameraDetail.open(camId);
  },
};

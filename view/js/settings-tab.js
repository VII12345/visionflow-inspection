/**
 * 视觉检测系统 — 设置标签页
 * AI 学习控制 + 相机参数设置入口 + 模型状态检查
 */

const SettingsTab = {
  _learning: false,
  _selectedModel: null,
  _pollInterval: null,

  async render() {
    this.renderModelList();
    this.updateLearningUI();
    await this._syncModelStatus();
  },

  // ======== 产品型号列表 ========
  renderModelList(filter) {
    const products = DB.getProducts();
    const wrap = document.getElementById('modelList');
    let filtered = products;
    if (filter) {
      const kw = filter.toLowerCase();
      filtered = products.filter(p => p.model.toLowerCase().includes(kw));
    }
    let html = `<table>
      <thead><tr>
        <th>型号</th>
        <th>尺寸</th>
        <th>状态</th>
      </tr></thead><tbody>`;
    for (const p of filtered) {
      html += `<tr class="${p.learned ? '' : 'unlearned'}"
        onclick="SettingsTab.selectModel('${p.model}', ${p.id})"
        style="cursor:pointer">
        <td><strong>${p.model}</strong></td>
        <td>${p.size}</td>
        <td>${p.learned
          ? '<span class="badge-learned">已学习</span>'
          : '<span class="badge-unlearned">未学习</span>'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;

    document.getElementById('modelFilter').oninput = (e) => {
      this.renderModelList(e.target.value);
    };
  },

  selectModel(model, id) {
    this._selectedModel = { model, id };
    document.getElementById('selectedModel').textContent = model;
  },

  /** 从后端同步模型文件状态 */
  async _syncModelStatus() {
    try {
      const data = await window.electronAPI.backendFetch('/api/models');
      if (data.success && data.models) {
        const trainedNames = new Set(data.models.map(m => m.name));
        const products = DB.getProducts();
        let changed = false;
        for (const p of products) {
          const wasLearned = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== wasLearned) changed = true;
        }
        if (changed) {
          DB.saveProducts(products);
          this.renderModelList(document.getElementById('modelFilter')?.value || '');
          FileTab.renderLineConfig();
        }
      }
    } catch (e) {
      console.error('同步模型状态失败:', e);
    }
  },

  // ======== AI 学习 ========
  startLearning() {
    if (!this._checkLearningAuth()) return;

    if (!this._selectedModel) {
      App.showMessage('请先在左侧选择一个产品型号');
      return;
    }

    const text = document.getElementById('learnConfirmText');
    text.textContent = `确认开始学习「${this._selectedModel.model}」？${
      DB.getProducts().find(p => p.id === this._selectedModel.id)?.learned
        ? '\n（该型号已学习过，重新学习将覆盖原有模型）'
        : ''
    }`;
    document.getElementById('learnUprightPath').value = '';
    document.getElementById('learnInvertedPath').value = '';
    document.getElementById('learnFolderPath').value = '';
    App.openModal('learnConfirmModal');
  },

  async browseFolder(inputId) {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        document.getElementById(inputId).value = folderPath;
      }
    } catch (e) {
      App.showMessage('打开文件夹选择失败: ' + e.message);
    }
  },

  async confirmLearning() {
    const uprightPath = document.getElementById('learnUprightPath').value.trim();
    const invertedPath = document.getElementById('learnInvertedPath').value.trim();
    const folderPath = document.getElementById('learnFolderPath').value.trim();

    if (!uprightPath && !invertedPath && !folderPath) {
      App.showMessage('请至少选择正罐/倒罐图片目录，或指定父目录');
      return;
    }

    // 如果填了正/反目录，必须两个都填
    if ((uprightPath && !invertedPath) || (!uprightPath && invertedPath)) {
      App.showMessage('正罐和倒罐目录需要同时指定');
      return;
    }

    App.closeModal('learnConfirmModal');

    try {
      const result = await window.electronAPI.backendFetch('/api/training/start', {
        method: 'POST',
        body: {
          uprightPath,
          invertedPath,
          folderPath,
          modelName: this._selectedModel.model,
        }
      });

      if (!result.success) {
        App.showMessage('启动训练失败: ' + result.message);
        return;
      }

      this._learning = true;
      this.updateLearningUI();

      const statusEl = document.getElementById('learningStatus');
      statusEl.style.display = 'block';
      document.getElementById('progressFill').style.width = '0%';
      document.getElementById('progressLabel').textContent = '正在初始化...';
      document.getElementById('trainMetrics').textContent = '--';

      this._pollTrainingProgress();
      App.showMessage(`开始学习 ${this._selectedModel.model}`);
    } catch (e) {
      App.showMessage('启动训练失败: ' + e.message);
    }
  },

  async _pollTrainingProgress() {
    if (this._pollInterval) clearInterval(this._pollInterval);

    this._pollInterval = setInterval(async () => {
      try {
        const status = await window.electronAPI.backendFetch('/api/training/status');

        const fill = document.getElementById('progressFill');
        const label = document.getElementById('progressLabel');
        fill.style.width = status.progress + '%';
        label.textContent = status.message || `学习中... ${status.progress}%`;

        const metricsEl = document.getElementById('trainMetrics');
        if (status.epoch > 0) {
          metricsEl.innerHTML = `
            Epoch ${status.epoch}/${status.total_epochs} |
            训练Loss: ${status.train_loss.toFixed(4)} |
            验证Loss: ${status.val_loss.toFixed(4)} |
            验证Acc: ${(status.val_acc * 100).toFixed(1)}%
          `;
        } else {
          metricsEl.textContent = status.message || '准备中...';
        }

        if (!status.running) {
          clearInterval(this._pollInterval);
          this._pollInterval = null;
          this._learning = false;
          this._onLearningComplete(status);
        }
      } catch (e) {
        console.error('轮询训练状态失败:', e);
      }
    }, 500);
  },

  stopLearning() {
    if (!this._learning) return;
    window.electronAPI.backendFetch('/api/training/stop', { method: 'POST' }).catch(() => {});

    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    this._learning = false;
    document.getElementById('learningStatus').style.display = 'none';
    App.showMessage('学习已停止');
    this.updateLearningUI();
  },

  _onLearningComplete(status) {
    const fill = document.getElementById('progressFill');
    const label = document.getElementById('progressLabel');
    fill.style.width = '100%';

    const acc = status.history?.eval?.accuracy;
    const accText = acc != null ? ` (验证准确率: ${(acc * 100).toFixed(1)}%)` : '';
    label.textContent = `学习完成！${accText}`;

    const metricsEl = document.getElementById('trainMetrics');
    if (status.history && status.history.eval) {
      const ev = status.history.eval;
      metricsEl.innerHTML = `
        结果: Acc=${(ev.accuracy * 100).toFixed(1)}% |
        P=${(ev.precision * 100).toFixed(1)}% |
        R=${(ev.recall * 100).toFixed(1)}% |
        F1=${(ev.f1 * 100).toFixed(1)}% |
        最佳轮次: ${status.history.best_epoch}
      `;
    }

    // 同步模型状态
    this._syncModelStatus();

    setTimeout(() => {
      document.getElementById('learningStatus').style.display = 'none';
      App.showMessage(`${this._selectedModel?.model} 学习完成`);
    }, 3000);

    this.updateLearningUI();
  },

  updateLearningUI() {
    const learnBtn = document.getElementById('learnBtn');
    const stopBtn = document.getElementById('learnStopBtn');
    if (this._learning) {
      learnBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      learnBtn.disabled = false;
      stopBtn.disabled = true;
    }
  },

  _checkLearningAuth() {
    if (!App.user) { App.showLogin(); return false; }
    if (!Permissions.isAdmin(App.user)) {
      App.showMessage('仅管理员可以进行 AI 学习');
      return false;
    }
    return true;
  },
};
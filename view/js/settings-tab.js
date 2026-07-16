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
    text.textContent = `确认开始学习「${this._selectedModel.model}」？${DB.getProducts().find(p => p.id === this._selectedModel.id)?.learned
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
    window.electronAPI.backendFetch('/api/training/stop', { method: 'POST' }).catch(() => { });

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

    const isFailed = status.message && status.message.includes('失败');
    const modelName = this._selectedModel?.model || '';
    const modelPath = status.modelPath || '';
    const ev = status.evalResult || (status.history && status.history.eval) || null;
    const trainCount = status.trainCount || 0;
    const valCount = status.valCount || 0;

    if (isFailed) {
      label.textContent = status.message;
      this._showTrainingResultModal(modelName, modelPath, null, status.message, 0, 0);
    } else {
      const accText = ev?.accuracy != null ? ` (验证准确率: ${(ev.accuracy * 100).toFixed(1)}%)` : '';
      label.textContent = `学习完成！${accText}`;

      const metricsEl = document.getElementById('trainMetrics');
      if (ev) {
        metricsEl.innerHTML = `
          结果: Acc=${(ev.accuracy * 100).toFixed(1)}% |
          P=${(ev.precision * 100).toFixed(1)}% |
          R=${(ev.recall * 100).toFixed(1)}% |
          F1=${(ev.f1 * 100).toFixed(1)}%
        `;
      }

      this._showTrainingResultModal(modelName, modelPath, ev, null, trainCount, valCount);
    }

    // 同步模型状态
    this._syncModelStatus();
    this.updateLearningUI();
  },

  _showTrainingResultModal(modelName, modelPath, evalResult, errorMessage, trainCount, valCount) {
    // 移除已有弹窗
    const existing = document.getElementById('trainingResultModal');
    if (existing) existing.remove();

    const isError = !!errorMessage;
    const pct = (v) => v != null ? (v * 100).toFixed(1) : '--';
    const cm = evalResult?.confusion_matrix;

    let bodyHtml = '';
    if (isError) {
      bodyHtml = `<div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);border-radius:8px;padding:12px;color:#fb7185;font-size:13px;">${errorMessage}</div>`;
    } else {
      bodyHtml = `
        <div style="background:#1a1f2e;border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">产品型号</div>
          <div style="font-size:14px;font-weight:600;color:#fff;">${modelName || '--'}</div>          ${(trainCount > 0 || valCount > 0) ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">数据分布: 训练集 ${trainCount} 张 · 验证集 ${valCount} 张（用于评估）</div>` : ''}          ${modelPath ? `<div style="font-size:11px;color:#6b7280;margin-top:6px;">保存位置</div><div style="font-size:11px;color:#9ca3af;word-break:break-all;font-family:monospace;">${modelPath}</div>` : ''}
        </div>
        ${evalResult ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">评估指标</div>
          <div style="background:#1a1f2e;border-radius:8px;padding:8px 12px;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:#9ca3af;font-size:12px;">准确率</span><span style="color:#34d399;font-size:12px;font-weight:600;">${pct(evalResult.accuracy)}%</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:#9ca3af;font-size:12px;">精确率</span><span style="color:#60a5fa;font-size:12px;font-weight:600;">${pct(evalResult.precision)}%</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:#9ca3af;font-size:12px;">召回率</span><span style="color:#a78bfa;font-size:12px;font-weight:600;">${pct(evalResult.recall)}%</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:#9ca3af;font-size:12px;">F1 分数</span><span style="color:#fbbf24;font-size:12px;font-weight:600;">${pct(evalResult.f1)}%</span></div>
          </div>
        </div>
        ${cm ? `
        <div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">混淆矩阵</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:#6b7280;">TP</div><div style="font-size:18px;font-weight:700;color:#34d399;">${cm.TP}</div></div>
            <div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:#6b7280;">FP</div><div style="font-size:18px;font-weight:700;color:#f87171;">${cm.FP}</div></div>
            <div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:#6b7280;">FN</div><div style="font-size:18px;font-weight:700;color:#f87171;">${cm.FN}</div></div>
            <div style="background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:#6b7280;">TN</div><div style="font-size:18px;font-weight:700;color:#34d399;">${cm.TN}</div></div>
          </div>
          <div style="font-size:10px;color:#6b7280;text-align:right;margin-top:4px;">验证集总样本: ${cm.TP + cm.TN + cm.FP + cm.FN} 张（训练集 ${trainCount} 张未在此评估）</div>
        </div>
        ` : ''}
        ` : ''}
      `;
    }

    const modalHtml = `
      <div id="trainingResultModal" class="modal-overlay" style="display:flex;position:fixed;inset:0;z-index:1100;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);">
        <div style="background:#111620;border:1px solid rgba(255,255,255,0.06);border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.5);width:520px;max-width:95vw;max-height:90vh;overflow:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <h3 style="font-size:15px;font-weight:600;color:#fff;">${isError ? '⚠️ 训练失败' : '✅ 训练完成'}</h3>
            <button onclick="document.getElementById('trainingResultModal').remove()" style="color:#6b7280;font-size:20px;line-height:1;background:none;border:none;cursor:pointer;">&times;</button>
          </div>
          <div style="padding:24px;">${bodyHtml}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);">
            <button onclick="document.getElementById('trainingResultModal').remove()" style="background:#5b6ef5;color:#fff;border:1px solid #5b6ef5;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;">确定</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 点击遮罩关闭
    document.getElementById('trainingResultModal').addEventListener('click', function (e) {
      if (e.target === this) this.remove();
    });
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
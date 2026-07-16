/**
 * 视觉检测系统 — 相机详情标签页（动态标签）
 * 可被 Cam1~Cam4 复用
 */

const CameraDetail = {
  _detailTabs: {},
  _activeCamId: null,
  _selectedPhotoId: null,

  /** 判断是否为相机详情 tab */
  isDetailTab(tabId) {
    return tabId && tabId.startsWith('cam-detail-');
  },

  /** 从运行页打开相机详情 */
  async open(camId) {
    // 如果已经打开，直接切换
    if (this._detailTabs[camId]) {
      this.switchTo('cam-detail-' + camId);
      return;
    }

    this._detailTabs[camId] = true;

    // 创建 tab 标签
    const tabList = document.getElementById('tabList');
    const tab = document.createElement('div');
    tab.className = 'tab dynamic';
    tab.dataset.tab = 'cam-detail-' + camId;
    tab.onclick = () => this.switchTo('cam-detail-' + camId);
    tab.innerHTML = `
      <span class="tab-icon">📷</span>
      Cam${camId} 详情
      <span class="tab-close" onclick="event.stopPropagation(); CameraDetail.close(${camId})">&times;</span>
    `;
    tabList.appendChild(tab);

    // 创建内容区
    const contentArea = document.getElementById('contentArea');
    const content = document.createElement('div');
    content.className = 'tab-content';
    content.id = 'tab-cam-detail-' + camId;

    const stats = DB.getCameraStats();
    const saveSettings = DB.getSaveSettings();

    content.innerHTML = `
      <div class="camera-detail-container">
        <div class="camera-detail-main">
          <div class="camera-detail-image" id="det-img-${camId}">
            <div class="camera-detail-badge pending" id="det-badge-${camId}">等待检测</div>
            <img src="assets/placeholder.png" alt="Cam${camId}" style="opacity:0.5">
          </div>
          <div class="camera-detail-info">
            <div class="info-item">
              <span>线体：</span>
              <span>${camId}</span>
            </div>
            <div class="info-item">
              <span>检测数量：</span>
              <span id="det-count-${camId}">${stats[camId].detected}</span>
            </div>
            <div class="info-item">
              <span>不良数量：</span>
              <span id="det-defective-${camId}" style="color:#ff1744">${stats[camId].defective}</span>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="CameraDetail.resetStats(${camId})">清零</button>
          </div>
        </div>
        <div class="camera-detail-side">
          <div class="camera-detail-options">
            <div class="option-row">
              <label>保存正罐照片：</label>
              <label class="toggle-switch">
                <input type="checkbox" ${saveSettings[camId]?.saveGood ? 'checked' : ''}
                  onchange="CameraDetail.toggleSaveGood(${camId}, this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <span id="save-good-label-${camId}">${saveSettings[camId]?.saveGood ? '是' : '否'}</span>
            </div>
            <div class="option-row">
              <label>保存倒罐照片：</label>
              <label class="toggle-switch">
                <input type="checkbox" ${saveSettings[camId]?.saveBad ? 'checked' : ''}
                  onchange="CameraDetail.toggleSaveBad(${camId}, this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <span id="save-bad-label-${camId}">${saveSettings[camId]?.saveBad ? '是' : '否'}</span>
            </div>
          </div>
          <div class="camera-detail-photos">
            <h4 style="margin-bottom:10px;color:#aab4c6;font-size:13px">
              📷 检测照片历史（单击预览 | 右键另存）
            </h4>
            <div id="photo-list-${camId}"></div>
          </div>
        </div>
      </div>
    `;

    contentArea.appendChild(content);

    // 渲染照片列表
    this.renderPhotoList(camId);
    this.switchTo('cam-detail-' + camId);
  },

  switchTo(tabId) {
    // 从 tabId 提取 camId
    const camId = parseInt(tabId.replace('cam-detail-', ''));
    this._activeCamId = camId;

    // 更新所有 tab 高亮
    document.querySelectorAll('.tab-list .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });

    // 更新内容区
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const content = document.getElementById('tab-' + tabId);
    if (content) content.classList.add('active');

    document.getElementById('tab-' + tabId)?.classList.add('active');
  },

  close(camId) {
    // 移除 tab
    const tab = document.querySelector(`.tab[data-tab="cam-detail-${camId}"]`);
    if (tab) tab.remove();

    // 移除内容
    const content = document.getElementById('tab-cam-detail-' + camId);
    if (content) content.remove();

    delete this._detailTabs[camId];

    // 切回运行标签
    App.switchTab('run');
  },

  async renderPhotoList(camId) {
    const wrap = document.getElementById('photo-list-' + camId);
    if (!wrap) return;

    let photos = [];

    // 1) 优先从后端拉取真实照片列表
    try {
      const data = await window.electronAPI.backendFetch(`/api/photos/${camId}`);
      if (data.success && data.photos) {
        photos = data.photos.map(p => ({
          id: p.filename,
          time: p.mtime,
          result: '',
          filename: p.filename,
          size: p.size,
        }));
      }
    } catch (_) {
      // 后端不可用，降级为前端元数据
    }

    // 2) 降级: 合并前端元数据
    if (photos.length === 0) {
      photos = DB.getPhotos(camId);
    }

    if (photos.length === 0) {
      wrap.innerHTML = '<p style="color:#6a7b94;padding:10px">暂无检测记录</p>';
      return;
    }

    let html = '<div class="photo-list">';
    for (const p of photos) {
      const isOK = p.result === 'OK' || p.result === '正' || p.result === '';
      html += `<div class="photo-item" id="photo-item-${p.id}"
        onclick="CameraDetail.selectPhoto(${camId}, '${p.id}')"
        oncontextmenu="CameraDetail.onRightClick(event, ${camId}, '${p.id}')">
        <span class="photo-time">${p.time}</span>
        <span class="photo-result badge-${isOK ? 'ok' : 'ng'}">${p.result || '--'}</span>
        <span style="color:#6a7b94;font-size:11px">${p.filename}</span>
      </div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;
  },

  selectPhoto(camId, photoId) {
    // 高亮选中项
    document.querySelectorAll(`#photo-list-${camId} .photo-item`).forEach(el => {
      el.classList.remove('selected');
    });
    const item = document.getElementById('photo-item-' + photoId);
    if (item) item.classList.add('selected');

    this._selectedPhotoId = photoId;

    // 更新左侧大图：从后端加载真实照片
    const imgArea = document.getElementById('det-img-' + camId);
    if (imgArea) {
      // photoId 即 filename（来自后端照片列表）
      const photoUrl = `http://127.0.0.1:5000/api/photos/${camId}/${photoId}`;
      imgArea.innerHTML = `
        <div class="camera-detail-badge ok" style="background:var(--ok-bg);color:var(--ok)">检测照片</div>
        <img src="${photoUrl}" alt="${photoId}" style="max-width:90%;max-height:90%"
          onerror="this.parentElement.querySelector('.camera-detail-badge').textContent='加载失败'">
        <div style="position:absolute;bottom:10px;left:10px;color:#6a7b94;font-size:12px">
          ${photoId}
        </div>
      `;
    }
  },

  onRightClick(event, camId, photoId) {
    event.preventDefault();
    this._selectedPhotoId = photoId;
    this._rightClickCamId = camId;

    // 检查权限（技术员及以上可以另存）
    if (!App.user) {
      App.showLogin();
      return;
    }
    if (!Permissions.isTech(App.user)) {
      App.showMessage('需要技术员以上权限才能另存图片');
      return;
    }

    const menu = document.getElementById('contextMenu');
    menu.style.display = 'block';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
  },

  saveImage() {
    const camId = this._rightClickCamId;
    const photoId = this._selectedPhotoId;
    if (camId && photoId) {
      const photoUrl = `http://127.0.0.1:5000/api/photos/${camId}/${photoId}`;
      const a = document.createElement('a');
      a.href = photoUrl;
      a.download = String(photoId);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      App.showMessage(`图片已下载: ${photoId}`);
    }
    document.getElementById('contextMenu').style.display = 'none';
  },

  toggleSaveGood(camId, val) {
    document.getElementById(`save-good-label-${camId}`).textContent = val ? '是' : '否';
    const settings = DB.getSaveSettings();
    settings[camId].saveGood = val;
    DB.saveSaveSettings(settings);
    // 同步到后端
    window.electronAPI.backendFetch(`/api/save-settings/${camId}`, {
      method: 'POST',
      body: { saveGood: val, saveBad: settings[camId].saveBad }
    }).catch(() => {});
  },

  toggleSaveBad(camId, val) {
    document.getElementById(`save-bad-label-${camId}`).textContent = val ? '是' : '否';
    const settings = DB.getSaveSettings();
    settings[camId].saveBad = val;
    DB.saveSaveSettings(settings);
    // 同步到后端
    window.electronAPI.backendFetch(`/api/save-settings/${camId}`, {
      method: 'POST',
      body: { saveGood: settings[camId].saveGood, saveBad: val }
    }).catch(() => {});
  },

  resetStats(camId) {
    const stats = DB.resetCameraStats(camId);
    document.getElementById(`det-count-${camId}`).textContent = stats[camId].detected;
    document.getElementById(`det-defective-${camId}`).textContent = stats[camId].defective;
    RunTab.updateStats();
    App.showMessage(`Cam${camId} 统计已清零`);
  },

  /** 由 RunTab._pollStatus 调用，更新详情页的检测结果和照片列表 */
  updateFromDetection(camId, result) {
    // 更新统计显示
    const stats = DB.getCameraStats();
    const countEl = document.getElementById(`det-count-${camId}`);
    const defEl = document.getElementById(`det-defective-${camId}`);
    if (countEl) countEl.textContent = stats[camId].detected;
    if (defEl) defEl.textContent = stats[camId].defective;

    // 更新照片列表
    this.renderPhotoList(camId);
  },
};
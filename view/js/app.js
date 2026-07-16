/**
 * 视觉检测系统 — 主应用模块
 * 标签切换、登录/登出、全局状态
 */

const App = {
  currentTab: 'run',
  user: null,
  isRunning: false,
  _confirmCallback: null,

  async init() {
    this.user = DB.getCurrentUser();
    if (this.user) {
      this.updateUserUI();
    }
    this.setupModalCloses();
    RunTab.render();
    await FileTab.render();
    await SettingsTab.render();
    UserTab.render();
    this.switchTab('run');
    this.showStorageInfo();
    this.checkEnvironment();
  },

  showStorageInfo() {
    const info = DB.getStorageInfo();
    const rightEl = document.getElementById('statusRight');
    if (info.type === 'encrypted') {
      rightEl.textContent = `🔒 加密存储: ${info.path}`;
    } else {
      rightEl.textContent = `⚠️ 明文存储: ${info.path}`;
    }
  },

  // ========== 自定义确认弹窗 ==========

  confirm(message) {
    return new Promise((resolve) => {
      this._confirmCallback = (result) => {
        this._confirmCallback = null;
        this.closeModal('confirmModal');
        resolve(result);
      };
      document.getElementById('confirmMessage').textContent = message;
      this.openModal('confirmModal');
    });
  },

  // ========== 标签切换 ==========

  async switchTab(tabId) {
    if (CameraDetail.isDetailTab(tabId)) {
      CameraDetail.switchTo(tabId);
      return;
    }
    this.currentTab = tabId;
    document.querySelectorAll('.tab-list .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const content = document.getElementById('tab-' + tabId);
    if (content) content.classList.add('active');
    document.querySelectorAll('.tab.dynamic').forEach(t => t.classList.remove('active'));

    // 切换到文件或设置标签时，自动从后端同步最新模型状态
    if (tabId === 'file') {
      await FileTab.render();
    } else if (tabId === 'settings') {
      await SettingsTab.render();
    }
  },

  // ========== 弹窗 ==========

  openModal(id) {
    document.getElementById(id).style.display = 'flex';
  },

  closeModal(id) {
    document.getElementById(id).style.display = 'none';
    const err = document.getElementById('loginError');
    if (err) err.style.display = 'none';
    const err2 = document.getElementById('chgPwdError');
    if (err2) err2.style.display = 'none';
  },

  // ========== 登录/登出 ==========

  showLogin() {
    document.getElementById('loginName').value = '';
    document.getElementById('loginPwd').value = '';
    document.getElementById('loginError').style.display = 'none';
    this.openModal('loginModal');
  },

  doLogin() {
    const name = document.getElementById('loginName').value.trim();
    const pwd = document.getElementById('loginPwd').value.trim();
    const errEl = document.getElementById('loginError');
    if (!name || !pwd) {
      errEl.textContent = '请输入用户名和密码';
      errEl.style.display = 'block';
      return;
    }
    const users = DB.getUsers();
    const found = users.find(u => u.name === name && u.password === pwd);
    if (!found) {
      errEl.textContent = '用户名或密码错误';
      errEl.style.display = 'block';
      return;
    }
    this.user = { id: found.id, name: found.name, level: found.level };
    DB.setCurrentUser(this.user);
    this.closeModal('loginModal');
    this.updateUserUI();
    this.showMessage(`登录成功，欢迎 ${this.user.name}`);
  },

  logout() {
    this.user = null;
    DB.setCurrentUser(null);
    this.updateUserUI();
    this.switchTab('run');
    this.showMessage('已登出');
  },

  updateUserUI() {
    const display = document.getElementById('currentUserDisplay');
    const badge = document.getElementById('userRoleBadge');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const chPwdBtn = document.getElementById('changePwdBtn');

    if (this.user) {
      display.textContent = this.user.name;
      badge.textContent = this.getRoleLabel(this.user.level);
      badge.className = 'user-role-badge role-' + this.user.level;
      badge.style.display = 'inline-block';
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-flex';
      chPwdBtn.style.display = 'inline-flex';
    } else {
      display.textContent = '未登录';
      badge.style.display = 'none';
      loginBtn.style.display = 'inline-flex';
      logoutBtn.style.display = 'none';
      chPwdBtn.style.display = 'none';
    }
  },

  getRoleLabel(level) {
    const map = { admin: '管理员', tech: '技术员', operator: '操作员' };
    return map[level] || level;
  },

  // ========== 消息提示 ==========

  showMessage(msg) {
    const el = document.getElementById('statusLeft');
    el.textContent = '💬 ' + msg;
    setTimeout(() => { el.textContent = '系统就绪'; }, 3000);
  },

  setSystemStatus(running) {
    this.isRunning = running;
    const el = document.getElementById('sysStatus');
    if (running) {
      el.textContent = '● 运行中';
      el.className = 'system-status running';
    } else {
      el.textContent = '● 停止';
      el.className = 'system-status stopped';
    }
  },

  // ========== 环境检测 ==========

  async checkEnvironment() {
    try {
      const result = await window.electronAPI.backendFetch('/api/env-check');
      this._envResult = result;

      // 更新状态栏提示
      if (!result.passed) {
        const leftEl = document.getElementById('statusLeft');
        leftEl.textContent = `⚠️ 环境检测: ${result.summary}`;
        leftEl.style.color = 'var(--warn)';
        leftEl.style.cursor = 'pointer';
        leftEl.title = '点击查看详情';
        leftEl.onclick = () => this.showEnvCheckModal();
      }
    } catch (err) {
      console.error('环境检测失败:', err);
    }
  },

  showEnvCheckModal() {
    const result = this._envResult;
    if (!result) return;

    // 摘要
    const summaryEl = document.getElementById('envCheckSummary');
    if (result.passed) {
      summaryEl.textContent = '✅ ' + result.summary;
      summaryEl.style.background = 'var(--ok-bg)';
      summaryEl.style.color = 'var(--ok)';
    } else {
      summaryEl.textContent = '⚠️ ' + result.summary;
      summaryEl.style.background = 'var(--warn-bg)';
      summaryEl.style.color = 'var(--warn)';
    }

    // 表格
    const tbody = document.querySelector('#envCheckTable tbody');
    tbody.innerHTML = '';
    const iconMap = { ok: '✅', warning: '⚠️', error: '❌' };

    result.results.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-subtle)';
      tr.style.cursor = r.detail ? 'pointer' : 'default';

      const icon = r.passed ? '✅' : (r.level === 'error' ? '❌' : '⚠️');
      const color = r.passed ? 'var(--ok)' : (r.level === 'error' ? 'var(--ng)' : 'var(--warn)');

      tr.innerHTML = `
        <td style="padding:10px 12px;font-size:16px;text-align:center">${icon}</td>
        <td style="padding:10px 12px;color:var(--text-primary);font-size:13px">${r.name}</td>
        <td style="padding:10px 12px;color:${color};font-size:13px">${r.message}</td>
      `;

      if (r.detail) {
        tr.addEventListener('click', () => {
          const detailEl = document.getElementById('envCheckDetail');
          detailEl.textContent = '💡 ' + r.detail;
          detailEl.style.display = 'block';
          // 高亮当前行
          tbody.querySelectorAll('tr').forEach(tr2 => tr2.style.background = '');
          tr.style.background = 'var(--bg-elevated)';
        });
      }

      tbody.appendChild(tr);
    });

    // 清空上次的详情
    document.getElementById('envCheckDetail').style.display = 'none';

    this.openModal('envCheckModal');
  },

  // ========== 全局事件 ==========

  setupModalCloses() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => {
          if (m.style.display !== 'none') m.style.display = 'none';
        });
      }
    });
    document.addEventListener('click', () => {
      document.getElementById('contextMenu').style.display = 'none';
    });
  },
};

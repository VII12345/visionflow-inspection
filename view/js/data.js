/**
 * 视觉检测系统 — 数据模块
 * 加密文件存储 (Electron) + localStorage 降级
 * 权限工具
 *
 * 所有数据来源：后端真实数据 + 用户通过 UI 创建的数据
 * 默认值仅提供最小初始化种子，无假数据
 */

const DB = {
  // ========== 最小默认值（仅首次运行种子） ==========

  _defaultUsers: [
    { id: 1, name: 'admin', password: 'admin', level: 'admin' },
  ],

  _defaultProducts: [],

  _defaultLineConfig: [
    { line: 1, productId: null, model: '-' },
    { line: 2, productId: null, model: '-' },
    { line: 3, productId: null, model: '-' },
    { line: 4, productId: null, model: '-' },
  ],

  _defaultCameraConfig: {},

  _defaultCameraStats: {
    1: { detected: 0, defective: 0 },
    2: { detected: 0, defective: 0 },
    3: { detected: 0, defective: 0 },
    4: { detected: 0, defective: 0 },
  },

  _defaultPhotos: { 1: [], 2: [], 3: [], 4: [] },

  _defaultSaveSettings: {
    1: { saveGood: true, saveBad: true },
    2: { saveGood: true, saveBad: true },
    3: { saveGood: true, saveBad: true },
    4: { saveGood: true, saveBad: true },
  },

  // ========== 存储引擎检测 ==========

  _isElectron() {
    return typeof window !== 'undefined' && window.electronAPI;
  },

  // ========== 读写方法 ==========

  _get(key, fallback) {
    if (this._isElectron()) {
      try {
        const data = window.electronAPI.loadData(key);
        if (data !== null && data !== undefined) return data;
      } catch (_) {}
    }
    try {
      const raw = localStorage.getItem('vision_' + key);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return JSON.parse(JSON.stringify(fallback));
  },

  _set(key, data) {
    if (this._isElectron()) {
      try { window.electronAPI.saveData(key, data); } catch (_) {}
    }
    localStorage.setItem('vision_' + key, JSON.stringify(data));
  },

  // --- 用户 ---
  getUsers()        { return this._get('users', this._defaultUsers); },
  saveUsers(users)  { this._set('users', users); },

  // --- 产品 ---
  getProducts()        { return this._get('products', this._defaultProducts); },
  saveProducts(prods)  { this._set('products', prods); },

  // --- 线体配置 ---
  getLineConfig()        { return this._get('lineConfig', this._defaultLineConfig); },
  saveLineConfig(cfg)    { this._set('lineConfig', cfg); },

  // --- 相机参数 ---
  getCameraConfig()        { return this._get('cameraConfig', this._defaultCameraConfig); },
  saveCameraConfig(cfg)    { this._set('cameraConfig', cfg); },

  // --- 相机统计 ---
  getCameraStats()      { return this._get('cameraStats', this._defaultCameraStats); },
  saveCameraStats(st)   { this._set('cameraStats', st); },
  resetCameraStats(camId) {
    const stats = this.getCameraStats();
    stats[camId] = { detected: 0, defective: 0 };
    this.saveCameraStats(stats);
    return stats;
  },

  // --- 照片历史 ---
  getPhotos(camId) {
    const all = this._get('photos', this._defaultPhotos);
    return all[camId] || [];
  },
  addPhoto(camId, result) {
    const all = this._get('photos', this._defaultPhotos);
    if (!all[camId]) all[camId] = [];
    all[camId].unshift({
      id: Date.now() + Math.random(),
      time: new Date().toLocaleString(),
      result: result,
      filename: `CAM${camId}_${Date.now()}.jpg`,
    });
    if (all[camId].length > 100) all[camId] = all[camId].slice(0, 100);
    this._set('photos', all);
  },

  // --- 保存设置 ---
  getSaveSettings()        { return this._get('saveSettings', this._defaultSaveSettings); },
  saveSaveSettings(st)     { this._set('saveSettings', st); },

  // ========== 存储信息 ==========

  getStorageInfo() {
    if (this._isElectron()) {
      try {
        const path = window.electronAPI.getDataPath();
        return { type: 'encrypted', path: path };
      } catch (_) {}
    }
    return { type: 'localStorage', path: '浏览器本地存储 (localStorage)' };
  },

  // --- 当前登录用户 ---
  getCurrentUser() {
    try {
      const raw = localStorage.getItem('vision_currentUser');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  },
  setCurrentUser(user) {
    if (user) {
      localStorage.setItem('vision_currentUser', JSON.stringify(user));
    } else {
      localStorage.removeItem('vision_currentUser');
    }
  },
};

// ========== 权限工具 ==========

const Permissions = {
  LEVELS: { admin: 3, tech: 2, operator: 1 },

  hasPermission(user, minLevel) {
    if (!user) return false;
    return (this.LEVELS[user.level] || 0) >= (this.LEVELS[minLevel] || 0);
  },

  isAdmin(user)    { return user && user.level === 'admin'; },
  isTech(user)     { return user && (user.level === 'tech' || user.level === 'admin'); },
  isOperator(user) { return !!user; },

  canAILearning(user)   { return this.isAdmin(user); },
  canManageUsers(user)  { return this.isAdmin(user); },
  canConfigCamera(user) { return this.isTech(user); },
  canStartStop(user)    { return this.isOperator(user); },
};
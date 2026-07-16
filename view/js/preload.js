/**
 * 视觉检测系统 — Electron preload
 * 暴露加密文件存储 API 和后端 API 调用到渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** 同步保存加密数据 */
  saveData: (key, data) => {
    return ipcRenderer.sendSync('save-encrypted', key, data);
  },
  /** 同步加载加密数据 */
  loadData: (key) => {
    return ipcRenderer.sendSync('load-encrypted', key);
  },
  /** 获取应用数据目录路径 */
  getDataPath: () => {
    return ipcRenderer.sendSync('get-data-path');
  },
  /** 打开文件夹选择对话框 */
  selectFolder: () => {
    return ipcRenderer.invoke('select-folder');
  },
  /** 后端 API 调用 */
  backendFetch: (url, options) => {
    return ipcRenderer.invoke('backend-fetch', url, options);
  },
  /** 打开摄像头独立窗口 */
  openCameraPopout: (camId) => {
    ipcRenderer.send('open-camera-popout', camId);
  },
  /** 关闭摄像头独立窗口 */
  closeCameraPopout: (camId) => {
    ipcRenderer.send('close-camera-popout', camId);
  },
  /** 监听弹窗关闭事件 */
  onCameraPopoutClosed: (callback) => {
    ipcRenderer.on('camera-popout-closed', (event, camId) => callback(camId));
  },
});
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');

// ========== Vite 开发服务器检测 ==========
const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://127.0.0.1:5173';

// ========== 加密存储 ==========
const ENCRYPTION_KEY = crypto.scryptSync('vision-system-v1-secret-key', 'vision-salt-2026', 32);
let DATA_DIR = '';

function initDataDir() {
  if (!DATA_DIR) {
    if (isDev) {
      // 开发模式：项目根目录下的 data/
      DATA_DIR = path.join(__dirname, '..', 'data');
    } else if (process.env.PORTABLE_EXECUTABLE_DIR) {
      // 便携版：exe 所在的目录（electron-builder 设置的环境变量）
      DATA_DIR = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    } else {
      // 安装版等其他模式
      DATA_DIR = path.join(path.dirname(app.getPath('exe')), 'data');
    }
  }
  return DATA_DIR;
}

function ensureDataDir() {
  initDataDir();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveEncryptedFile(key, data) {
  ensureDataDir();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  const payload = JSON.stringify({ iv: iv.toString('hex'), authTag, data: encrypted });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.enc`), payload, 'utf8');
  return true;
}

function loadEncryptedFile(key) {
  const filePath = path.join(DATA_DIR, `${key}.enc`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY,
      Buffer.from(payload.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('解密失败:', e);
    fs.unlinkSync(filePath); // 删除损坏文件
    return null;
  }
}

// IPC handlers
ipcMain.on('save-encrypted', (event, key, data) => {
  event.returnValue = saveEncryptedFile(key, data);
});

ipcMain.on('load-encrypted', (event, key) => {
  event.returnValue = loadEncryptedFile(key);
});

ipcMain.on('get-data-path', (event) => {
  event.returnValue = initDataDir();
});

// 调试：查看运行时路径
ipcMain.on('debug-paths', (event) => {
  const info = {
    isDev,
    __dirname,
    resourcesPath: process.resourcesPath,
    PORTABLE_EXECUTABLE_DIR: process.env.PORTABLE_EXECUTABLE_DIR,
    DATA_DIR: initDataDir(),
    backendExe: path.join(process.resourcesPath, 'backend', 'backend.exe'),
    backendExists: fs.existsSync(path.join(process.resourcesPath, 'backend', 'backend.exe')),
  };
  console.log('路径调试:', JSON.stringify(info, null, 2));
  event.returnValue = info;
});

// 摄像头弹窗 IPC
ipcMain.on('open-camera-popout', (event, camId) => {
  createCameraPopoutWindow(camId);
});
ipcMain.on('close-camera-popout', (event, camId) => {
  closeCameraPopoutWindow(camId);
});

// 文件夹选择对话框
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择图片文件夹（需包含 类别A/ 类别B/ 子目录）',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 后端 API 调用（直连本地，不走代理）
ipcMain.handle('backend-fetch', async (event, url, options = {}) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const fullUrl = `http://127.0.0.1:5000${url}`;

    const response = await fetch(fullUrl, {
      method: options.method || 'GET',
      headers: options.headers || { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      // 强制直连，不通过系统代理
      agent: false,
    });

    if (options.responseType === 'blob') {
      const buffer = await response.buffer();
      return buffer;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Backend fetch error:', err);
    throw err;
  }
});

// ========== 后端进程 ==========
let backendProcess = null;
let backendRetryCount = 0;
const BACKEND_MAX_RETRIES = 3;
const BACKEND_RETRY_DELAY = 2000;

async function startBackend() {
  return new Promise((resolve, reject) => {
    let backendPath, backendArgs, backendCwd;

    // 优先级：resources/backend.exe > venv Python > 系统 Python
    const resourcesExe = path.join(__dirname, 'resources', 'backend', 'backend.exe');
    const projectRoot = path.join(__dirname, '..');
    const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');

    if (fs.existsSync(resourcesExe)) {
      // 已有打包好的 backend.exe（最优先，全自包含）
      backendPath = resourcesExe;
      backendArgs = [];
      backendCwd = path.dirname(resourcesExe);
      console.log('使用自包含 backend.exe:', backendPath);
    } else if (isDev && fs.existsSync(venvPython)) {
      // 开发模式：venv Python
      backendPath = venvPython;
      backendArgs = ['-m', 'backend.server'];
      backendCwd = projectRoot;
      console.log('开发模式：使用 venv Python:', backendPath);
    } else if (isDev) {
      // 开发模式：系统 Python
      backendPath = process.platform === 'win32' ? 'python' : 'python3';
      backendArgs = ['-m', 'backend.server'];
      backendCwd = projectRoot;
      console.log('开发模式：使用系统 Python');
    } else {
      // 生产模式：ExtraResources 中的 backend.exe
      backendPath = path.join(process.resourcesPath, 'backend', 'backend.exe');
      backendArgs = [];
      backendCwd = path.dirname(backendPath);
      console.log('生产模式：启动 backend.exe:', backendPath);
    }

    console.log('启动后端进程...');
    const dataDir = initDataDir();
    backendProcess = spawn(backendPath, backendArgs, {
      cwd: backendCwd,
      shell: false,
      env: {
        ...process.env,
        VISION_DATA_DIR: dataDir,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      windowsHide: false,
    });

    let started = false;
    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Backend]', msg.trim());
      if (!started && (msg.includes('Running on') || msg.includes('Debugger'))) {
        started = true;
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      console.error('[Backend Error]', data.toString().trim());
    });

    backendProcess.on('error', (err) => {
      console.error('后端进程错误:', err.message);
      if (!started) reject(err);
    });

    backendProcess.on('close', (code) => {
      console.log(`后端进程退出，代码: ${code}`);
      // 异常退出时自动重启（code !== 0 且未被主动停止）
      if (code !== 0 && backendProcess !== null && backendRetryCount < BACKEND_MAX_RETRIES) {
        backendRetryCount++;
        console.log(`后端异常退出，${BACKEND_RETRY_DELAY / 1000}秒后第 ${backendRetryCount} 次重试...`);
        setTimeout(() => {
          if (backendProcess === null) return; // 已被 stopBackend 清理
          startBackend().then(() => waitForBackend()).catch(() => { });
        }, BACKEND_RETRY_DELAY);
        return;
      }
      backendProcess = null;
      if (!started) reject(new Error(`后端进程异常退出 (代码 ${code})，请检查上方日志`));
    });

    setTimeout(() => { if (!started) { started = true; resolve(); } }, 15000);
  });
}

async function waitForBackend(timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const fetch = (await import('node-fetch')).default;
      const res = await fetch('http://127.0.0.1:5000/api/health', { agent: false });
      if (res.ok) {
        console.log('后端就绪');
        return true;
      }
    } catch (err) {
      // 继续等待
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('后端启动超时');
}

function stopBackend() {
  if (backendProcess) {
    console.log('停止后端进程...');
    try {
      // Windows 上 PyInstaller exe 不响应 SIGTERM，用 taskkill 强杀
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /PID ${backendProcess.pid} /T`, { stdio: 'ignore' });
      } else {
        backendProcess.kill('SIGKILL');
      }
    } catch (e) {
      // taskkill 失败时尝试普通 kill
      try { backendProcess.kill(); } catch (_) { }
    }
    backendProcess = null;
  }
}

// ========== 主窗口 ==========
let mainWindow;
let cameraPopouts = {}; // { camId: BrowserWindow }

function createCameraPopoutWindow(camId) {
  // Allow multiple popouts per camera — always create a new window
  if (cameraPopouts[camId]) {
    cameraPopouts[camId].focus();
  }

  const popout = new BrowserWindow({
    width: 640,
    height: 520,
    minWidth: 400,
    minHeight: 300,
    title: `Cam ${camId}`,
    parent: mainWindow,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: true,
    resizable: true,
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cam ${camId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#f8f9fa;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
.container{display:flex;flex-direction:column;height:100%}
.header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;border-bottom:1px solid #e5e7eb}
.header .title{color:#111827;font-size:14px;font-weight:600}
.header .badge{padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600}
.badge-ok{background:#ecfdf5;color:#059669}
.badge-ng{background:#fef2f2;color:#dc2626}
.badge-wait{background:#f3f4f6;color:#9ca3af}
.badge-error{background:#fef2f2;color:#dc2626}
.image-area{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}
.image-area img{max-width:100%;max-height:100%;object-fit:contain}
.image-area .placeholder{color:#9ca3af;font-size:14px}
.footer{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px}
</style></head>
<body><div class="container">
<div class="header"><span class="title">📷 Cam ${camId}</span><span class="badge badge-wait" id="badge">等待检测</span></div>
<div class="image-area"><img id="frame" style="display:none"><span class="placeholder" id="placeholder">等待相机信号...</span></div>
<div class="footer"><span id="result">--</span><span id="time"></span></div>
</div>
<script>
var camId=${camId},frameEl=document.getElementById('frame'),placeholderEl=document.getElementById('placeholder'),badgeEl=document.getElementById('badge'),resultEl=document.getElementById('result'),timeEl=document.getElementById('time');
async function updateFrame(){try{var res=await fetch('http://127.0.0.1:5000/api/frame/'+camId);if(!res.ok)return;var blob=await res.blob(),url=URL.createObjectURL(blob);frameEl.src=url;frameEl.style.display='';placeholderEl.style.display='none';setTimeout(function(){URL.revokeObjectURL(url)},2000)}catch(e){}}
async function updateStatus(){try{var res=await fetch('http://127.0.0.1:5000/api/status');var data=await res.json(),cs=data.cameras&&data.cameras[camId];if(!cs)return;timeEl.textContent=cs.lastFrameTime||'';resultEl.style.color='#6b7280';if(cs.state==='running'&&cs.result){var isOk=cs.result.label==='类别A';badgeEl.textContent=cs.result.label;badgeEl.className='badge '+(isOk?'badge-ok':'badge-ng');resultEl.textContent=cs.result.label+' ('+Math.round(cs.result.confidence*100)+'%)';resultEl.style.color=isOk?'#059669':'#dc2626'}else if(cs.state==='running'){badgeEl.textContent='等待触发';badgeEl.className='badge badge-wait';resultEl.textContent='已触发 '+(cs.totalTriggers||0)+' 次';resultEl.style.color='#d97706'}else if(cs.state==='error'){badgeEl.textContent='错误';badgeEl.className='badge badge-error';resultEl.textContent=cs.error||'未知错误';resultEl.style.color='#dc2626'}}catch(e){}}
updateFrame();updateStatus();setInterval(updateFrame,1000);setInterval(updateStatus,500);
</script></body></html>`;

  popout.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  popout.on('closed', () => {
    delete cameraPopouts[camId];
    if (mainWindow) {
      mainWindow.webContents.send('camera-popout-closed', camId);
    }
  });

  popout.setMenuBarVisibility(false);
  cameraPopouts[camId] = popout;
}

function closeCameraPopoutWindow(camId) {
  if (cameraPopouts[camId]) {
    cameraPopouts[camId].close();
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '视觉检测系统 V2.0',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'js', 'preload.js'),
    },
  });

  // Vite 开发模式 / 生产模式
  if (isDev) {
    // 尝试连接 Vite 开发服务器
    mainWindow.loadURL(VITE_DEV_URL).catch(() => {
      // 降级到 dist 目录
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    });
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式：加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.maximize();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createErrorWindow(title, message) {
  if (mainWindow) return; // 已有窗口

  mainWindow = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    title: title,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
.card{text-align:center;padding:40px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:18px;margin-bottom:12px;color:#f87171}
p{font-size:13px;color:#9ca3af;white-space:pre-line;line-height:1.6}
.btn{margin-top:20px;background:#5b6ef5;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#7b8cf8}
</style></head>
<body>
<div class="card">
  <div class="icon">⚠️</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <button class="btn" onclick="window.close()">关闭</button>
</div>
</body></html>`;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  ensureDataDir();

  let backendReady = false;
  for (let attempt = 1; attempt <= BACKEND_MAX_RETRIES; attempt++) {
    try {
      console.log(`启动后端 (尝试 ${attempt}/${BACKEND_MAX_RETRIES})...`);
      backendRetryCount = attempt - 1;
      await startBackend();
      await waitForBackend();
      backendReady = true;
      console.log('后端启动成功，打开主窗口');
      break;
    } catch (err) {
      console.error(`后端启动失败 (尝试 ${attempt}):`, err.message);
      if (attempt < BACKEND_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BACKEND_RETRY_DELAY));
      }
    }
  }

  if (!backendReady) {
    // 显示错误页面而非空白
    createErrorWindow('后端启动失败',
      '无法启动检测引擎。请确认:\n\n1. backend.exe 未被杀毒软件拦截\n2. 5000 端口未被占用\n3. 文件目录有写入权限\n\n请关闭此窗口后重新尝试。');
    return;
  }

  createWindow();
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  // 关闭所有摄像头弹窗
  Object.keys(cameraPopouts).forEach(id => {
    try { cameraPopouts[id].close(); } catch (e) { }
  });
  stopBackend();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

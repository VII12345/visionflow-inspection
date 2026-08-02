import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';

export const isTauri = () => typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export async function saveData(key: string, data: unknown): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('save_data', { key, data });
}

export async function loadData<T = unknown>(key: string): Promise<T | null> {
  if (!isTauri()) return null;
  return invoke<T | null>('load_data', { key });
}

export async function getDataPath(): Promise<string> {
  if (!isTauri()) return '浏览器本地存储';
  return invoke<string>('get_data_path');
}

export async function selectLocalFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择图片文件夹（需包含类别子目录）',
  });
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/**
 * 网页端本地目录选择：使用 File System Access API（Chrome/Edge 支持）。
 * 受浏览器安全限制，只能获取目录名称，无法取得真实磁盘路径；不支持时抛错。
 */
export async function pickDirectoryWeb(): Promise<string | null> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('当前浏览器不支持本地目录选择，请使用 Chrome/Edge，或改用"选择后端目录"');
  }
  const handle = await window.showDirectoryPicker();
  return handle?.name || null;
}

/** 统一目录选择：桌面端走 Tauri 对话框，网页端走 File System Access API。 */
export async function pickDirectory(): Promise<string | null> {
  if (isTauri()) return selectLocalFolder();
  return pickDirectoryWeb();
}

export async function openCameraPopout(camId: number): Promise<void> {
  if (!isTauri()) throw new Error('当前环境不是 Tauri 桌面端');
  const label = `camera-popout-${camId}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const popout = new WebviewWindow(label, {
    url: `index.html#/camera-popout/${camId}`,
    title: `相机 ${camId}`,
    width: 760,
    height: 560,
    minWidth: 520,
    minHeight: 400,
    resizable: true,
    center: true,
  });
  // WebviewWindow 的创建是异步 IPC；必须等 tauri://created 确认窗口真正创建成功，
  // 否则窗口创建失败也会被当作成功（旧实现只在 once 上挂监听、并不等待事件）。
  await new Promise<void>((resolve, reject) => {
    popout.once('tauri://created', () => resolve());
    popout.once('tauri://error', (event: unknown) => {
      const payload = (event as { payload?: unknown })?.payload;
      reject(new Error(typeof payload === 'string' ? payload : '创建相机窗口失败'));
    });
  });
  popout.once('tauri://destroyed', () => {
    void emit('camera-popout-closed', camId);
  });
}

export async function closeCameraPopout(camId: number): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(`camera-popout-${camId}`);
  if (existing) await existing.close();
}

export function subscribeCameraPopoutClosed(callback: (camId: number) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<number>('camera-popout-closed', event => callback(event.payload));
}


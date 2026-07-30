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
  await popout.once('tauri://created', () => undefined);
  await popout.once('tauri://destroyed', () => {
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


import type { User, Product, LineConfig, CameraConfig, CameraStats, SaveSettings, Photo, RunLayout } from '../types';

const isElectron = () => typeof window !== 'undefined' && window.electronAPI;

function get<T>(key: string, fallback: T): T {
  if (isElectron()) {
    try {
      const data = window.electronAPI.loadData(key);
      if (data !== null && data !== undefined) return data as T;
    } catch { /* ignore */ }
  }
  try {
    const raw = localStorage.getItem('vision_' + key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(fallback));
}

function set<T>(key: string, data: T): void {
  if (isElectron()) {
    try { window.electronAPI.saveData(key, data); } catch { /* ignore */ }
  }
  localStorage.setItem('vision_' + key, JSON.stringify(data));
}

const defaults = {
  users: [{ id: 1, name: 'admin', password: 'admin', level: 'admin' }] as User[],
  products: [] as Product[],
  lineCount: 4,
  runLayout: { id: 'two', columns: 2, order: [] } as RunLayout,
  lineConfig: [
    { line: 1, productId: null, model: '-' },
    { line: 2, productId: null, model: '-' },
    { line: 3, productId: null, model: '-' },
    { line: 4, productId: null, model: '-' },
  ] as LineConfig[],
  cameraConfig: {} as Record<number, Partial<CameraConfig>>,
  cameraStats: {
    1: { detected: 0, defective: 0 },
    2: { detected: 0, defective: 0 },
    3: { detected: 0, defective: 0 },
    4: { detected: 0, defective: 0 },
  } as Record<number, CameraStats>,
  photos: { 1: [], 2: [], 3: [], 4: [] } as Record<number, Photo[]>,
  saveSettings: {
    1: { saveGood: true, saveBad: true },
    2: { saveGood: true, saveBad: true },
    3: { saveGood: true, saveBad: true },
    4: { saveGood: true, saveBad: true },
  } as Record<number, SaveSettings>,
};

export const storage = {
  getUsers: () => get('users', defaults.users),
  saveUsers: (users: User[]) => set('users', users),

  getProducts: () => get('products', defaults.products),
  saveProducts: (products: Product[]) => set('products', products),

  getLineCount: () => {
    const raw = Number(get('lineCount', defaults.lineCount));
    return Number.isFinite(raw) ? Math.min(16, Math.max(1, Math.round(raw))) : defaults.lineCount;
  },
  saveLineCount: (count: number) => {
    const nextCount = Math.min(16, Math.max(1, Math.round(Number(count) || defaults.lineCount)));
    set('lineCount', nextCount);
    const current = get('lineConfig', defaults.lineConfig) as LineConfig[];
    const next = Array.from({ length: nextCount }, (_, index) => current[index] || {
      line: index + 1,
      productId: null,
      model: '-',
    });
    set('lineConfig', next);
    return nextCount;
  },
  getLineConfig: () => {
    const count = storage.getLineCount();
    const current = get('lineConfig', defaults.lineConfig) as LineConfig[];
    return Array.from({ length: count }, (_, index) => current[index] || {
      line: index + 1,
      productId: null,
      model: '-',
    });
  },
  saveLineConfig: (cfg: LineConfig[]) => set('lineConfig', cfg),
  getRunLayout: () => get('runLayout', defaults.runLayout),
  saveRunLayout: (layout: RunLayout) => set('runLayout', layout),

  getCameraConfig: () => get('cameraConfig', defaults.cameraConfig),
  saveCameraConfig: (cfg: Record<number, Partial<CameraConfig>>) => set('cameraConfig', cfg),

  getCameraStats: () => get('cameraStats', defaults.cameraStats),
  saveCameraStats: (st: Record<number, CameraStats>) => set('cameraStats', st),
  resetCameraStats: (camId: number) => {
    const stats = get('cameraStats', defaults.cameraStats);
    stats[camId] = { detected: 0, defective: 0 };
    set('cameraStats', stats);
    return stats;
  },

  getPhotos: (camId: number) => {
    const all = get('photos', defaults.photos);
    return all[camId] || [];
  },
  addPhoto: (camId: number, result: string) => {
    const all = get('photos', defaults.photos);
    if (!all[camId]) all[camId] = [];
    all[camId].unshift({
      id: String(Date.now() + Math.random()),
      time: new Date().toLocaleString(),
      result,
      filename: `CAM${camId}_${Date.now()}.jpg`,
    });
    if (all[camId].length > 100) all[camId] = all[camId].slice(0, 100);
    set('photos', all);
  },

  getSaveSettings: () => get('saveSettings', defaults.saveSettings),
  saveSaveSettings: (st: Record<number, SaveSettings>) => set('saveSettings', st),

  getStorageInfo: () => {
    if (isElectron()) {
      try {
        return { type: 'encrypted' as const, path: window.electronAPI.getDataPath() };
      } catch { /* ignore */ }
    }
    return { type: 'localStorage' as const, path: '浏览器本地存储' };
  },

  getCurrentUser: (): User | null => {
    return get('currentUser', null);
  },
  setCurrentUser: (user: User | null) => {
    set('currentUser', user);
  },
};

export default storage;


import type { User, Product, LineConfig, CameraConfig, CameraStats, SaveSettings, Photo, RunLayout } from '../types';
import { getDataPath, isTauri, loadData, saveData } from './native';

let nativeDataPath = '浏览器本地存储';

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('vision_' + key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(fallback));
}

function set<T>(key: string, data: T): void {
  localStorage.setItem('vision_' + key, JSON.stringify(data));
  if (isTauri()) void saveData(key, data).catch(() => { /* keep local cache available */ });
}
const defaults = {
  users: [{ id: 1, name: 'admin', password: 'admin', level: 'admin' }] as User[],
  rememberLogin: true,
  products: [] as Product[],
  runLayout: { id: 'two', columns: 2, order: [] } as RunLayout,
  lineConfig: [
    { line: 1, name: '线体 1', productId: null, model: '-' },
    { line: 2, name: '线体 2', productId: null, model: '-' },
    { line: 3, name: '线体 3', productId: null, model: '-' },
    { line: 4, name: '线体 4', productId: null, model: '-' },
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

function normalizeProducts(raw: Product[]): Product[] {
  return (Array.isArray(raw) ? raw : []).map(product => ({
    ...product,
    name: String(product.name || product.model || `产品 ${product.id}`),
    model: String(product.model || product.name || `product_${product.id}`),
  }));
}

function lineDefault(index: number): LineConfig {
  return { line: index + 1, name: `线体 ${index + 1}`, productId: null, model: '-' };
}

function normalizeLineConfig(raw: LineConfig[], count: number): LineConfig[] {
  const products = normalizeProducts(get('products', defaults.products));
  return Array.from({ length: count }, (_, index) => {
    const item = (Array.isArray(raw) ? raw[index] : undefined) || lineDefault(index);
    const product = products.find(candidate => candidate.id === item.productId);
    return {
      ...lineDefault(index),
      ...item,
      line: index + 1,
      name: String(item.name || `线体 ${index + 1}`),
      model: product?.model || item.model || '-',
    };
  });
}

export const storage = {
  initialize: async () => {
    if (!isTauri()) return;
    const keys = ['users', 'rememberLogin', 'products', 'lineConfig', 'runLayout', 'cameraConfig', 'cameraStats', 'photos', 'saveSettings', 'currentUser'];
    await Promise.all(keys.map(async key => {
      try {
        const data = await loadData(key);
        if (data !== null && data !== undefined) localStorage.setItem('vision_' + key, JSON.stringify(data));
      } catch { /* use the local cache/defaults */ }
    }));
    try {
      nativeDataPath = await getDataPath();
    } catch { /* keep browser label */ }
  },
  getUsers: () => get('users', defaults.users),
  saveUsers: (users: User[]) => set('users', users),

  // 产品显示名可随时修改；model 保留为模型文件和后端训练任务的稳定关联键。
  getProducts: () => normalizeProducts(get('products', defaults.products)),
  saveProducts: (products: Product[]) => set('products', normalizeProducts(products)),

  getLineConfig: (count?: number) => {
    const raw = get('lineConfig', defaults.lineConfig);
    const persistedCount = Array.isArray(raw) && raw.length > 0 ? raw.length : defaults.lineConfig.length;
    const nextCount = Number.isFinite(count) ? Math.min(16, Math.max(1, Math.round(Number(count)))) : persistedCount;
    return normalizeLineConfig(raw, nextCount);
  },
  saveLineConfig: (cfg: LineConfig[]) => {
    const count = Math.min(16, Math.max(1, cfg.length || defaults.lineConfig.length));
    set('lineConfig', normalizeLineConfig(cfg, count));
  },
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

  getStorageInfo: () => isTauri()
    ? { type: 'encrypted' as const, path: nativeDataPath }
    : { type: 'localStorage' as const, path: '浏览器本地存储' },

  getRememberLogin: () => Boolean(get('rememberLogin', defaults.rememberLogin)),
  setRememberLogin: (remember: boolean) => set('rememberLogin', remember),
  getCurrentUser: (): User | null => get('currentUser', null),
  setCurrentUser: (user: User | null) => set('currentUser', user),
  getAuthToken: (): string | null => {
    try { return localStorage.getItem('vision_authToken'); } catch { return null; }
  },
  setAuthToken: (token: string | null) => {
    try {
      if (token) localStorage.setItem('vision_authToken', token);
      else localStorage.removeItem('vision_authToken');
    } catch { /* ignore */ }
  },
};

export default storage;

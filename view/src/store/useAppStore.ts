import { create } from 'zustand';
import type { User, TabId } from '../types';
import { storage } from '../services/storage';

interface TrainingResult {
  modelName: string;
  modelPath: string | null;
  evalResult: Record<string, unknown> | null;
  errorMessage: string | null;
  trainCount: number;
  valCount: number;
}

interface AppState {
  // Auth
  user: User | null;
  login: (name: string, password: string) => boolean;
  logout: () => void;

  // System
  isRunning: boolean;
  setRunning: (running: boolean) => void;

  // Tabs
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  dynamicTabs: Set<string>;
  openDynamicTab: (tabId: string) => void;
  closeDynamicTab: (tabId: string) => void;

  // Modals
  loginModal: boolean;
  changePwdModal: boolean;
  addProductModal: boolean;
  learnConfirmModal: boolean;
  envCheckModal: boolean;
  cameraConfigModal: boolean;
  trainingCompleteModal: boolean;
  cameraConfigCamId: number | null;
  setCameraConfigCamId: (camId: number | null) => void;
  setModal: (modal: string, open: boolean) => void;

  // Training result
  trainingResult: TrainingResult;
  setTrainingResult: (result: TrainingResult) => void;

  // Messages
  statusMessage: string;
  showMessage: (msg: string) => void;

  // Camera pop-out
  poppedOutCam: number | null;
  setPoppedOutCam: (camId: number | null) => void;

  // Environment
  envResult: unknown;
  setEnvResult: (r: unknown) => void;

  // Learn confirm callback (for SettingsTab <-> LearnConfirmModal communication)
  learnCallback: ((upright: string, inverted: string, folder: string) => void) | null;
  setLearnCallback: (cb: ((upright: string, inverted: string, folder: string) => void) | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: (() => { const u = storage.getCurrentUser(); return u ? { ...u, password: '' } : null; })(),
  isRunning: false,
  activeTab: 'run',
  dynamicTabs: new Set(),
  loginModal: false,
  changePwdModal: false,
  addProductModal: false,
  learnConfirmModal: false,
  envCheckModal: false,
  cameraConfigModal: false,
  trainingCompleteModal: false,
  cameraConfigCamId: null,
  setCameraConfigCamId: (camId) => set({ cameraConfigCamId: camId, cameraConfigModal: camId !== null }),
  statusMessage: '系统就绪',
  envResult: null,
  learnCallback: null,
  setLearnCallback: (cb) => set({ learnCallback: cb }),

  trainingResult: { modelName: '', modelPath: null, evalResult: null, errorMessage: null, trainCount: 0, valCount: 0 },
  setTrainingResult: (result) => set({ trainingResult: result }),

  login: (name, password) => {
    const users = storage.getUsers();
    const found = users.find(u => u.name === name && u.password === password);
    if (found) {
      set({ user: { id: found.id, name: found.name, level: found.level, password: '' } });
      storage.setCurrentUser({ id: found.id, name: found.name, level: found.level, password: '' });
      get().showMessage(`登录成功，欢迎 ${found.name}`);
      return true;
    }
    return false;
  },

  logout: () => {
    set({ user: null });
    storage.setCurrentUser(null);
    set({ activeTab: 'run' });
    get().showMessage('已登出');
  },

  setRunning: (running) => set({ isRunning: running }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  openDynamicTab: (tabId) => {
    set(state => {
      const newTabs = new Set(state.dynamicTabs);
      newTabs.add(tabId);
      return { dynamicTabs: newTabs, activeTab: tabId as TabId };
    });
  },

  closeDynamicTab: (tabId) => {
    set(state => {
      const newTabs = new Set(state.dynamicTabs);
      newTabs.delete(tabId);
      return { dynamicTabs: newTabs, activeTab: 'run' };
    });
  },

  setModal: (modal, open) => {
    const key = `${modal}Modal` as keyof AppState;
    set({ [key]: open } as unknown as Partial<AppState>);
  },

  showMessage: (msg) => {
    set({ statusMessage: msg });
    setTimeout(() => {
      if (get().statusMessage === msg) set({ statusMessage: '系统就绪' });
    }, 3000);
  },

  setEnvResult: (r) => set({ envResult: r }),
  poppedOutCam: null,
  setPoppedOutCam: (camId) => set({ poppedOutCam: camId }),
}));

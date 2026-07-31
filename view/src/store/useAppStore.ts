import { create } from 'zustand';
import type { User, TabId, SystemAlarm } from '../types';
import { storage } from '../services/storage';

type ModalName = 'login' | 'changePwd' | 'addProduct' | 'learnConfirm' | 'envCheck' | 'cameraConfig' | 'trainingComplete' | 'all';

type ModalStateKey = keyof Pick<AppState, 'loginModal' | 'changePwdModal' | 'addProductModal' | 'learnConfirmModal' | 'envCheckModal' | 'cameraConfigModal' | 'trainingCompleteModal'>;

const MODAL_STATE_KEYS: Record<Exclude<ModalName, 'all'>, ModalStateKey> = {
  login: 'loginModal',
  changePwd: 'changePwdModal',
  addProduct: 'addProductModal',
  learnConfirm: 'learnConfirmModal',
  envCheck: 'envCheckModal',
  cameraConfig: 'cameraConfigModal',
  trainingComplete: 'trainingCompleteModal',
};

interface AppState {
  // Auth
  user: User | null;
  login: (name: string, password: string) => boolean;
  logout: () => void;

  // System
  isRunning: boolean;
  setRunning: (running: boolean) => void;
  lineCount: number;
  catalogRevision: number;
  setLineCount: (count: number) => void;
  refreshCatalog: () => void;

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
  setModal: (modal: ModalName, open: boolean) => void;

  // Messages
  statusMessage: string;
  showMessage: (msg: string) => void;

  // Camera pop-out
  poppedOutCams: Set<number>;
  togglePopoutCam: (camId: number) => void;

  // Environment
  envResult: unknown;
  setEnvResult: (r: unknown) => void;

  // Startup / connection alarms
  systemAlarm: SystemAlarm | null;
  raiseAlarm: (alarm: SystemAlarm) => void;
  clearAlarm: () => void;

  // Learn confirm callback (for SettingsTab <-> LearnConfirmModal communication)
  learnCallback: ((categoryRoot: string) => void) | null;
  setLearnCallback: (cb: ((categoryRoot: string) => void) | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: (() => {
    if (!storage.getRememberLogin()) { storage.setCurrentUser(null); return null; }
    const u = storage.getCurrentUser();
    return u ? { ...u, password: '' } : null;
  })(),
  isRunning: false,
  lineCount: storage.getLineCount(),
  catalogRevision: 0,
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
  systemAlarm: null,
  learnCallback: null,
  setLearnCallback: (cb) => set({ learnCallback: cb }),


  login: (name, password) => {
    const users = storage.getUsers();
    const found = users.find(u => u.name === name && u.password === password);
    if (found) {
      set({ user: { id: found.id, name: found.name, level: found.level, password: '' } });
      if (storage.getRememberLogin()) {
        storage.setCurrentUser({ id: found.id, name: found.name, level: found.level, password: '' });
      } else {
        storage.setCurrentUser(null);
      }
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
  setLineCount: (count) => {
    const nextCount = storage.saveLineCount(count);
    set({ lineCount: nextCount });
  },
  refreshCatalog: () => set(state => ({ catalogRevision: state.catalogRevision + 1 })),

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
    if (modal === 'all') {
      set({
        loginModal: open,
        changePwdModal: open,
        addProductModal: open,
        learnConfirmModal: open,
        envCheckModal: open,
        cameraConfigModal: open,
        trainingCompleteModal: open,
      });
      return;
    }
    const key = MODAL_STATE_KEYS[modal];
    set({ [key]: open } as Pick<AppState, ModalStateKey>);
  },

  showMessage: (msg) => {
    set({ statusMessage: msg });
    setTimeout(() => {
      if (get().statusMessage === msg) set({ statusMessage: '系统就绪' });
    }, 3000);
  },

  setEnvResult: (r) => set({ envResult: r }),
  raiseAlarm: (alarm) => set({ systemAlarm: alarm }),
  clearAlarm: () => set({ systemAlarm: null }),
  poppedOutCams: new Set<number>(),
  togglePopoutCam: (camId) => set(state => {
    const next = new Set(state.poppedOutCams);
    if (next.has(camId)) next.delete(camId);
    else next.add(camId);
    return { poppedOutCams: next };
  }),
}));

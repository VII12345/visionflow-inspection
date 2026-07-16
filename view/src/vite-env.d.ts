/// <reference types="vite/client" />

interface ElectronAPI {
  saveData: (key: string, data: unknown) => boolean;
  loadData: (key: string) => unknown;
  getDataPath: () => string;
  selectFolder: () => Promise<string | null>;
  backendFetch: (url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    responseType?: string;
  }) => Promise<unknown>;
  openCameraPopout: (camId: number) => void;
  closeCameraPopout: (camId: number) => void;
  onCameraPopoutClosed: (callback: (camId: number) => void) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}

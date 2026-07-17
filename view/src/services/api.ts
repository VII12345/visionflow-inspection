const API_BASE = 'http://127.0.0.1:5000';

async function backendFetch<T = unknown>(url: string, options?: {
  method?: string;
  body?: unknown;
  responseType?: string;
}): Promise<T> {
  if (window.electronAPI) {
    return window.electronAPI.backendFetch(url, {
      method: options?.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options?.body,
      responseType: options?.responseType,
    }) as Promise<T>;
  }
  // Fallback: direct fetch
  const res = await fetch(`${API_BASE}${url}`, {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (options?.responseType === 'blob') {
    return res.blob() as Promise<T>;
  }
  return res.json();
}

export const api = {
  // Health
  health: () => backendFetch<{ status: string }>('/api/health'),

  // System control
  start: (camProducts?: Record<number, string>) => backendFetch<{ success: boolean; message?: string }>('/api/start', { method: 'POST', body: { camProducts } }),
  stop: () => backendFetch<{ success: boolean; message?: string }>('/api/stop', { method: 'POST' }),
  status: () => backendFetch<{ cameras: Record<number, { state: string; result?: { label: string; confidence: number }; lastFrameTime?: string; totalTriggers?: number; stats?: { detected: number; defective: number }; error?: string }> }>('/api/status'),

  // Frames
  getFrame: (camId: number) => backendFetch<ArrayBuffer>(`/api/frame/${camId}`, { responseType: 'blob' }),

  // Camera config
  getCameraConfig: (camId: number) => backendFetch<{ success: boolean; config: Record<string, unknown> }>(`/api/cameras/config/${camId}`),
  getAllCameraConfigs: () => backendFetch<{ success: boolean; config: { cameras: Record<string, Record<string, unknown>> } }>('/api/cameras/config'),
  saveCameraConfig: (camId: number, config: Record<string, unknown>) =>
    backendFetch<{ success: boolean; message?: string; plcSuccess?: boolean; plcError?: string }>(`/api/cameras/config/${camId}`, { method: 'POST', body: config }),
  testRejectSignal: (camId: number) =>
    backendFetch<{ success: boolean; camera?: number; address?: string; value?: number; error?: string }>(`/api/cameras/${camId}/plc/test-reject`, { method: 'POST' }),

  // Training
  startTraining: (params: { uprightPath?: string; invertedPath?: string; folderPath?: string; modelName: string }) =>
    backendFetch<{ success: boolean; message?: string }>('/api/training/start', { method: 'POST', body: params }),
  stopTraining: () => backendFetch('/api/training/stop', { method: 'POST' }),
  trainingStatus: () => backendFetch<{ running: boolean; progress: number; message: string; epoch: number; total_epochs: number; train_loss: number; val_loss: number; val_acc: number; modelPath?: string | null; evalResult?: Record<string, unknown> | null }>('/api/training/status'),

  // Models
  getModels: () => backendFetch<{ success: boolean; models: { name: string }[] }>('/api/models'),

  // Photos
  getPhotos: (camId: number) => backendFetch<{ success: boolean; photos: { filename: string; mtime: string; size: number; result: string; timestamp: number }[]; okCount: number; ngCount: number }>(`/api/photos/${camId}`),
  getPhotoUrl: (camId: number, filename: string) => `${API_BASE}/api/photos/${camId}/${filename}`,

  // Hardware & Device
  getHardware: () => backendFetch<{ success: boolean; hardware: { cpu: { model: string | null; cores: number | null; arch: string | null }; gpu: { name: string | null; memory_mb: number | null; cuda_available: boolean; cuda_version: string | null; count: number }; pytorch_version: string; training_device: string; inference_device: string } }>('/api/hardware'),
  getDeviceConfig: () => backendFetch<{ success: boolean; config: { training_device: string; inference_device: string } }>('/api/settings/device'),
  saveDeviceConfig: (config: { training_device: string; inference_device: string }) =>
    backendFetch<{ success: boolean; message?: string; config?: { training_device: string; inference_device: string } }>('/api/settings/device', { method: 'POST', body: config }),

  // Environment
  envCheck: () => backendFetch<{ passed: boolean; summary: string; results: { name: string; message: string; passed: boolean; level: string; detail?: string }[] }>('/api/env-check'),
};

export default api;

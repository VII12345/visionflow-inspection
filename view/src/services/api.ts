import type { ModelInfo, PlcConfig } from '../types';
const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
const isWebPage = typeof window !== 'undefined' && window.location.protocol !== 'file:' && !isElectron;
const configuredBackend = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('backend')
  : null;
// Web 模式优先使用同源 /api，由 Vite web:dev/web:preview 代理到后端，
// 避免局域网浏览器的 Private Network Access 预检拦截 POST 请求。
const API_BASE = isWebPage
  ? (configuredBackend || '')
  : 'http://127.0.0.1:5000';

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
    if (!res.ok) throw new Error(`后端请求失败 (${res.status})`);
    return res.blob() as Promise<T>;
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`后端返回了无效响应 (${res.status})`);
  }
  if (!res.ok) {
    const errorData = data as { message?: string; error?: string };
    throw new Error(errorData.message || errorData.error || `后端请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  // Health
  health: () => backendFetch<{ status: string }>('/api/health'),

  // System control
  start: (camProducts?: Record<number, string>, lineCount?: number, cameraIds?: number[]) => backendFetch<{ success: boolean; message?: string; errors?: string[]; started_cameras?: number[]; running?: boolean }>('/api/start', { method: 'POST', body: { camProducts, line_count: lineCount, camera_ids: cameraIds } }),
  stop: () => backendFetch<{ success: boolean; message?: string; running?: boolean }>('/api/stop', { method: 'POST' }),
  setLineEnabled: (camId: number, enabled: boolean) => backendFetch<{ success: boolean; enabled?: boolean; running?: boolean; message?: string }>(`/api/lines/${camId}`, { method: 'POST', body: { enabled } }),
  status: () => backendFetch<{ cameras: Record<number, { state: string; lineEnabled?: boolean; result?: { label: string; confidence: number }; lastFrameTime?: string; totalTriggers?: number; stats?: { detected: number; defective: number }; error?: string }> }>('/api/status'),

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
  startTraining: (params: { categoryRootPath?: string; classAPath?: string; classBPath?: string; folderPath?: string; modelName: string }) =>
    backendFetch<{ success: boolean; message?: string; error?: string }>('/api/training/start', { method: 'POST', body: params }),
  stopTraining: () => backendFetch('/api/training/stop', { method: 'POST' }),
  trainingStatus: () => backendFetch<{ running: boolean; progress: number; message: string; epoch: number; total_epochs: number; train_loss: number; val_loss: number; val_acc: number; modelPath?: string | null; evalResult?: Record<string, unknown> | null }>('/api/training/status'),

  // Models
  getModels: () => backendFetch<{ success: boolean; models: ModelInfo[] }>('/api/models'),
  saveModelSettings: (modelName: string, rejectLabels: string[], categoryDescriptions: Record<string, string> = {}) =>
    backendFetch<{ success: boolean; model?: string; categories?: string[]; reject_labels?: string[]; category_descriptions?: Record<string, string>; error?: string }>(`/api/models/${encodeURIComponent(modelName)}/settings`, { method: 'POST', body: { reject_labels: rejectLabels, category_descriptions: categoryDescriptions } }),

  // Model testing
  testModel: (params: { model_name: string; mode: 'labeled' | 'unlabeled'; category_root_path?: string; class_a_path?: string; class_b_path?: string; folder_path?: string }) =>
    backendFetch<{
      success: boolean;
      message?: string;
      mode: string;
      model_name: string;
      total: number;
      correct?: number;
      accuracy?: number;
      categories?: string[];
      category_counts?: Record<string, { total: number; correct: number; accuracy: number | null }>;
      class_a_total?: number;
      class_a_correct?: number;
      class_a_accuracy?: number | null;
      class_b_total?: number;
      class_b_correct?: number;
      class_b_accuracy?: number | null;
      timing?: {
        avg_ms: number;
        min_ms: number;
        max_ms: number;
        total_ms: number;
        pipeline_total_ms?: number;
        steps?: Record<string, { avg_ms: number; min_ms: number; max_ms: number; total_ms: number }>;
        step_labels?: Record<string, string>;
      };
      results: { filename: string; expected?: string; predicted: string; confidence: number; correct?: boolean; time_ms?: number; timing?: Record<string, number> }[];
    }>('/api/test', { method: 'POST', body: params }),

  // Statistics
  getStats: () => backendFetch<Record<number, { detected: number; defective: number }>>('/api/stats'),
  resetStats: (camId: number) => backendFetch<{ success: boolean; stats?: { detected: number; defective: number } }>(`/api/stats/reset/${camId}`, { method: 'POST' }),

  // Backend image directories
  getImageDirectories: () => backendFetch<{
    success: boolean;
    directories: { path: string; name: string; relativePath: string; root: string; imageCount: number }[];
  }>('/api/image-directories'),

  // Photo save settings and photos
  getSaveSettings: () => backendFetch<{ success: boolean; settings: Record<number, { saveGood: boolean; saveBad: boolean }> }>('/api/save-settings'),
  saveSaveSettings: (camId: number, settings: { saveGood: boolean; saveBad: boolean }) =>
    backendFetch<{ success: boolean; settings?: { saveGood: boolean; saveBad: boolean }; error?: string }>(`/api/save-settings/${camId}`, { method: 'POST', body: settings }),
  getPhotos: (camId: number) => backendFetch<{ success: boolean; photos: { filename: string; mtime: string; size: number; result: string; timestamp: number }[]; okCount: number; ngCount: number }>(`/api/photos/${camId}`),
  getPhotoUrl: (camId: number, filename: string) => `${API_BASE}/api/photos/${camId}/${encodeURIComponent(filename)}`,

  // PLC
  getPlcConfig: () => backendFetch<{ success: boolean; config: PlcConfig }>('/api/plc/config'),
  savePlcConfig: (config: PlcConfig) => backendFetch<{ success: boolean; config?: PlcConfig; message?: string; error?: string }>('/api/plc/config', { method: 'POST', body: config }),
  testPlcWrite: (payload: { camera_id: number; type: 'reject_time' | 'reject_delay' | 'reject_signal'; value: number }) => backendFetch<{ success: boolean; address?: string; value?: number; error?: string }>('/api/plc/test', { method: 'POST', body: payload }),

  // Hardware & Device
  getHardware: () => backendFetch<{
    success: boolean;
    hardware: {
      system: { os: string | null; os_version: string | null; os_release: string | null; hostname: string | null; python_version: string | null };
      cpu: { model: string | null; physical_cores: number | null; logical_cores: number | null; max_freq_mhz: number | null; current_freq_mhz: number | null; arch: string | null; usage_percent: number | null };
      memory: { total_gb: number | null; available_gb: number | null; used_gb: number | null; percent: number | null; speed_mhz: number | null };
      gpu: { name: string | null; memory_total_mb: number | null; memory_free_mb: number | null; memory_used_mb: number | null; cuda_available: boolean; cuda_version: string | null; count: number; compute_capability: string | null };
      disk: { project_drive: string | null; total_gb: number | null; used_gb: number | null; free_gb: number | null; percent: number | null; filesystem: string | null };
      network: { name: string; type: string; up: boolean; speed_mbps: number | null; speed_rx_mbps?: number | null; speed_tx_mbps?: number | null; ipv4: string[] }[];
      pytorch_version: string;
      training_device: string;
      inference_device: string;
      checks: Record<string, { label: string; pass: boolean; detail: string }>;
    }
  }>('/api/hardware'),
  getDeviceConfig: () => backendFetch<{ success: boolean; config: { training_device: string; inference_device: string } }>('/api/settings/device'),
  saveDeviceConfig: (config: { training_device: string; inference_device: string }) =>
    backendFetch<{ success: boolean; message?: string; config?: { training_device: string; inference_device: string } }>('/api/settings/device', { method: 'POST', body: config }),

  getLineCount: () => backendFetch<{ success: boolean; line_count: number }>('/api/settings/line-count'),
  saveLineCount: (line_count: number) =>
    backendFetch<{ success: boolean; message?: string; line_count?: number }>('/api/settings/line-count', { method: 'POST', body: { line_count } }),
  // Environment
  envCheck: () => backendFetch<{ passed: boolean; summary: string; results: { name: string; message: string; passed: boolean; level: string; detail?: string }[] }>('/api/env-check'),
};

export default api;

const API_BASE = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:5000`
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
    return res.blob() as Promise<T>;
  }
  return res.json();
}

export const api = {
  // Health
  health: () => backendFetch<{ status: string }>('/api/health'),

  // System control
  start: (camProducts?: Record<number, string>, lineCount?: number) => backendFetch<{ success: boolean; message?: string; errors?: string[] }>('/api/start', { method: 'POST', body: { camProducts, line_count: lineCount } }),
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

  // Model testing
  testModel: (params: { model_name: string; mode: 'labeled' | 'unlabeled'; upright_path?: string; inverted_path?: string; folder_path?: string }) =>
    backendFetch<{
      success: boolean;
      message?: string;
      mode: string;
      model_name: string;
      total: number;
      correct?: number;
      accuracy?: number;
      upright_total?: number;
      upright_correct?: number;
      upright_accuracy?: number | null;
      inverted_total?: number;
      inverted_correct?: number;
      inverted_accuracy?: number | null;
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

  // Photos
  getPhotos: (camId: number) => backendFetch<{ success: boolean; photos: { filename: string; mtime: string; size: number; result: string; timestamp: number }[]; okCount: number; ngCount: number }>(`/api/photos/${camId}`),
  getPhotoUrl: (camId: number, filename: string) => `${API_BASE}/api/photos/${camId}/${filename}`,

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


import type { PlcConfig, UserLevel } from '../types';
import { API_BASE, backendFetch } from './apiClient';
import { useAppStore } from '../store/useAppStore';
import type {
  AllCameraConfigsResponse, CameraConfigResponse, CameraStatusResponse, DeviceConfigResponse,
  EnvironmentCheckResponse, HardwareInfoResponse, HealthResponse, ImageDirectoriesResponse,
  LineCountResponse, ModelListResponse, PhotosResponse, PlcConfigResponse, PlcWritePayload,
  PlcWriteResponse, ResetStatsResponse, SaveCameraConfigResponse, SaveCameraSettingsResponse,
  SaveDeviceConfigResponse, SaveLineCountResponse, SaveModelSettingsResponse, SavePlcConfigResponse,
  SaveSettingsResponse, SetLineEnabledResponse, StartResponse, StartTrainingParams,
  StartTrainingResponse, StatsResponse, StopResponse, TestModelParams, TestModelResponse,
  TestRejectSignalResponse, TrainingStatusResponse,
} from '../types/api';

export const api = {
  health: () => backendFetch<HealthResponse>('/api/health'),
  login: (name: string, password: string) => backendFetch<{ success: boolean; message?: string; token?: string; user?: { id: number; name: string; level: UserLevel } }>('/api/auth/login', { method: 'POST', body: { name, password } }),
  changePassword: (old_password: string, new_password: string) => backendFetch<{ success: boolean; message?: string }>('/api/auth/change-password', { method: 'POST', body: { old_password, new_password } }),
  start: (camProducts?: Record<number, string>, lineCount?: number, cameraIds?: number[]) => backendFetch<StartResponse>('/api/start', { method: 'POST', body: { camProducts, line_count: lineCount, camera_ids: cameraIds } }),
  stop: () => backendFetch<StopResponse>('/api/stop', { method: 'POST' }),
  setLineEnabled: (camId: number, enabled: boolean) => backendFetch<SetLineEnabledResponse>(`/api/lines/${camId}`, { method: 'POST', body: { enabled } }),
  status: () => backendFetch<CameraStatusResponse>('/api/status'),
  getFrame: (camId: number) => backendFetch<ArrayBuffer>(`/api/frame/${camId}`, { responseType: 'blob' }),
  getCameraConfig: (camId: number) => backendFetch<CameraConfigResponse>(`/api/cameras/config/${camId}`),
  getAllCameraConfigs: () => backendFetch<AllCameraConfigsResponse>('/api/cameras/config'),
  saveCameraConfig: (camId: number, config: Record<string, unknown>) => backendFetch<SaveCameraConfigResponse>(`/api/cameras/config/${camId}`, { method: 'POST', body: config }),
  testRejectSignal: (camId: number) => backendFetch<TestRejectSignalResponse>(`/api/cameras/${camId}/plc/test-reject`, { method: 'POST' }),
  startTraining: (params: StartTrainingParams) => backendFetch<StartTrainingResponse>('/api/training/start', { method: 'POST', body: params }),
  stopTraining: () => backendFetch('/api/training/stop', { method: 'POST' }),
  trainingStatus: () => backendFetch<TrainingStatusResponse>('/api/training/status'),
  getModels: () => backendFetch<ModelListResponse>('/api/models'),
  deleteModel: (name: string) => backendFetch<{ success: boolean; model?: string; error?: string; references?: { type: string; label: string; detail: string }[] }>(`/api/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  renameModel: (name: string, newName: string) => backendFetch<{ success: boolean; model?: string; error?: string }>(`/api/models/${encodeURIComponent(name)}`, { method: 'PATCH', body: { name: newName } }),
  saveModelSettings: (modelName: string, rejectLabels: string[], categoryDescriptions: Record<string, string> = {}) => backendFetch<SaveModelSettingsResponse>(`/api/models/${encodeURIComponent(modelName)}/settings`, { method: 'POST', body: { reject_labels: rejectLabels, category_descriptions: categoryDescriptions } }),
  testModel: (params: TestModelParams) => backendFetch<TestModelResponse>('/api/test', { method: 'POST', body: params }),
  getStats: () => backendFetch<StatsResponse>('/api/stats'),
  resetStats: (camId: number) => backendFetch<ResetStatsResponse>(`/api/stats/reset/${camId}`, { method: 'POST' }),
  getImageDirectories: () => backendFetch<ImageDirectoriesResponse>('/api/image-directories'),
  getSaveSettings: () => backendFetch<SaveSettingsResponse>('/api/save-settings'),
  saveSaveSettings: (camId: number, settings: { saveGood: boolean; saveBad: boolean }) => backendFetch<SaveCameraSettingsResponse>(`/api/save-settings/${camId}`, { method: 'POST', body: settings }),
  getPhotos: (camId: number) => backendFetch<PhotosResponse>(`/api/photos/${camId}`),
  getPhotoUrl: (camId: number, filename: string) => {
    // <img> 标签无法附带请求头，登录开启时通过查询参数携带 token。
    const base = `${API_BASE}/api/photos/${camId}/${encodeURIComponent(filename)}`;
    const token = useAppStore.getState().authToken;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  getPlcConfig: () => backendFetch<PlcConfigResponse>('/api/plc/config'),
  savePlcConfig: (config: PlcConfig) => backendFetch<SavePlcConfigResponse>('/api/plc/config', { method: 'POST', body: config }),
  testPlcWrite: (payload: PlcWritePayload) => backendFetch<PlcWriteResponse>('/api/plc/test', { method: 'POST', body: payload }),
  getHardware: () => backendFetch<HardwareInfoResponse>('/api/hardware'),
  getDeviceConfig: () => backendFetch<DeviceConfigResponse>('/api/settings/device'),
  saveDeviceConfig: (config: { training_device: string; inference_device: string }) => backendFetch<SaveDeviceConfigResponse>('/api/settings/device', { method: 'POST', body: config }),
  getLineCount: () => backendFetch<LineCountResponse>('/api/settings/line-count'),
  saveLineCount: (line_count: number) => backendFetch<SaveLineCountResponse>('/api/settings/line-count', { method: 'POST', body: { line_count } }),
  envCheck: () => backendFetch<EnvironmentCheckResponse>('/api/env-check'),
};

export default api;

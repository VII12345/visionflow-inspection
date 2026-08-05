import type { CameraStats, CameraStatus, EnvCheckResult, ModelInfo, PlcConfig, SystemStatus, TrainingStatus } from './index';

export interface HealthResponse { status: string; version?: string; cameras?: Record<number, boolean>; modelLoaded?: boolean; running?: boolean; dataDir?: string; }
export interface InitialPasswordResponse { success: boolean; username?: string | null; password?: string | null; }
export interface StartResponse { success: boolean; message?: string; errors?: string[]; started?: number; started_cameras?: number[]; total?: number; running?: boolean; }
export interface StopResponse { success: boolean; message?: string; running?: boolean; }
export interface SetLineEnabledResponse { success: boolean; enabled?: boolean; running?: boolean; message?: string; }
export interface CameraStatusResponse extends SystemStatus { cameras: Record<number, CameraStatus>; system?: { running: boolean; modelLoaded?: boolean }; }

export interface CameraConfigResponse { success: boolean; config: Record<string, unknown>; }
export interface SaveCameraConfigResponse { success: boolean; message?: string; plcSuccess?: boolean; plcError?: string; }

export interface StartTrainingParams { categoryRootPath?: string; classAPath?: string; classBPath?: string; folderPath?: string; modelName: string; }
export interface StartTrainingResponse { success: boolean; message?: string; error?: string; }
export type TrainingStatusResponse = TrainingStatus & { modelPath?: string | null; evalResult?: Record<string, unknown> | null; trainCount?: number; valCount?: number };
export interface ModelListResponse { success: boolean; models: ModelInfo[]; }
export interface SaveModelSettingsResponse { success: boolean; model?: string; categories?: string[]; reject_labels?: string[]; category_descriptions?: Record<string, string>; error?: string; }

export interface TestModelParams { model_name: string; mode: 'labeled' | 'unlabeled'; category_root_path?: string; class_a_path?: string; class_b_path?: string; folder_path?: string; }
export interface TimingSummary { avg_ms: number; min_ms: number; max_ms: number; total_ms: number; pipeline_total_ms?: number; steps?: Record<string, TimingSummary>; step_labels?: Record<string, string>; }
export interface TestModelResponse {
  success: boolean; message?: string; mode: string; model_name: string; total: number; correct?: number; accuracy?: number; categories?: string[];
  category_counts?: Record<string, { total: number; correct: number; accuracy: number | null }>;
  timing?: TimingSummary;
  results: { filename: string; expected?: string; predicted: string; confidence: number; correct?: boolean; time_ms?: number; timing?: Record<string, number> }[];
}

export interface ResetStatsResponse { success: boolean; stats?: CameraStats; }
export interface ImageDirectory { path: string; name: string; relativePath: string; root: string; imageCount: number; }
export interface ImageDirectoriesResponse { success: boolean; directories: ImageDirectory[]; }
export interface SaveSettingsResponse { success: boolean; settings: Record<number, { saveGood: boolean; saveBad: boolean }>; }
export interface SaveCameraSettingsResponse { success: boolean; settings?: { saveGood: boolean; saveBad: boolean }; error?: string; }
export interface PhotosResponse { success: boolean; photos: { filename: string; subdir: string; mtime: string; size: number; result: string; timestamp: number }[]; okCount: number; ngCount: number; }

export interface PhotoItem {
  camId: number;
  filename: string;
  subdir: string;
  result: string;
  size: number;
  mtime: string;
  timestamp: number;
}
export interface PhotoListResponse {
  success: boolean;
  total: number;
  page: number;
  page_size: number;
  items: PhotoItem[];
}
export interface PhotoFilterParams {
  page?: number;
  page_size?: number;
  camera_id?: number;
  start?: number;
  end?: number;
  category?: string;
}
export interface TrendPoint {
  time: string;
  total: number;
  ok: number;
  ng: number;
  yield_rate: number | null;
}
export interface PhotoTrendResponse {
  success: boolean;
  interval: string;
  points: TrendPoint[];
}

export interface PlcConfigResponse { success: boolean; config: PlcConfig; }
export interface SavePlcConfigResponse { success: boolean; config?: PlcConfig; message?: string; error?: string; plcError?: string; }
export interface PlcWritePayload { camera_id: number; type: 'reject_time' | 'reject_delay' | 'reject_signal'; value: number; }
export interface PlcWriteResponse { success: boolean; address?: string; value?: number; error?: string; }

export interface HardwareInfoResponse {
  success: boolean;
  hardware: {
    system: { os: string | null; os_version: string | null; os_release: string | null; hostname: string | null; python_version: string | null };
    cpu: { model: string | null; physical_cores: number | null; logical_cores: number | null; max_freq_mhz: number | null; current_freq_mhz: number | null; arch: string | null; usage_percent: number | null };
    memory: { total_gb: number | null; available_gb: number | null; used_gb: number | null; percent: number | null; speed_mhz: number | null };
    gpu: { name: string | null; memory_total_mb: number | null; memory_free_mb: number | null; memory_used_mb: number | null; cuda_available: boolean; cuda_version: string | null; count: number; compute_capability: string | null };
    disk: { project_drive: string | null; total_gb: number | null; used_gb: number | null; free_gb: number | null; percent: number | null; filesystem: string | null };
    network: { name: string; type: string; up: boolean; speed_mbps: number | null; speed_rx_mbps?: number | null; speed_tx_mbps?: number | null; ipv4: string[] }[];
    pytorch_version: string; training_device: string; inference_device: string;
    checks: Record<string, { label: string; pass: boolean; detail: string }>;
  };
}

export interface DeviceConfigResponse { success: boolean; config: { training_device: string; inference_device: string }; }
export interface SaveDeviceConfigResponse { success: boolean; message?: string; config?: { training_device: string; inference_device: string }; }
export interface LineCountResponse { success: boolean; line_count: number; }
export interface SaveLineCountResponse { success: boolean; message?: string; line_count?: number; }

export interface CatalogResponse {
  success: boolean;
  products?: { id: number; name: string; model: string; size: string; learned: boolean }[];
  line_config?: { line: number; name: string; productId: number | null; model: string }[];
  initialized?: boolean;
}
export type EnvironmentCheckResponse = EnvCheckResult;

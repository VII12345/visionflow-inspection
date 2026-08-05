export type UserLevel = 'admin' | 'tech' | 'operator';

export interface User {
  id: number;
  name: string;
  password: string;
  level: UserLevel;
}

export interface Product {
  id: number;
  /** 用户可编辑的显示名称，model 保留为模型/文件关联标识。 */
  name: string;
  model: string;
  size: string;
  learned: boolean;
}

export type RunLayoutId = 'auto' | 'single' | 'two' | 'three' | 'four' | 'focus' | 'custom';

export interface RunLayout {
  id: RunLayoutId;
  columns: number;
  order: number[];
  sizes?: Record<number, { colSpan: number; rowSpan: number }>;
}
export interface LineConfig {
  line: number;
  /** 用户可编辑的线体名称。 */
  name: string;
  productId: number | null;
  model: string;
}

export interface CameraConfig {
  enabled: boolean;
  ip: string;
  name: string;
  triggerSource: 'Line0' | 'Line1' | 'Software';
  triggerActivation: 'RisingEdge' | 'FallingEdge';
  triggerTimeout: number;
  triggerDelay: number;
  exposureTime: number;
  gain: number;
  lineDebouncerTime: number;
  strobeEnable: boolean;
  strobeDelay: number;
  strobeDuration: number;
  rejectDelay: number;
  rejectTime: number;
}

export interface CameraStats {
  detected: number;
  defective: number;
}

export interface SaveSettings {
  saveGood: boolean;
  saveBad: boolean;
}

export interface CameraStatus {
  lineEnabled?: boolean;
  state: 'running' | 'disconnected' | 'ready' | 'error';
  result?: {
    label: string;
    confidence: number;
  };
  lastFrameTime?: string;
  totalTriggers?: number;
  stats?: CameraStats;
  error?: string;
}

export interface SystemStatus {
  cameras: Record<number, CameraStatus>;
}

export interface TrainingStatus {
  running: boolean;
  progress: number;
  message: string;
  epoch: number;
  total_epochs: number;
  train_loss: number;
  val_loss: number;
  val_acc: number;
}

export interface Photo {
  id: string;
  time: string;
  result: string;
  filename: string;
  size?: number;
  timestamp?: number;
  subdir?: string;
}

export interface SystemAlarm {
  title: string;
  message: string;
  details?: string[];
  severity?: 'warning' | 'error';
}
export interface EnvCheckResult {
  passed: boolean;
  summary: string;
  results: { name: string; message: string; passed: boolean; level: string; detail?: string }[];
}

export interface ModelInfo {
  name: string;
  size?: number;
  mtime?: number;
  categories: string[];
  num_classes: number;
  reject_labels: string[];
  category_descriptions: Record<string, string>;
  version?: {
    trained_at?: string | null;
    accuracy?: number | null;
    device?: string | null;
  };
}

export interface PlcCameraMapping {
  reject_time: string;
  reject_delay: string;
  reject_signal: string;
  reject_time_value: number;
  reject_delay_value: number;
}

export interface PlcConfig {
  enabled: boolean;
  base_url: string;
  timeout_seconds: number;
  node_prefix: string;
  reject_labels: string[];
  cameras: Record<string, PlcCameraMapping>;
}
export type TabId = 'run' | 'file' | 'settings' | 'models' | 'test' | 'user' | 'plc' | 'help' | `cam-detail-${number}`;

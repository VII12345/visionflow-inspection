export interface User {
  id: number;
  name: string;
  password: string;
  level: 'admin' | 'tech' | 'operator';
}

export interface Product {
  id: number;
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

export type TabId = 'run' | 'file' | 'settings' | 'test' | 'user' | `cam-detail-${number}`;


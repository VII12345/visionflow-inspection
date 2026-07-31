import { create } from 'zustand';

export interface TrainingResult {
  modelName: string;
  modelPath: string | null;
  evalResult: Record<string, unknown> | null;
  errorMessage: string | null;
  trainCount: number;
  valCount: number;
}

interface TrainingState {
  result: TrainingResult;
  setResult: (result: TrainingResult) => void;
  running: boolean;
  progress: number;
  progressLabel: string;
  metrics: string;
  setProgress: (data: { running?: boolean; progress?: number; label?: string; metrics?: string }) => void;
}

export const useTrainingStore = create<TrainingState>((set) => ({
  result: {
    modelName: '',
    modelPath: null,
    evalResult: null,
    errorMessage: null,
    trainCount: 0,
    valCount: 0,
  },
  setResult: (result) => set({ result }),
  running: false,
  progress: 0,
  progressLabel: '准备中...',
  metrics: '--',
  setProgress: (data) => set((state) => ({
    running: data.running ?? state.running,
    progress: data.progress ?? state.progress,
    progressLabel: data.label ?? state.progressLabel,
    metrics: data.metrics ?? state.metrics,
  })),
}));

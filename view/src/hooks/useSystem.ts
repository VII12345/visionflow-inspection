import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { SystemStatus, CameraStatus } from '../types';
import { useAppStore } from '../store/useAppStore';

export function useSystemPolling(isRunning: boolean, simulationEnabled = false) {
  const [status, setStatus] = useState<SystemStatus>({ cameras: {} });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = simulationEnabled ? await api.simulationStatus() : await api.status();
      setStatus({ cameras: (data as unknown as SystemStatus).cameras || {} });
    } catch { /* ignore */ }
  }, [simulationEnabled]);

  useEffect(() => {
    if (isRunning) {
      poll();
      intervalRef.current = setInterval(poll, 500);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, poll]);

  return status;
}

export function useFrameUpdater(isRunning: boolean, simulationEnabled = false) {
  const lineCount = useAppStore(s => s.lineCount);
  const [frames, setFrames] = useState<Record<number, string>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function updateFrames() {
      const newFrames: Record<number, string> = {};
      for (let i = 1; i <= lineCount; i++) {
        try {
          const buffer = simulationEnabled ? await api.getSimulationFrame(i) : await api.getFrame(i);
          const bytes = new Uint8Array(buffer as unknown as ArrayBuffer);
          if (bytes.length === 0) continue;
          const binary = bytes.reduce((acc, b) => acc + String.fromCharCode(b), '');
          newFrames[i] = `data:image/jpeg;base64,${btoa(binary)}`;
        } catch { /* ignore */ }
      }
      setFrames(prev => ({ ...prev, ...newFrames }));
    }

    if (isRunning) {
      updateFrames();
      intervalRef.current = setInterval(updateFrames, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, lineCount, simulationEnabled]);

  return frames;
}


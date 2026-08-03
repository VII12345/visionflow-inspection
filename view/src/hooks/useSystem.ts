import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { SystemStatus } from '../types';
import { useAppStore } from '../store/useAppStore';
import { usePolling } from './usePolling';

export function useSystemPolling(isRunning: boolean) {
  const [status, setStatus] = useState<SystemStatus>({ cameras: {} });

  const poll = useCallback(async () => {
    try {
      const data = await api.status();
      setStatus({ cameras: data.cameras || {} });
    } catch { /* ignore */ }
  }, []);

  usePolling(poll, 500, isRunning);

  return status;
}

export function useFrameUpdater(isRunning: boolean) {
  const lineCount = useAppStore(s => s.lineCount);
  const [frames, setFrames] = useState<Record<number, string>>({});
  const objectUrlsRef = useRef<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function updateFrames() {
      // 上一轮尚未返回时跳过本轮，避免慢速链路下多轮轮询叠加、旧帧覆盖新帧
      if (inFlight) return;
      inFlight = true;
      try {
        const newFrames: Record<number, string> = {};
        for (let i = 1; i <= lineCount; i++) {
          if (cancelled) break;
          try {
            const blob = await api.getFrame(i);
            if (cancelled || !(blob instanceof Blob) || blob.size === 0) continue;
            const oldUrl = objectUrlsRef.current[i];
            const url = URL.createObjectURL(blob);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            objectUrlsRef.current[i] = url;
            newFrames[i] = url;
          } catch { /* camera may be idle */ }
        }
        if (!cancelled && Object.keys(newFrames).length > 0) {
          setFrames(prev => ({ ...prev, ...newFrames }));
        }
      } finally {
        inFlight = false;
      }
    }

    if (isRunning) {
      void updateFrames();
      const interval = setInterval(() => { void updateFrames(); }, 1000);
      return () => {
        cancelled = true;
        clearInterval(interval);
        for (const url of Object.values(objectUrlsRef.current)) URL.revokeObjectURL(url);
        objectUrlsRef.current = {};
        setFrames({});
      };
    }
    setFrames({});
    return undefined;
  }, [isRunning, lineCount]);

  return frames;
}


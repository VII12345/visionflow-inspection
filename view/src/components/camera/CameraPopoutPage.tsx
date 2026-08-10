import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { isTauri } from '../../services/native';
import { getCurrentWindow } from '@tauri-apps/api/window';

type CameraState = {
  state?: string;
  result?: { label: string; confidence: number; reject?: boolean };
  lastFrameTime?: string;
  totalTriggers?: number;
  error?: string;
};

export const CameraPopoutPage: React.FC<{ camId: number }> = ({ camId }) => {
  const [frameUrl, setFrameUrl] = useState('');
  const [camera, setCamera] = useState<CameraState>({});
  const frameUrlRef = useRef('');

  useEffect(() => {
    let active = true;
    const updateFrame = async () => {
      try {
        const blob = await api.getFrame(camId);
        if (!active || !(blob instanceof Blob)) return;
        const nextUrl = URL.createObjectURL(blob);
        if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = nextUrl;
        setFrameUrl(nextUrl);
      } catch { /* camera may be idle */ }
    };
    const timer = window.setInterval(updateFrame, 1000);
    void updateFrame();
    return () => {
      active = false;
      window.clearInterval(timer);
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    };
  }, [camId]);

  useEffect(() => {
    let active = true;
    const updateStatus = async () => {
      try {
        const data = await api.status();
        if (active) setCamera(data.cameras?.[camId] || {});
      } catch { /* backend may be restarting */ }
    };
    const timer = window.setInterval(updateStatus, 500);
    void updateStatus();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [camId]);

  const close = async () => {
    if (isTauri()) await getCurrentWindow().close();
    else window.history.back();
  };

  // 后端已按当前模型剔除类别判定 result.reject，据此红/绿着色；无结果时仅按状态着色
  const badge = camera.state === 'error'
    ? '错误'
    : camera.result?.label || (camera.state === 'running' ? '等待触发' : '等待检测');
  const badgeClass = camera.state === 'error'
    ? 'bg-red-50 text-ng'
    : camera.result
      ? (camera.result.reject ? 'bg-red-50 text-ng' : 'bg-emerald-50 text-ok')
      : 'bg-amber-50 text-warn';

  return (
    <div className="min-h-screen bg-surface text-text-primary p-5">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-[980px] flex-col overflow-hidden rounded-lg border border-gray-100 bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">相机 {camId}</div>
            <div className="mt-1 text-xs text-text-secondary">实时检测画面</div>
          </div>
          <div className={`rounded px-7 py-4 text-5xl font-bold ${badgeClass}`}>
            {badge}
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center bg-gray-50 p-4">
          {frameUrl ? <img src={frameUrl} alt={`相机 ${camId}`} className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-text-tertiary">等待相机信号...</span>}
        </main>
        <footer className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-xs text-text-tertiary">
          <span>{camera.error || (camera.result ? `${camera.result.label} (${Math.round(camera.result.confidence * 100)}%)` : `已触发 ${camera.totalTriggers || 0} 次`)}</span>
          <span>{camera.lastFrameTime || '—'}</span>
          <button type="button" onClick={close} className="rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-gray-50 hover:border-gray-300">关闭窗口</button>
        </footer>
      </div>
    </div>
  );
};



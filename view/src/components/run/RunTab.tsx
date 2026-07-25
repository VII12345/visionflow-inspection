import React, { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSystemPolling, useFrameUpdater } from '../../hooks/useSystem';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { Button, Badge } from '../common/Modal';



export const RunTab: React.FC = () => {
  const isRunning = useAppStore(s => s.isRunning);
  const lineCount = useAppStore(s => s.lineCount);
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const setRunning = useAppStore(s => s.setRunning);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const openDynamicTab = useAppStore(s => s.openDynamicTab);
  const poppedOutCams = useAppStore(s => s.poppedOutCams);
  const togglePopoutCam = useAppStore(s => s.togglePopoutCam);

  // Listen for camera popout close events (from main process)
  useEffect(() => {
    if (window.electronAPI?.onCameraPopoutClosed) {
      window.electronAPI.onCameraPopoutClosed((camId: number) => {
        togglePopoutCam(camId);
      });
    }
  }, [togglePopoutCam]);

  const handlePopout = useCallback((camId: number) => {
    window.electronAPI?.openCameraPopout(camId);
    togglePopoutCam(camId);
  }, [togglePopoutCam]);

  const status = useSystemPolling(isRunning);
  const frames = useFrameUpdater(isRunning);

  // Sync model learned status from backend
  const [products, setProducts] = React.useState(storage.getProducts());
  const syncModelStatus = useCallback(async () => {
    try {
      const data = await api.getModels();
      if ((data as { success: boolean; models?: { name: string }[] }).success && (data as { models: { name: string }[] }).models) {
        const trainedNames = new Set((data as { models: { name: string }[] }).models.map(m => m.name));
        const prods = storage.getProducts();
        let changed = false;
        for (const p of prods) {
          const was = p.learned;
          p.learned = trainedNames.has(p.model);
          if (p.learned !== was) changed = true;
        }
        if (changed) {
          storage.saveProducts(prods);
          setProducts([...prods]);
        }
      }
    } catch { /* backend may not be ready */ }
  }, []);
  useEffect(() => { syncModelStatus(); const iv = setInterval(syncModelStatus, 10000); return () => clearInterval(iv); }, [syncModelStatus]);

  const lineConfig = storage.getLineConfig();

  const startSystem = useCallback(async () => {
    if (!user) { setModal('login', true); return; }
    if (isRunning) { showMessage('系统已在运行中'); return; }
    try {
      const cfg = storage.getLineConfig();
      const prods = storage.getProducts();
      const camProducts: Record<number, string> = {};
      for (const item of cfg) {
        if (item.productId) {
          const prod = prods.find(p => p.id === item.productId);
          if (prod?.learned) {
            camProducts[item.line] = prod.model;
          }
        }
      }
      const result = await api.start(camProducts, lineCount);
      if ((result as { success: boolean }).success) {
        setRunning(true);
        showMessage('系统已启动，开始检测');
      } else {
        showMessage('启动失败: ' + (result as { message?: string }).message);
      }
    } catch (e) {
      showMessage('启动失败: ' + (e as Error).message);
    }
  }, [user, isRunning, setModal, showMessage, setRunning]);

  const stopSystem = useCallback(async () => {
    if (!isRunning) { showMessage('系统已停止'); return; }
    try {
      const result = await api.stop();
      if ((result as { success: boolean }).success) {
        setRunning(false);
        showMessage('系统已停止检测');
      } else {
        showMessage('停止失败: ' + (result as { message?: string }).message);
      }
    } catch (e) {
      showMessage('停止失败: ' + (e as Error).message);
    }
  }, [isRunning, setRunning, showMessage]);

  const totalStats = { ok: 0, ng: 0, total: 0 };
  for (let i = 1; i <= lineCount; i++) {
    const s = status.cameras[i]?.stats;
    if (s) {
      totalStats.total += s.detected || 0;
      totalStats.ng += s.defective || 0;
    }
  }
  totalStats.ok = totalStats.total - totalStats.ng;

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Controls */}
      <div className="flex items-center gap-4 mb-6 shrink-0">
        <Button variant="start" size="lg" onClick={startSystem} disabled={isRunning}>启动</Button>
        <Button variant="stop" size="lg" onClick={stopSystem} disabled={!isRunning}>停止</Button>
        <span className={`text-sm font-medium ${isRunning ? 'text-ok' : 'text-text-tertiary'}`}>
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${isRunning ? 'bg-ok' : 'bg-gray-300'}`} />
          {isRunning ? '运行中' : '系统已停止'}
        </span>
        <div className="ml-auto flex items-center gap-6 text-xs text-text-secondary bg-surface rounded-lg px-5 py-2">
          <span>OK <span className="text-ok font-semibold ml-1">{totalStats.ok}</span></span>
          <span>NG <span className="text-ng font-semibold ml-1">{totalStats.ng}</span></span>
          <span>总计 <span className="text-text-primary font-semibold ml-1">{totalStats.total}</span></span>
        </div>
      </div>

      {/* Camera Grid */}
      <div className="grid grid-cols-2 gap-5 flex-1 min-h-0">
        {Array.from({ length: lineCount }, (_, i) => i + 1).map(camId => {
          const cfg = lineConfig[camId - 1];
          const prod = products.find(p => p.id === cfg?.productId);
          const modelName = prod ? prod.model : '-';
          const camStatus = status.cameras[camId];
          const frameUrl = frames[camId];

          let badgeVariant: 'pending' | 'ok' | 'ng' | 'error' = 'pending';
          let badgeText = '待检测';
          let resultText = '--';
          let resultColor = '';

          if (camStatus?.state === 'running' && camStatus.result) {
            badgeVariant = camStatus.result.label === '正' ? 'ok' : 'ng';
            badgeText = camStatus.result.label;
            resultText = `结果: ${camStatus.result.label} (${Math.round(camStatus.result.confidence * 100)}%)`;
            resultColor = camStatus.result.label === '正' ? 'text-ok' : 'text-ng';
          } else if (camStatus?.state === 'running') {
            badgeText = '等待触发';
            resultText = `触发模式 - 等待传感器信号... (已触发 ${camStatus.totalTriggers || 0} 次)`;
            resultColor = 'text-warn';
          } else if (camStatus?.state === 'error') {
            badgeVariant = 'error';
            badgeText = '错误';
            resultText = camStatus.error || '未知错误';
            resultColor = 'text-ng';
          }

          return (
            <div key={camId} className="bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <span className="text-[13px]">
                  <span className="text-text-primary font-semibold">Cam {camId}</span>
                  <span className="text-text-tertiary mx-2">|</span>
                  <span className="text-text-secondary">线体 {camId}</span>
                  <span className="text-text-tertiary mx-1">|</span>
                  <span className="text-text-secondary">型号: {modelName}</span>
                  {prod && (
                    <span className="ml-2">
                      {prod.learned
                        ? <Badge variant="learned">已学习</Badge>
                        : <Badge variant="unlearned">未学习</Badge>
                      }
                    </span>
                  )}
                  {poppedOutCams.has(camId) && (
                    <span className="text-accent ml-2 text-[11px]">(已弹出)</span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handlePopout(camId)}
                    className={`text-xs transition-colors ${
                      poppedOutCams.has(camId)
                        ? 'text-accent font-medium'
                        : 'text-text-tertiary hover:text-accent'
                    }`}
                    title="弹出独立窗口"
                  >
                    弹出
                  </button>
                  <button
                    onClick={() => openDynamicTab(`cam-detail-${camId}`)}
                    className="text-xs text-text-tertiary hover:text-accent transition-colors"
                  >
                    详情
                  </button>
                </div>
              </div>

              {/* Image Area */}
              <div className="relative flex-1 bg-gray-50 flex items-center justify-center min-h-[180px]">
                <div className={`absolute top-3 left-3 z-10 px-2.5 py-1 rounded text-[11px] font-medium ${
                  badgeVariant === 'ok' ? 'bg-emerald-50 text-ok' :
                  badgeVariant === 'ng' ? 'bg-red-50 text-ng' :
                  badgeVariant === 'error' ? 'bg-red-50 text-ng' :
                  'bg-gray-100 text-text-tertiary'
                }`}>
                  {badgeText}
                </div>
                <img
                  src={frameUrl || ''}
                  alt={`Cam${camId}`}
                  className={`max-w-full max-h-full object-contain ${frameUrl ? 'opacity-100' : 'hidden'}`}
                />
                {!frameUrl && (
                  <span className="text-text-tertiary text-xs">等待相机信号...</span>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 text-xs">
                <span className={resultColor || 'text-text-tertiary'}>{resultText}</span>
                <span className="text-text-tertiary">{camStatus?.lastFrameTime || ''}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


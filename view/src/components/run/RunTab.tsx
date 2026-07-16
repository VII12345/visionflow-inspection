import React, { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSystemPolling, useFrameUpdater } from '../../hooks/useSystem';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { Button } from '../common/Modal';

const CAM_COUNT = 4;

export const RunTab: React.FC = () => {
  const isRunning = useAppStore(s => s.isRunning);
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const setRunning = useAppStore(s => s.setRunning);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const openDynamicTab = useAppStore(s => s.openDynamicTab);
  const poppedOutCam = useAppStore(s => s.poppedOutCam);
  const setPoppedOutCam = useAppStore(s => s.setPoppedOutCam);

  // 监听系统窗口关闭事件
  useEffect(() => {
    if (window.electronAPI?.onCameraPopoutClosed) {
      window.electronAPI.onCameraPopoutClosed((camId: number) => {
        setPoppedOutCam(null);
      });
    }
  }, []);

  const handlePopout = useCallback((camId: number) => {
    if (poppedOutCam === camId) {
      window.electronAPI?.closeCameraPopout(camId);
      setPoppedOutCam(null);
    } else {
      if (poppedOutCam) {
        window.electronAPI?.closeCameraPopout(poppedOutCam);
      }
      window.electronAPI?.openCameraPopout(camId);
      setPoppedOutCam(camId);
    }
  }, [poppedOutCam, setPoppedOutCam]);

  const status = useSystemPolling(isRunning);
  const frames = useFrameUpdater(isRunning);

  const lineConfig = storage.getLineConfig();
  const products = storage.getProducts();

  const startSystem = useCallback(async () => {
    if (!user) { setModal('login', true); return; }
    if (isRunning) { showMessage('系统已在运行中'); return; }
    try {
      // 构建摄像头→产品名称映射（传给后端，每个摄像头用对应产品的模型）
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
      const result = await api.start(camProducts);
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
  for (let i = 1; i <= CAM_COUNT; i++) {
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
      <div className="flex items-center gap-4 mb-5 shrink-0">
        <Button variant="start" size="lg" onClick={startSystem} disabled={isRunning}>▶ 启动</Button>
        <Button variant="stop" size="lg" onClick={stopSystem} disabled={!isRunning}>■ 停止</Button>
        <span className={`text-sm font-semibold ${isRunning ? 'text-emerald-400' : 'text-gray-500'}`}>
          ● {isRunning ? '运行中' : '系统已停止'}
        </span>
        <span className="ml-auto text-xs text-gray-400 bg-[#171d2b] px-4 py-1.5 rounded-lg border border-white/[0.06]">
          OK: {totalStats.ok} &nbsp; NG: {totalStats.ng} &nbsp; 总计: {totalStats.total}
        </span>
      </div>

      {/* Camera Grid */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {Array.from({ length: CAM_COUNT }, (_, i) => i + 1).map(camId => {
          const cfg = lineConfig[camId - 1];
          const prod = products.find(p => p.id === cfg?.productId);
          const modelName = prod ? prod.model : '-';
          const camStatus = status.cameras[camId];
          const frameUrl = frames[camId];

          let badgeVariant: 'pending' | 'ok' | 'ng' | 'error' = 'pending';
          let badgeText = '等待检测';
          let resultText = '--';
          let resultColor = '';

          if (camStatus?.state === 'running' && camStatus.result) {
            badgeVariant = camStatus.result.label === '正' ? 'ok' : 'ng';
            badgeText = camStatus.result.label;
            resultText = `结果: ${camStatus.result.label} (${Math.round(camStatus.result.confidence * 100)}%)`;
            resultColor = camStatus.result.label === '正' ? 'text-emerald-400' : 'text-rose-400';
          } else if (camStatus?.state === 'running') {
            badgeText = '等待触发';
            resultText = `触发模式 — 等待传感器信号... (已触发 ${camStatus.totalTriggers || 0} 次)`;
            resultColor = 'text-amber-500';
          } else if (camStatus?.state === 'error') {
            badgeVariant = 'error';
            badgeText = '错误';
            resultText = camStatus.error || '未知错误';
            resultColor = 'text-rose-400';
          }

          return (
            <div key={camId} className="bg-[#171d2b] border border-white/[0.06] rounded-xl overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <span className="text-[13px]">
                  <span className="text-white font-semibold">Cam{camId}</span>
                  <span className="text-gray-500 ml-2">线体 {camId}</span>
                  <span className="text-gray-500 ml-1">| 型号: {modelName}</span>
                  {poppedOutCam === camId && (
                    <span className="text-[#7b8cf8] ml-2 text-[11px]">(已弹出)</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePopout(camId)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      poppedOutCam === camId
                        ? 'text-[#7b8cf8] bg-[#5b6ef5]/15'
                        : 'text-gray-500 hover:text-[#7b8cf8] hover:bg-white/[0.05]'
                    }`}
                    title="弹出独立窗口"
                  >
                    {poppedOutCam === camId ? '收回' : '⊞ 弹出'}
                  </button>
                  <button
                    onClick={() => openDynamicTab(`cam-detail-${camId}`)}
                    className="text-xs text-gray-500 hover:text-[#7b8cf8] transition-colors"
                  >
                    详情 &gt;
                  </button>
                </div>
              </div>

              {/* Image Area */}
              <div className="relative flex-1 bg-[#0d1117] flex items-center justify-center min-h-[180px]">
                <div className={`absolute top-3 left-3 z-10 px-3 py-1 rounded-lg text-xs font-semibold ${
                  badgeVariant === 'ok' ? 'bg-emerald-500/15 text-emerald-400' :
                  badgeVariant === 'ng' ? 'bg-rose-500/15 text-rose-400' :
                  badgeVariant === 'error' ? 'bg-rose-500/15 text-rose-400' :
                  'bg-gray-500/15 text-gray-400'
                }`}>
                  {badgeText}
                </div>
                <img
                  src={frameUrl || ''}
                  alt={`Cam${camId}`}
                  className={`max-w-full max-h-full object-contain ${frameUrl ? 'opacity-100' : 'hidden'}`}
                />
                {!frameUrl && (
                  <span className="text-gray-700 text-xs">等待相机信号...</span>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] text-xs">
                <span className={resultColor || 'text-gray-500'}>{resultText}</span>
                <span className="text-gray-600 text-[11px]">{camStatus?.lastFrameTime || ''}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React, { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSystemPolling, useFrameUpdater } from '../../hooks/useSystem';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { Button, Badge } from '../common/Modal';
import type { RunLayoutId } from '../../types';
import { LAYOUT_OPTIONS, useRunLayout } from './useRunLayout';
import { openCameraPopout, subscribeCameraPopoutClosed } from '../../services/native';
import { CameraCard } from './CameraCard';



export const RunTab: React.FC = () => {
  const isRunning = useAppStore(s => s.isRunning);
  const lineCount = useAppStore(s => s.lineCount);
  const [lineEnabled, setLineEnabled] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(Array.from({ length: lineCount }, (_, index) => [index + 1, true]))
  );
  const catalogRevision = useAppStore(s => s.catalogRevision);
  const user = useAppStore(s => s.user);
  const canEditRun = user?.level !== 'operator';
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const {
    layout,
    showCustomLayout,
    effectiveColumns,
    orderedCamIds,
    cardRefs,
    draggingCamId,
    dropTargetCamId,
    setDropTargetCamId,
    setDraggingCamId,
    selectLayout,
    handleCamDragStart,
    handleCamDrop,
    startCardResize,
    resetCustomSizes,
  } = useRunLayout(lineCount, showMessage);
  const raiseAlarm = useAppStore(s => s.raiseAlarm);
  const setRunning = useAppStore(s => s.setRunning);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const openDynamicTab = useAppStore(s => s.openDynamicTab);
  const poppedOutCams = useAppStore(s => s.poppedOutCams);
  const togglePopoutCam = useAppStore(s => s.togglePopoutCam);

  // Listen for camera popout close events from Tauri child windows.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    subscribeCameraPopoutClosed((camId: number) => {
      togglePopoutCam(camId);
    }).then(cleanup => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [togglePopoutCam]);

  const handlePopout = useCallback(async (camId: number) => {
    if (!canEditRun) return;
    try {
      await openCameraPopout(camId);
      togglePopoutCam(camId);
    } catch (error) {
      showMessage(`打开相机窗口失败: ${(error as Error).message}`);
    }
  }, [canEditRun, showMessage, togglePopoutCam]);

  const status = useSystemPolling(isRunning);
  const frames = useFrameUpdater(isRunning);

  // Sync model learned status from backend
  const [products, setProducts] = React.useState(storage.getProducts());
  const [rejectLabels, setRejectLabels] = useState<string[]>(['剔除类']);
  useEffect(() => { api.getPlcConfig().then(data => { if (data.success) setRejectLabels(data.config.reject_labels || []); }).catch(() => {}); }, [catalogRevision]);
  useEffect(() => { setProducts(storage.getProducts()); }, [catalogRevision]);
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

  const lineConfig = storage.getLineConfig(lineCount);
  const startSystem = useCallback(async () => {
    if (!user) { setModal('login', true); return; }
    if (isRunning) { showMessage('系统已在运行中'); return; }
    try {
      const cfg = storage.getLineConfig(lineCount);
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
      const activeLineIds = Array.from({ length: lineCount }, (_, index) => index + 1).filter(camId => lineEnabled[camId] !== false);
      if (activeLineIds.length === 0) {
        showMessage('请至少启用一条线路');
        return;
      }
      const result = await api.start(camProducts, lineCount, activeLineIds);
      const startResult = result as { success: boolean; message?: string; errors?: string[] };
      if (startResult.success) {
        setRunning(true);
        showMessage('系统已启动，开始检测');
        if (startResult.errors && startResult.errors.length > 0) {
          raiseAlarm({
            title: '部分相机连接异常',
            message: startResult.message || '系统已启动，但有相机未能连接。',
            severity: 'warning',
            details: startResult.errors,
          });
        }
      } else {
        const message = startResult.message || '未知启动错误';
        showMessage('启动失败: ' + message);
        raiseAlarm({ title: '系统启动失败', message, severity: 'error', details: startResult.errors });
      }
    } catch (e) {
      const message = (e as Error).message || '检测服务无响应';
      showMessage('启动失败: ' + message);
      raiseAlarm({
        title: '系统启动连接异常',
        message: '启动过程中无法连接检测服务或相机，请检查网络和设备连接。',
        severity: 'error',
        details: [message],
      });
    }
  }, [user, isRunning, lineCount, lineEnabled, setModal, showMessage, raiseAlarm, setRunning]);

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

  const toggleLine = useCallback(async (camId: number) => {
    if (!canEditRun) return;
    const nextEnabled = lineEnabled[camId] === false;
    try {
      const result = await api.setLineEnabled(camId, nextEnabled);
      if (result.success) {
        setLineEnabled(previous => ({ ...previous, [camId]: nextEnabled }));
        if (typeof result.running === 'boolean') setRunning(result.running);
        showMessage(nextEnabled ? `线路 ${camId} 已启用` : `线路 ${camId} 已停用`);
      } else {
        showMessage(result.message || `线路 ${camId} 操作失败`);
      }
    } catch (error) {
      showMessage(`线路 ${camId} 操作失败: ${(error as Error).message}`);
    }
  }, [canEditRun, lineEnabled, setRunning, showMessage]);
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
      <div className="flex items-center gap-4 mb-4 shrink-0 flex-wrap">
        <Button variant="start" size="lg" onClick={startSystem} disabled={isRunning}>启动</Button>
        <Button variant="stop" size="lg" onClick={stopSystem} disabled={!isRunning}>停止</Button>
        <span className={`text-sm font-medium ${isRunning ? 'text-ok' : 'text-text-tertiary'}`}>
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${isRunning ? 'bg-ok' : 'bg-gray-300'}`} />
          {isRunning ? '运行中' : '系统已停止'}
        </span>
        {canEditRun && <label className="flex items-center gap-2 text-xs text-text-secondary">
          CAM 布局
          <select
            value={layout.id}
            onChange={e => selectLayout(e.target.value as RunLayoutId)}
            className="bg-white border border-gray-200 rounded-md px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
          >
            {LAYOUT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>}
        <div className="ml-auto flex items-center gap-6 text-xs text-text-secondary bg-surface rounded-lg px-5 py-2">
          <span>OK <span className="text-ok font-semibold ml-1">{totalStats.ok}</span></span>
          <span>NG <span className="text-ng font-semibold ml-1">{totalStats.ng}</span></span>
          <span>总计 <span className="text-text-primary font-semibold ml-1">{totalStats.total}</span></span>
        </div>
      </div>

      {canEditRun && showCustomLayout && (
        <div className="bg-white border border-gray-100 rounded-lg shadow-card px-4 py-3 mb-4 shrink-0 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-text-primary">自由缩放布局</span>
          <span className="text-[11px] text-text-tertiary">拖动卡片交换位置，拖动卡片右下角手柄自由缩放；页面会自动重新排布。</span>
          <Button variant="secondary" size="sm" onClick={resetCustomSizes}>恢复默认大小</Button>
        </div>
      )}

      {/* Camera Grid */}
      <div
        className="grid gap-5 flex-1 min-h-0"
        style={layout.id === 'custom'
          ? { gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: 'minmax(120px, 1fr)', alignItems: 'stretch' }
          : { gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
      >
        {orderedCamIds.map(camId => {
          const cfg = lineConfig[camId - 1];
          const prod = products.find(p => p.id === cfg?.productId);
          const modelName = prod ? (prod.name || prod.model) : '-';
          const lineName = cfg?.name || `线体 ${camId}`;
          const camStatus = status.cameras[camId];
          const frameUrl = frames[camId];

          const cardSize = layout.sizes?.[camId] || { colSpan: 4, rowSpan: 2 };
          const cardStyle = layout.id === 'custom'
            ? { gridColumn: `span ${cardSize.colSpan}`, gridRow: `span ${cardSize.rowSpan}` }
            : layout.id === 'focus' && camId === orderedCamIds[0] && lineCount > 1
              ? { gridColumn: 'span 2', gridRow: 'span 2' }
              : undefined;

          return (
            <CameraCard
              key={camId}
              camId={camId}
              lineName={lineName}
              modelName={modelName}
              prod={prod}
              camStatus={camStatus}
              frameUrl={frameUrl}
              rejectLabels={rejectLabels}
              canEditRun={canEditRun}
              poppedOut={poppedOutCams.has(camId)}
              lineEnabled={lineEnabled[camId] !== false}
              dropTarget={dropTargetCamId === camId && draggingCamId !== camId}
              dragging={draggingCamId === camId}
              isCustomLayout={layout.id === 'custom'}
              cardStyle={cardStyle}
              onRef={element => { cardRefs.current[camId] = element; }}
              onDragStart={event => handleCamDragStart(event, camId)}
              onDragOver={() => setDropTargetCamId(camId)}
              onDrop={event => handleCamDrop(event, camId)}
              onDragEnd={() => { setDraggingCamId(null); setDropTargetCamId(null); }}
              onToggleLine={() => toggleLine(camId)}
              onPopout={() => handlePopout(camId)}
              onDetails={() => openDynamicTab('cam-detail-' + camId)}
              onResize={event => startCardResize(event, camId)}
            />
          );
        })}
      </div>
    </div>
  );
};

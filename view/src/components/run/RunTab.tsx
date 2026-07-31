import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSystemPolling, useFrameUpdater } from '../../hooks/useSystem';
import { api } from '../../services/api';
import { storage } from '../../services/storage';
import { Button, Badge } from '../common/Modal';
import type { RunLayout, RunLayoutId } from '../../types';
import { openCameraPopout, subscribeCameraPopoutClosed } from '../../services/native';



const LAYOUT_OPTIONS: { id: RunLayoutId; label: string; columns: number }[] = [
  { id: 'auto', label: '自适应网格', columns: 0 },
  { id: 'single', label: '单列大图', columns: 1 },
  { id: 'two', label: '双列标准', columns: 2 },
  { id: 'three', label: '三列紧凑', columns: 3 },
  { id: 'four', label: '四列总览', columns: 4 },
  { id: 'focus', label: '主视图 + 缩略图', columns: 3 },
  { id: 'custom', label: '自定义布局', columns: 2 },
];

const clampColumns = (columns: number) => Math.min(4, Math.max(1, Math.round(columns) || 2));
export const RunTab: React.FC = () => {
  const isRunning = useAppStore(s => s.isRunning);
  const [layout, setLayout] = useState<RunLayout>(() => storage.getRunLayout());
  const [customColumnsDraft, setCustomColumnsDraft] = useState(String(layout.columns || 2));
  const [customOrderDraft, setCustomOrderDraft] = useState(layout.order.join(', '));
  const [showCustomLayout, setShowCustomLayout] = useState(layout.id === 'custom');
  const [draggingCamId, setDraggingCamId] = useState<number | null>(null);
  const [dropTargetCamId, setDropTargetCamId] = useState<number | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [resizeSession, setResizeSession] = useState<{ camId: number; startX: number; startY: number; colSpan: number; rowSpan: number } | null>(null);
  const lineCount = useAppStore(s => s.lineCount);
  const [lineEnabled, setLineEnabled] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(Array.from({ length: lineCount }, (_, index) => [index + 1, true]))
  );
  const catalogRevision = useAppStore(s => s.catalogRevision);
  const user = useAppStore(s => s.user);
  const canEditRun = user?.level !== 'operator';
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
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
  const effectiveColumns = useMemo(() => {
    if (layout.id === 'auto') return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(lineCount))));
    if (layout.id === 'custom') return 12;
    return clampColumns(layout.columns);
  }, [layout, lineCount]);

  const orderedCamIds = useMemo(() => {
    const all = Array.from({ length: lineCount }, (_, i) => i + 1);
    if (!layout.order.length) return all;
    const customOrder = layout.order.filter(camId => all.includes(camId));
    return [...customOrder, ...all.filter(camId => !customOrder.includes(camId))];
  }, [layout.order, lineCount]);

  const swapCamPosition = (sourceCamId: number, targetCamId: number) => {
    if (sourceCamId === targetCamId) return;
    const nextOrder = [...orderedCamIds];
    const sourceIndex = nextOrder.indexOf(sourceCamId);
    const targetIndex = nextOrder.indexOf(targetCamId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    [nextOrder[sourceIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[sourceIndex]];
    const movingIds = [sourceCamId, targetCamId];
    const beforeRects = new Map<number, DOMRect>();
    for (const camId of movingIds) {
      const element = cardRefs.current[camId];
      if (element) beforeRects.set(camId, element.getBoundingClientRect());
    }

    const nextLayout: RunLayout = { ...layout, order: nextOrder };
    setLayout(nextLayout);
    storage.saveRunLayout(nextLayout);

    // FLIP：先记录交换前位置，DOM 重排后从旧位置反向移动到新位置，
    // 让两个卡片真实呈现“来回交换”的移动过程，而不是瞬间切换。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        for (const camId of movingIds) {
          const element = cardRefs.current[camId];
          const before = beforeRects.get(camId);
          if (!element || !before) continue;
          const after = element.getBoundingClientRect();
          const deltaX = before.left - after.left;
          const deltaY = before.top - after.top;
          if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
          element.animate(
            [
              { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.985)` },
              { transform: 'translate3d(0, 0, 0) scale(1)' },
            ],
            { duration: 460, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'both' },
          );
        }
      });
    });
  };

  const handleCamDragStart = (event: React.DragEvent<HTMLDivElement>, camId: number) => {
    setDraggingCamId(camId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(camId));
  };

  const handleCamDrop = (event: React.DragEvent<HTMLDivElement>, targetCamId: number) => {
    event.preventDefault();
    const sourceCamId = draggingCamId || Number(event.dataTransfer.getData('text/plain'));
    if (sourceCamId) swapCamPosition(sourceCamId, targetCamId);
    setDraggingCamId(null);
    setDropTargetCamId(null);
  };
  const selectLayout = (id: RunLayoutId) => {
    if (id === 'custom') {
      const nextLayout: RunLayout = { ...layout, id: 'custom', columns: 12, sizes: layout.sizes || {} };
      setShowCustomLayout(true);
      setLayout(nextLayout);
      storage.saveRunLayout(nextLayout);
      return;
    }
    const option = LAYOUT_OPTIONS.find(item => item.id === id);
    const nextLayout: RunLayout = { id, columns: option?.columns || 2, order: [] };
    setLayout(nextLayout);
    setShowCustomLayout(false);
    storage.saveRunLayout(nextLayout);
  };

  useEffect(() => {
    if (!resizeSession) return;
    const handlePointerMove = (event: PointerEvent) => {
      const deltaColumns = Math.round((event.clientX - resizeSession.startX) / 80);
      const deltaRows = Math.round((event.clientY - resizeSession.startY) / 120);
      const colSpan = Math.min(12, Math.max(1, resizeSession.colSpan + deltaColumns));
      const rowSpan = Math.min(8, Math.max(1, resizeSession.rowSpan + deltaRows));
      setLayout(current => ({
        ...current,
        id: 'custom',
        columns: 12,
        sizes: { ...current.sizes, [resizeSession.camId]: { colSpan, rowSpan } },
      }));
    };
    const handlePointerUp = () => {
      setLayout(current => {
        storage.saveRunLayout(current);
        return current;
      });
      setResizeSession(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizeSession]);

  const startCardResize = (event: React.PointerEvent<HTMLDivElement>, camId: number) => {
    event.preventDefault();
    event.stopPropagation();
    const size = layout.sizes?.[camId] || { colSpan: 4, rowSpan: 2 };
    setResizeSession({ camId, startX: event.clientX, startY: event.clientY, colSpan: size.colSpan, rowSpan: size.rowSpan });
  };

  const resetCustomSizes = () => {
    const nextLayout: RunLayout = { ...layout, id: 'custom', columns: 12, sizes: {} };
    setLayout(nextLayout);
    storage.saveRunLayout(nextLayout);
    showMessage('已恢复自定义布局默认卡片大小');
  };

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

          let badgeVariant: 'pending' | 'ok' | 'ng' | 'error' = 'pending';
          let badgeText = '待检测';
          let resultText = '--';
          let resultColor = '';

          if (camStatus?.state === 'running' && camStatus.result) {
            badgeVariant = rejectLabels.includes(camStatus.result.label) ? 'ng' : 'ok';
            badgeText = camStatus.result.label;
            resultText = `结果: ${camStatus.result.label} (${Math.round(camStatus.result.confidence * 100)}%)`;
            resultColor = rejectLabels.includes(camStatus.result.label) ? 'text-ng' : 'text-ok';
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
          const cardSize = layout.sizes?.[camId] || { colSpan: 4, rowSpan: 2 };
          const cardStyle = layout.id === 'custom'
            ? { gridColumn: `span ${cardSize.colSpan}`, gridRow: `span ${cardSize.rowSpan}` }
            : layout.id === 'focus' && camId === orderedCamIds[0] && lineCount > 1
              ? { gridColumn: 'span 2', gridRow: 'span 2' }
              : undefined;

          return (
            <div ref={element => { cardRefs.current[camId] = element; }} key={camId} draggable={canEditRun} onDragStart={event => canEditRun && handleCamDragStart(event, camId)} onDragOver={event => { if (canEditRun) { event.preventDefault(); setDropTargetCamId(camId); } }} onDrop={event => canEditRun && handleCamDrop(event, camId)} onDragEnd={() => { setDraggingCamId(null); setDropTargetCamId(null); }} className={`relative bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing transition-shadow ${dropTargetCamId === camId && draggingCamId !== camId ? 'cam-card-drop-target' : ''} ${draggingCamId === camId ? 'cam-card-dragging' : ''}`} style={cardStyle}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <span className="text-[13px]">
                  <span className="text-text-primary font-semibold">Cam {camId}</span>
                  <span className="text-text-tertiary mx-2">|</span>
                  <span className="text-text-secondary">{lineName}</span>
                  <span className="text-text-tertiary mx-1">|</span>
                  <span className="text-text-secondary">产品: {modelName}</span>
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
                {canEditRun && <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleLine(camId)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      lineEnabled[camId] !== false
                        ? 'border-emerald-200 bg-emerald-50 text-ok hover:bg-emerald-100'
                        : 'border-gray-200 bg-gray-50 text-text-tertiary hover:bg-gray-100'
                    }`}
                    title={lineEnabled[camId] !== false ? '停用此线路' : '启用此线路'}
                  >
                    线体 {lineEnabled[camId] !== false ? '开' : '关'}
                  </button>
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
                </div>}
              </div>

              {/* Image Area */}
              <div className="relative flex-1 min-h-0 min-w-0 bg-gray-50 flex items-center justify-center overflow-hidden px-2 py-3">
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
                  <span className="text-text-tertiary text-xs text-center leading-5 whitespace-normal break-words max-w-full px-1">等待相机信号...</span>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 min-h-0 px-5 py-2.5 border-t border-gray-100 text-xs">
                <span className={`${resultColor || 'text-text-tertiary'} min-w-0 break-words text-center`}>{resultText}</span>
                <span className="text-text-tertiary">{camStatus?.lastFrameTime || ''}</span>
              </div>
              {canEditRun && layout.id === 'custom' && (
                <div
                  className="absolute right-1 bottom-1 z-20 w-4 h-4 rounded-sm cursor-nwse-resize bg-accent/40 hover:bg-accent/70"
                  onPointerDown={event => startCardResize(event, camId)}
                  title="拖动缩放卡片"
                />
              )}            </div>
          );
        })}
      </div>
    </div>
  );
};

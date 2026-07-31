import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { storage } from '../../services/storage';
import type { RunLayout, RunLayoutId } from '../../types';

export const LAYOUT_OPTIONS: { id: RunLayoutId; label: string; columns: number }[] = [
  { id: 'auto', label: '自适应网格', columns: 0 },
  { id: 'single', label: '单列大图', columns: 1 },
  { id: 'two', label: '双列标准', columns: 2 },
  { id: 'three', label: '三列紧凑', columns: 3 },
  { id: 'four', label: '四列总览', columns: 4 },
  { id: 'focus', label: '主视图 + 缩略图', columns: 3 },
  { id: 'custom', label: '自定义布局', columns: 2 },
];

const clampColumns = (columns: number) => Math.min(4, Math.max(1, Math.round(columns) || 2));

type MessageHandler = (message: string) => void;

export const useRunLayout = (lineCount: number, showMessage: MessageHandler) => {
  const [layout, setLayout] = useState<RunLayout>(() => storage.getRunLayout());
  const [showCustomLayout, setShowCustomLayout] = useState(layout.id === 'custom');
  const [draggingCamId, setDraggingCamId] = useState<number | null>(null);
  const [dropTargetCamId, setDropTargetCamId] = useState<number | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [resizeSession, setResizeSession] = useState<{
    camId: number;
    startX: number;
    startY: number;
    colSpan: number;
    rowSpan: number;
  } | null>(null);

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

  const handleCamDragStart = (event: DragEvent<HTMLDivElement>, camId: number) => {
    setDraggingCamId(camId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(camId));
  };

  const handleCamDrop = (event: DragEvent<HTMLDivElement>, targetCamId: number) => {
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

  const startCardResize = (event: ReactPointerEvent<HTMLDivElement>, camId: number) => {
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

  return {
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
  };
};

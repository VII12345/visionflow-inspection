import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSystemPolling, useFrameUpdater } from '../../hooks/useSystem';
import { storage } from '../../services/storage';
import { useRunLayout } from './useRunLayout';
import { useRunControl } from './useRunControl';
import { useRunModelSync } from './useRunModelSync';
import { useCameraPopout } from './useCameraPopout';
import { RunHeader } from './RunHeader';
import { LineGrid } from './LineGrid';

export const RunTab: React.FC = () => {
  const isRunning = useAppStore(s => s.isRunning);
  const lineCount = useAppStore(s => s.lineCount);
  const user = useAppStore(s => s.user);
  const canEditRun = user?.level !== 'operator';
  const showMessage = useAppStore(s => s.showMessage);
  const openDynamicTab = useAppStore(s => s.openDynamicTab);
  const poppedOutCams = useAppStore(s => s.poppedOutCams);

  const {
    layout,
    showCustomLayout,
    effectiveColumns,
    orderedCamIds,
    cardRefs,
    draggingCamId,
    dropTargetCamId,
    clearDrag,
    startCardDrag,
    selectLayout,
    startCardResize,
    resetCustomSizes,
  } = useRunLayout(lineCount, showMessage);

  const { lineEnabled, startSystem, stopSystem, toggleLine } = useRunControl(lineCount);
  const { products, rejectLabels } = useRunModelSync();
  const { handlePopout } = useCameraPopout(canEditRun);

  const status = useSystemPolling(isRunning);
  const frames = useFrameUpdater(isRunning);

  const lineConfig = storage.getLineConfig(lineCount);
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
      <RunHeader
        isRunning={isRunning}
        canEditRun={canEditRun}
        totalStats={totalStats}
        layout={layout}
        showCustomLayout={showCustomLayout}
        onSelectLayout={selectLayout}
        onResetCustomSizes={resetCustomSizes}
        onStart={startSystem}
        onStop={stopSystem}
      />

      {/* Camera Grid */}
      <LineGrid
        layout={layout}
        effectiveColumns={effectiveColumns}
        orderedCamIds={orderedCamIds}
        lineConfig={lineConfig}
        products={products}
        status={status}
        frames={frames}
        rejectLabels={rejectLabels}
        canEditRun={canEditRun}
        poppedOutCams={poppedOutCams}
        lineEnabled={lineEnabled}
        dropTargetCamId={dropTargetCamId}
        draggingCamId={draggingCamId}
        cardRefs={cardRefs}
        onCardPointerDown={startCardDrag}
        onToggleLine={toggleLine}
        onPopout={handlePopout}
        onDetails={camId => openDynamicTab('cam-detail-' + camId)}
        onResize={startCardResize}
      />
    </div>
  );
};

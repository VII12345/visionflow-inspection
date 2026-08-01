import React from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { LineConfig, Product, RunLayout, SystemStatus } from '../../types';
import { CameraCard } from './CameraCard';

interface Props {
  layout: RunLayout;
  effectiveColumns: number;
  orderedCamIds: number[];
  lineConfig: LineConfig[];
  products: Product[];
  status: SystemStatus;
  frames: Record<number, string>;
  rejectLabels: string[];
  canEditRun: boolean;
  poppedOutCams: Set<number>;
  lineEnabled: Record<number, boolean>;
  dropTargetCamId: number | null;
  draggingCamId: number | null;
  cardRefs: RefObject<Record<number, HTMLDivElement | null>>;
  onDragStart: (event: DragEvent<HTMLDivElement>, camId: number) => void;
  onDragOver: (camId: number) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, camId: number) => void;
  onDragEnd: () => void;
  onToggleLine: (camId: number) => void;
  onPopout: (camId: number) => void;
  onDetails: (camId: number) => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>, camId: number) => void;
}

/** 运行页相机网格。 */
export const LineGrid: React.FC<Props> = ({
  layout,
  effectiveColumns,
  orderedCamIds,
  lineConfig,
  products,
  status,
  frames,
  rejectLabels,
  canEditRun,
  poppedOutCams,
  lineEnabled,
  dropTargetCamId,
  draggingCamId,
  cardRefs,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggleLine,
  onPopout,
  onDetails,
  onResize,
}) => {
  return (
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
          : layout.id === 'focus' && camId === orderedCamIds[0] && lineConfig.length > 1
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
            onRef={element => { if (cardRefs.current) cardRefs.current[camId] = element; }}
            onDragStart={event => onDragStart(event, camId)}
            onDragOver={() => onDragOver(camId)}
            onDrop={event => onDrop(event, camId)}
            onDragEnd={onDragEnd}
            onToggleLine={() => onToggleLine(camId)}
            onPopout={() => onPopout(camId)}
            onDetails={() => onDetails(camId)}
            onResize={event => onResize(event, camId)}
          />
        );
      })}
    </div>
  );
};

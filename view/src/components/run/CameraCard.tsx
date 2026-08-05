import React from 'react';
import type { CameraStatus, Product } from '../../types';
import { Badge } from '../common/Badge';

interface CameraCardProps {
  camId: number;
  lineName: string;
  modelName: string;
  prod?: Product;
  camStatus?: CameraStatus;
  frameUrl?: string;
  rejectLabels: string[];
  canEditRun: boolean;
  poppedOut: boolean;
  lineEnabled: boolean;
  dropTarget: boolean;
  dragging: boolean;
  isCustomLayout: boolean;
  cardStyle?: React.CSSProperties;
  onRef: (element: HTMLDivElement | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, camId: number) => void;
  onToggleLine: () => void;
  onPopout: () => void;
  onDetails: () => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camId, lineName, modelName, prod, camStatus, frameUrl, rejectLabels, canEditRun,
  poppedOut, lineEnabled, dropTarget, dragging, isCustomLayout, cardStyle, onRef,
  onPointerDown, onToggleLine, onPopout, onDetails, onResize,
}) => {
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

return (
  <div ref={onRef} key={camId} data-cam-id={camId} draggable={false} onPointerDown={event => canEditRun && onPointerDown(event, camId)} className={`relative bg-white rounded-lg shadow-card border border-gray-100 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing select-none transition-shadow ${dropTarget && !dragging ? 'cam-card-drop-target' : ''} ${dragging ? 'cam-card-dragging' : ''}`} style={cardStyle}>
    {/* Header */}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5 2xl:px-5 2xl:py-3 border-b border-gray-100">
      <span className="min-w-0 text-[13px]">
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
        {poppedOut && (
          <span className="text-accent ml-2 text-[11px]">(已弹出)</span>
        )}
      </span>
      {canEditRun && <div className="flex items-center gap-3">
        <button
          onClick={() => onToggleLine()}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            lineEnabled
              ? 'border-emerald-200 bg-emerald-50 text-ok hover:bg-emerald-100'
              : 'border-gray-200 bg-gray-50 text-text-tertiary hover:bg-gray-100'
          }`}
          title={lineEnabled ? '停用此线路' : '启用此线路'}
        >
          线体 {lineEnabled ? '开' : '关'}
        </button>
        <button
          onClick={() => onPopout()}
          className={`text-xs transition-colors ${
            poppedOut
              ? 'text-accent font-medium'
              : 'text-text-tertiary hover:text-accent'
          }`}
          title="弹出独立窗口"
        >
          弹出
        </button>
        <button
          onClick={() => onDetails()}
          className="text-xs text-text-tertiary hover:text-accent transition-colors"
        >
          详情
        </button>
      </div>}
    </div>

    {/* Image Area */}
    <div className="relative flex-1 min-h-0 min-w-0 bg-gray-50 flex items-center justify-center overflow-hidden px-2 py-3">
      <div className={`absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md text-sm font-semibold ${
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
        draggable={false}
        className={`max-w-full max-h-full object-contain ${frameUrl ? 'opacity-100' : 'hidden'}`}
      />
      {!frameUrl && (
        <span className="text-text-tertiary text-xs text-center leading-5 whitespace-normal break-words max-w-full px-1">等待相机信号...</span>
      )}
    </div>

    {/* Footer */}
    <div className="flex items-center justify-between gap-2 min-h-0 px-4 py-2.5 2xl:px-5 border-t border-gray-100 text-xs">
      <span className={`${resultColor || 'text-text-tertiary'} min-w-0 break-words text-center`}>{resultText}</span>
      <span className="text-text-tertiary shrink-0">{camStatus?.lastFrameTime || ''}</span>
    </div>
    {canEditRun && isCustomLayout && (
      <div
        className="absolute right-1 bottom-1 z-20 w-4 h-4 rounded-sm cursor-nwse-resize bg-accent/40 hover:bg-accent/70"
        onPointerDown={event => onResize(event)}
        title="拖动缩放卡片"
      />
    )}            </div>
);
};

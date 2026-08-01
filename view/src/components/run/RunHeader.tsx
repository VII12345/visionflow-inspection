import React from 'react';
import { Button } from '../common/Modal';
import type { RunLayout, RunLayoutId } from '../../types';
import { LAYOUT_OPTIONS } from './useRunLayout';

interface Props {
  isRunning: boolean;
  canEditRun: boolean;
  totalStats: { ok: number; ng: number; total: number };
  layout: RunLayout;
  showCustomLayout: boolean;
  onSelectLayout: (id: RunLayoutId) => void;
  onResetCustomSizes: () => void;
  onStart: () => void;
  onStop: () => void;
}

/** 运行页顶部控制栏 + 自定义布局提示。 */
export const RunHeader: React.FC<Props> = ({
  isRunning,
  canEditRun,
  totalStats,
  layout,
  showCustomLayout,
  onSelectLayout,
  onResetCustomSizes,
  onStart,
  onStop,
}) => {
  return (
    <>
      <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap 2xl:gap-4">
        <Button variant="start" size="lg" onClick={onStart} disabled={isRunning}>启动</Button>
        <Button variant="stop" size="lg" onClick={onStop} disabled={!isRunning}>停止</Button>
        <span className={`text-sm font-medium ${isRunning ? 'text-ok' : 'text-text-tertiary'}`}>
          <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${isRunning ? 'bg-ok' : 'bg-gray-300'}`} />
          {isRunning ? '运行中' : '系统已停止'}
        </span>
        {canEditRun && <label className="flex items-center gap-2 text-xs text-text-secondary">
          CAM 布局
          <select
            value={layout.id}
            onChange={e => onSelectLayout(e.target.value as RunLayoutId)}
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
          <Button variant="secondary" size="sm" onClick={onResetCustomSizes}>恢复默认大小</Button>
        </div>
      )}
    </>
  );
};

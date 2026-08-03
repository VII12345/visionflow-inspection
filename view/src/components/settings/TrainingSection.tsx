import React from 'react';
import { Button } from '../common/Button';
import type { Product } from '../../types';

interface Props {
  products: Product[];
  selectedModel: { model: string; id: number } | null;
  running: boolean;
  progress: number;
  progressLabel: string;
  metrics: string;
  onStart: () => void;
  onStop: () => void;
}

/** AI 学习控制卡片：开始/停止 + 训练进度展示。 */
export const TrainingSection: React.FC<Props> = ({
  products,
  selectedModel,
  running,
  progress,
  progressLabel,
  metrics,
  onStart,
  onStop,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
      <h3 className="text-[15px] font-semibold text-text-primary mb-4">AI 学习控制</h3>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-text-secondary text-[13px] w-16">当前型号</span>
          <span className="text-text-primary font-medium text-[13px] bg-gray-50 px-3 py-2 rounded-md flex-1">
            {products.find(p => p.id === selectedModel?.id)?.name || selectedModel?.model || '未选择'}
          </span>
        </div>
        <div className="flex gap-3">
          <Button variant="learn" onClick={onStart} disabled={running}>开始学习</Button>
          <Button variant="secondary" size="sm" onClick={onStop} disabled={!running}>停止</Button>
        </div>
        {running && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-text-secondary mt-2">{progressLabel}</p>
            <p className="text-[11px] text-text-tertiary mt-1">{metrics}</p>
          </div>
        )}
      </div>
    </div>
  );
};

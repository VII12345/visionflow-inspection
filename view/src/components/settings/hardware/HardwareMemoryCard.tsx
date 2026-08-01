import React from 'react';
import type { HardwareInfo } from './useHardwareInfo';

interface Props {
  hardware: HardwareInfo;
}

/** 内存 (RAM) 信息卡片。 */
export const HardwareMemoryCard: React.FC<Props> = ({ hardware }) => {
  const { memory } = hardware;
  const pass = hardware.checks?.memory_total?.pass;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] text-text-tertiary uppercase tracking-wide">内存 (RAM)</div>
        {pass != null && (
          <span className={`text-[10px] font-medium ${pass ? 'text-ok' : 'text-ng'}`}>
            {pass ? '已达标' : '未达标'}
          </span>
        )}
      </div>
      <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">总容量</span>
          <span className="text-text-primary font-medium">{memory.total_gb ?? '--'} GB</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">已使用</span>
          <span className="text-text-primary font-medium">{memory.used_gb ?? '--'} GB</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">可用</span>
          <span className="text-text-primary font-medium">{memory.available_gb ?? '--'} GB</span>
        </div>
        {memory.speed_mhz && (
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">频率</span>
            <span className="text-text-primary font-medium">{memory.speed_mhz} MHz</span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-text-tertiary">使用率</span>
          <span className={`font-medium ${memory.percent != null && memory.percent > 80 ? 'text-warn' : 'text-text-primary'}`}>{memory.percent ?? '--'}%</span>
        </div>
      </div>
    </div>
  );
};
